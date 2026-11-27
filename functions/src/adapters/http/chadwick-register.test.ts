/**
 * The Chadwick register adapter (S209 AC 1 and AC 3) on the committed sample, `fixtures/chadwick-register-823823.csv`:
 * the register's own header and the rows of the 823823 game's players, recorded once from the live register. Plus
 * the conditional request and the reading rules, each on a row of its own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	CHADWICK_REGISTER_BASE_URL, CHADWICK_REGISTER_FILES, ChadwickPlayerRegister, leadingFields,
} from "./chadwick-register.js";

const SAMPLE = readFileSync(fileURLToPath(new URL("../../../../fixtures/chadwick-register-823823.csv", import.meta.url)), "utf8");
const HEADER = SAMPLE.slice(0, SAMPLE.indexOf("\n") + 1);
const COLUMNS = HEADER.trim().split(",");

/** A register line with `cells` set by column name and every other column empty. */
function line(cells: Record<string, string>): string
{
	return COLUMNS.map((column) => cells[column] ?? "").join(",");
}

/** A fetch answering every file with `text` (streamed in 97-byte chunks, so lines split across them) and `etag`, recording each request. */
function serving(text: string, etag: string | null = "\"e1\"", status = 200)
{
	const asked: { url: string;
		ifNoneMatch: string | null; }[] = [];
	const fetchImpl = async (input: string | URL | Request, init?: RequestInit) =>
	{
		asked.push({
			url: String(input),
			ifNoneMatch: new Headers(init?.headers).get("If-None-Match"),
		});
		if (status !== 200) return new Response(null, {
			status,
		});
		const bytes = new TextEncoder().encode(text);
		return new Response(new ReadableStream<Uint8Array>({
			start(controller)
			{
				for (let at = 0; at < bytes.length; at += 97) controller.enqueue(bytes.slice(at, at + 97));
				controller.close();
			},
		}), {
			headers: etag === null ? {} : {
				ETag: etag,
			},
		});
	};
	return {
		asked,
		fetchImpl: fetchImpl as typeof fetch,
	};
}

describe("ChadwickPlayerRegister (S209 AC 1)", () =>
{
	it("S209 AC 1: a changed file answers its rows with an MLB id, each id null where the register has none, and the copy's ETag", async () =>
	{
		const { fetchImpl, asked } = serving(SAMPLE);
		const answer = await new ChadwickPlayerRegister(fetchImpl).fetchFile("people-3.csv", null);
		expect(answer.changed).toBe(true);
		if (!answer.changed) return;
		expect(answer.etag).toBe("\"e1\"");
		expect(answer.rows).toHaveLength(SAMPLE.trim().split("\n").length - 1);
		expect(answer.rows.find((row) => row.personId === 665871)).toEqual({
			personId: 665871,
			fangraphsId: "21741",
			bbrefId: "assadja01",
			playedInMlb: true,
		});
		// A 2026 rookie the register has no FanGraphs id for reads null, not "".
		expect(answer.rows.find((row) => row.personId === 691788)).toEqual({
			personId: 691788,
			fangraphsId: null,
			bbrefId: "mackjo02",
			playedInMlb: true,
		});
		// The file is read from the register's published folder, at run time, with no condition when BT has no ETag.
		expect(asked).toEqual([{
			url: `${CHADWICK_REGISTER_BASE_URL}/people-3.csv`,
			ifNoneMatch: null,
		}]);
	});

	it("S209 AC 1: the register's files are its sixteen published ones", () =>
	{
		expect(new ChadwickPlayerRegister().files).toEqual(CHADWICK_REGISTER_FILES);
		expect(CHADWICK_REGISTER_FILES).toHaveLength(16);
	});
});

