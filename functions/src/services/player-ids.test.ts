/**
 * The register sync (S209 AC 1 and AC 3): which file a run takes, the conditional request, MLB's fill of the
 * register's gaps, and what a failure leaves, against the in-memory double with a fake register and fake MLB
 * cross-references. The Postgres adapter's statement (counts, deletes, the claim) is the shared contract's
 * (`describePlayerIdContract`).
 */
import type {
	PlayerRegister, PlayerXrefSource, RegisterFileAnswer, RegisterRow, ResolvedPlayerIds,
} from "@bt/ports";
import {
	describe, expect, it,
} from "vitest";
import { ChadwickPlayerRegister } from "../adapters/http/chadwick-register.js";
import { InMemoryPlayerIdRepository } from "../adapters/memory/repos.js";
import {
	dueRegisterFile, fillFromXrefs, PLAYER_XREF_BATCH, REGISTER_RETRY_MS, REGISTER_SYNC_INTERVAL_MS, syncPlayerRegister,
} from "./player-ids.js";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const FILES = ["people-0.csv", "people-1.csv", "people-2.csv"];
const at = (ms: number) => new Date(NOW.getTime() + ms);

const row = (personId: number, fangraphsId: string | null, bbrefId: string | null, playedInMlb = true): RegisterRow => ({
	personId,
	fangraphsId,
	bbrefId,
	playedInMlb,
});

/** A register serving `rows` for every file (or failing), answering 304 when asked with the ETag it serves. */
class FakeRegister implements PlayerRegister
{
	readonly files = FILES;
	asked: { file: string;
		etag: string | null; }[] = [];
	etag = "\"v1\"";
	failing = false;

	constructor(public rows: Record<string, RegisterRow[]> = {}) {}

	async fetchFile(file: string, etag: string | null): Promise<RegisterFileAnswer>
	{
		this.asked.push({
			file,
			etag,
		});
		if (this.failing) throw new Error(`Chadwick register ${file}: HTTP 503`);
		if (etag === this.etag) return {
			changed: false,
		};
		return {
			changed: true,
			etag: this.etag,
			rows: this.rows[file] ?? [],
		};
	}
}

/** MLB's cross-references: `known` by person, each call recorded; or failing. */
class FakeXrefs implements PlayerXrefSource
{
	calls: number[][] = [];
	failing = false;

	constructor(private readonly known: Record<number, ResolvedPlayerIds> = {}) {}

	async fetchPlayerXrefs(personIds: readonly number[]): Promise<Map<number, ResolvedPlayerIds>>
	{
		this.calls.push([...personIds]);
		if (this.failing) throw new Error("MLB Stats API 503");
		return new Map(personIds.flatMap((id) => this.known[id] ? [[id, this.known[id]!] as const] : []));
	}
}

function setup(rows: Record<string, RegisterRow[]> = {}, known: Record<number, ResolvedPlayerIds> = {})
{
	const playerIds = new InMemoryPlayerIdRepository();
	const register = new FakeRegister(rows);
	const xrefs = new FakeXrefs(known);
	const run = (when: Date = NOW) => syncPlayerRegister({
		playerIds,
		register,
		xrefs,
		now: () => when,
	});
	return {
		playerIds,
		register,
		xrefs,
		run,
	};
}

describe("the register sync (S209 AC 3)", () =>
{
	it("S209 AC 3: a never-synced file is downloaded and its rows stored, one file a run, in the register's order", async () =>
	{
		const {
			playerIds, register, run,
		} = setup({
			"people-0.csv": [row(1, "f1", "b1"), row(2, null, "b2")],
			"people-1.csv": [row(3, "f3", null)],
		});
		expect(await run()).toMatchObject({
			file: "people-0.csv",
			changed: true,
			inserted: 2,
		});
		expect(register.asked).toEqual([{
			file: "people-0.csv",
			etag: null,
		}]);
		expect(await playerIds.getMany([1, 2, 3])).toEqual([{
			personId: 1,
			fangraphsId: "f1",
			bbrefId: "b1",
		}, {
			personId: 2,
			fangraphsId: null,
			bbrefId: "b2",
		}]);
		// The preseed: each later run takes the next never-synced file, one each.
		await run(at(60_000));
		await run(at(120_000));
		expect(register.asked.map((ask) => ask.file)).toEqual(FILES);
		expect((await playerIds.getMany([3]))).toHaveLength(1);
	});

	it("S209 AC 3: a run with no file due makes no request", async () =>
	{
		const { register, run } = setup();
		for (let minute = 0; minute < FILES.length; minute++) await run(at(minute * 60_000));
		register.asked = [];
		expect(await run(at(REGISTER_SYNC_INTERVAL_MS - 60_000))).toEqual({
			file: null,
		});
		expect(register.asked).toEqual([]);
	});

	it("S209 AC 3: after a day the file synced longest ago is asked with its ETag, and an unchanged one (304) writes no player row", async () =>
	{
		const {
			playerIds, register, xrefs, run,
		} = setup({
			"people-0.csv": [row(1, "f1", null)],
		}, {
			1: {
				fangraphsId: "f1",
				bbrefId: "b1",
			},
		});
		for (let minute = 0; minute < FILES.length; minute++) await run(at(minute * 60_000));
		register.asked = [];
		xrefs.calls = [];
		const replaced = playerIds.replaceRegisterFile.bind(playerIds);
		let writes = 0;
		playerIds.replaceRegisterFile = async (...args) =>
		{
			writes++;
			return replaced(...args);
		};
		expect(await run(at(REGISTER_SYNC_INTERVAL_MS + 1))).toEqual({
			file: "people-0.csv",
			changed: false,
		});
		expect(register.asked).toEqual([{
			file: "people-0.csv",
			etag: "\"v1\"",
		}]);
		expect(writes).toBe(0);
		expect(xrefs.calls).toEqual([]);
		expect((await playerIds.registerFiles()).find((state) => state.file === "people-0.csv")?.syncedAt).toBe(at(REGISTER_SYNC_INTERVAL_MS + 1).toISOString());
		// The next due file is the next oldest, not the one just checked.
		expect(dueRegisterFile(FILES, await playerIds.registerFiles(), at(REGISTER_SYNC_INTERVAL_MS + 60_001))).toBe("people-1.csv");
	});

	it("S209 AC 3: a changed file updates only the rows whose ids changed and deletes a row it dropped", async () =>
	{
		const { register, run } = setup({
			"people-0.csv": [row(1, "f1", "b1"), row(2, "f2", "b2"), row(3, "f3", "b3")],
		});
		for (let minute = 0; minute < FILES.length; minute++) await run(at(minute * 60_000));
		register.etag = "\"v2\"";
		register.rows["people-0.csv"] = [row(1, "f1", "b1"), row(2, "f2", "b2x")];
		expect(await run(at(REGISTER_SYNC_INTERVAL_MS + 1))).toMatchObject({
			file: "people-0.csv",
			changed: true,
			inserted: 0,
			updated: 1,
			deleted: 1,
		});
	});

	it("S209 AC 3: a failed download stores no ETag, the file waits out the retry delay while the others sync, then is fetched again", async () =>
	{
		const {
			playerIds, register, run,
		} = setup({
			"people-0.csv": [row(1, "f1", "b1")],
		});
		register.failing = true;
		await expect(run()).rejects.toThrow(/HTTP 503/);
		expect((await playerIds.registerFiles())[0]).toMatchObject({
			file: "people-0.csv",
			etag: null,
			syncedAt: null,
		});
		register.failing = false;
		expect((await run(at(60_000))).file).toBe("people-1.csv");
		expect((await run(at(120_000))).file).toBe("people-2.csv");
		expect(await run(at(REGISTER_RETRY_MS - 1))).toEqual({
			file: null,
		});
		expect(await run(at(REGISTER_RETRY_MS + 1))).toMatchObject({
			file: "people-0.csv",
			changed: true,
			inserted: 1,
		});
	});

	it("S209 AC 3: a failed MLB call stores no ETag and writes no row", async () =>
	{
		const {
			playerIds, xrefs, run,
		} = setup({
			"people-0.csv": [row(691788, null, "mackjo02")],
		});
		xrefs.failing = true;
		await expect(run()).rejects.toThrow(/MLB Stats API 503/);
		expect(await playerIds.getMany([691788])).toEqual([]);
		expect((await playerIds.registerFiles())[0]?.etag).toBeNull();
	});

	it("S209 AC 3: an empty 200 from the register (a new ETag, no header line) rejects, keeping the file's rows and its old ETag", async () =>
	{
		// The real adapter on a fake fetch: a full copy first, then, a day later, an empty body under a new ETag.
		let body = "key_person,key_mlbam,key_fangraphs,key_bbref,mlb_played_first\nabc0,665871,21741,assadja01,2021\n";
		let etag = "\"e1\"";
		const chadwick = new ChadwickPlayerRegister(async () => new Response(body, {
			headers: {
				ETag: etag,
			},
		}));
		const playerIds = new InMemoryPlayerIdRepository();
		const run = (when: Date) => syncPlayerRegister({
			playerIds,
			register: {
				files: ["people-0.csv"],
				fetchFile: (file, stored) => chadwick.fetchFile(file, stored),
			},
			xrefs: new FakeXrefs(),
			now: () => when,
		});
		expect(await run(NOW)).toMatchObject({
			changed: true,
			inserted: 1,
		});
		body = "";
		etag = "\"e2\"";
		await expect(run(at(REGISTER_SYNC_INTERVAL_MS + 1))).rejects.toThrow(/no header line/);
		expect(await playerIds.getMany([665871])).toEqual([{
			personId: 665871,
			fangraphsId: "21741",
			bbrefId: "assadja01",
		}]);
		expect((await playerIds.registerFiles())[0]?.etag).toBe("\"e1\"");
	});
});