describe("the register's conditional request (S209 AC 3)", () =>
{
	it("S209 AC 3: sends the stored ETag as If-None-Match, and a 304 is unchanged with no rows read", async () =>
	{
		const { fetchImpl, asked } = serving("", null, 304);
		expect(await new ChadwickPlayerRegister(fetchImpl).fetchFile("people-0.csv", "\"e1\"")).toEqual({
			changed: false,
		});
		expect(asked[0]?.ifNoneMatch).toBe("\"e1\"");
	});

	it("S209 AC 3: a 200 with no ETag answers a null one", async () =>
	{
		const answer = await new ChadwickPlayerRegister(serving(SAMPLE, null).fetchImpl).fetchFile("people-0.csv", null);
		expect(answer).toMatchObject({
			changed: true,
			etag: null,
		});
	});

	it("S209 AC 3: a 404 or 503 rejects, so nothing is stored for the file", async () =>
	{
		for (const status of [404, 503])
		{
			await expect(new ChadwickPlayerRegister(serving("", null, status).fetchImpl).fetchFile("people-0.csv", "\"e1\"")).rejects.toThrow(new RegExp(`HTTP ${status}`));
		}
	});

	it("S209 AC 3: a 200 with an empty body, or a header and no row with an MLB id, rejects, so the file's stored rows stay", async () =>
	{
		await expect(new ChadwickPlayerRegister(serving("", "\"e2\"").fetchImpl).fetchFile("people-0.csv", "\"e1\"")).rejects.toThrow(/people-0\.csv: no header line/);
		await expect(new ChadwickPlayerRegister(serving(HEADER, "\"e2\"").fetchImpl).fetchFile("people-0.csv", "\"e1\"")).rejects.toThrow(/people-0\.csv: no row with an MLB id/);
		await expect(new ChadwickPlayerRegister(serving(HEADER + line({
			key_mlbam: "",
			key_bbref: "minors01",
		}) + "\n", "\"e2\"").fetchImpl).fetchFile("people-0.csv", "\"e1\"")).rejects.toThrow(/no row with an MLB id/);
	});
});

describe("reading the register (S209 AC 3)", () =>
{
	async function rowsOf(...lines: string[])
	{
		const answer = await new ChadwickPlayerRegister(serving(HEADER + lines.join("\n") + "\n").fetchImpl).fetchFile("people-0.csv", null);
		return answer.changed ? answer.rows : [];
	}

	it("S209 AC 3: a row whose MLB id is empty, not a whole number or past 2147483647 is skipped (an empty one is not person 0)", async () =>
	{
		expect(await rowsOf(
			line({
				key_mlbam: "",
				key_fangraphs: "12345",
				key_bbref: "someo01",
			}),
			line({
				key_mlbam: "0",
				key_fangraphs: "1",
			}),
			line({
				key_mlbam: "12a",
				key_fangraphs: "2",
			}),
			line({
				key_mlbam: "99999999999",
				key_fangraphs: "3",
			}),
			line({
				key_mlbam: "600000",
				key_bbref: "kept01",
			}),
		)).toEqual([{
			personId: 600000,
			fangraphsId: null,
			bbrefId: "kept01",
			playedInMlb: false,
		}]);
	});

	it("S209 AC 3: a quoted field holding a comma before key_fangraphs is one field", async () =>
	{
		const cells = COLUMNS.map((column) => ({
			key_mlbam: "600002",
			key_bbref: "tejadpe01",
			key_bbref_minors: "\"tejada000jr,\"",
			key_fangraphs: "222",
			mlb_played_first: "2022",
		})[column] ?? "");
		expect(await rowsOf(cells.join(","))).toEqual([{
			personId: 600002,
			fangraphsId: "222",
			bbrefId: "tejadpe01",
			playedInMlb: true,
		}]);
		expect(leadingFields("a,\"b,\"\"c\"\"\",d", 3)).toEqual(["a", "b,\"c\"", "d"]);
		expect(leadingFields("a,,", 3)).toEqual(["a", "", ""]);
	});

	it("S209 AC 3: two rows naming one MLB id give the first non-empty id of each kind, in file order", async () =>
	{
		expect(await rowsOf(
			line({
				key_mlbam: "600001",
				key_bbref: "first01",
				key_fangraphs: "111",
			}),
			line({
				key_mlbam: "600001",
			}),
			line({
				key_mlbam: "600003",
				key_bbref: "third01",
			}),
			line({
				key_mlbam: "600003",
				key_bbref: "other01",
				key_fangraphs: "333",
				mlb_played_first: "2001",
			}),
		)).toEqual([{
			personId: 600001,
			fangraphsId: "111",
			bbrefId: "first01",
			playedInMlb: false,
		}, {
			personId: 600003,
			fangraphsId: "333",
			bbrefId: "third01",
			playedInMlb: true,
		}]);
	});
});