describe("MLB's cross-references fill the register's gaps (S209 AC 1)", () =>
{
	it("S209 AC 1: a rookie's missing FanGraphs id comes from MLB, a player holding both keeps the register's, and one who never played in MLB isn't asked", async () =>
	{
		const {
			playerIds, xrefs, run,
		} = setup({
			"people-0.csv": [
				row(691788, null, "mackjo02"),
				row(665871, "21741", "assadja01"),
				row(600001, null, null, false),
				row(600002, null, null),
			],
		}, {
			691788: {
				fangraphsId: "29780",
				bbrefId: "mackjo99",
			},
			665871: {
				fangraphsId: "other",
				bbrefId: "other01",
			},
			600001: {
				fangraphsId: "minors",
				bbrefId: null,
			},
		});
		await run();
		// Only players who played in MLB and lack an id are asked: not the one with both, not the one who never played.
		expect(xrefs.calls).toEqual([[691788, 600002]]);
		expect(await playerIds.getMany([691788, 665871, 600001, 600002])).toEqual([{
			personId: 665871,
			fangraphsId: "21741",
			bbrefId: "assadja01",
		}, {
			personId: 691788,
			fangraphsId: "29780",
			bbrefId: "mackjo02",
		}]);
	});

	it("S209 AC 1: the register's id wins wherever both hold one", () =>
	{
		expect(fillFromXrefs(row(1, "reg", null), {
			fangraphsId: "mlb",
			bbrefId: "mlb01",
		})).toEqual({
			personId: 1,
			fangraphsId: "reg",
			bbrefId: "mlb01",
		});
		expect(fillFromXrefs(row(1, null, "reg01"), undefined)).toEqual({
			personId: 1,
			fangraphsId: null,
			bbrefId: "reg01",
		});
	});

	it(`S209 AC 3: MLB is asked ${PLAYER_XREF_BATCH} players at a time`, async () =>
	{
		const gaps = Array.from({
			length: 2 * PLAYER_XREF_BATCH + 1,
		}, (_, i) => row(700000 + i, null, `p${i}`));
		const { xrefs, run } = setup({
			"people-0.csv": gaps,
		});
		expect(await run()).toMatchObject({
			xrefCalls: 3,
		});
		expect(xrefs.calls.map((call) => call.length)).toEqual([PLAYER_XREF_BATCH, PLAYER_XREF_BATCH, 1]);
	});
});
