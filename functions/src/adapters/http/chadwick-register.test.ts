/**
 * The Chadwick register adapter (S209 AC 1) on the committed sample, `fixtures/chadwick-register-823823.csv`: the
 * register's own header and the rows of the 823823 game's players, recorded once from the live register.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import {
	CHADWICK_REGISTER_BASE_URL, CHADWICK_REGISTER_FILES, ChadwickPlayerRegister,
} from "./chadwick-register.js";

const SAMPLE = readFileSync(fileURLToPath(new URL("../../../../fixtures/chadwick-register-823823.csv", import.meta.url)), "utf8");
const HEADER = SAMPLE.slice(0, SAMPLE.indexOf("\n") + 1);

/** A fetch serving the sample as `file` and a header-only file for every other one, streamed in small chunks. */
function registerFetch(file = "people-3.csv")
{
	const asked: string[] = [];
	const fetchImpl = async (input: string | URL | Request) =>
	{
		const url = String(input);
		asked.push(url);
		const text = url.endsWith(`/${file}`) ? SAMPLE : HEADER;
		const bytes = new TextEncoder().encode(text);
		return new Response(new ReadableStream<Uint8Array>({
			start(controller)
			{
				// 97-byte chunks, so lines split across chunks as they do on the network.
				for (let at = 0; at < bytes.length; at += 97) controller.enqueue(bytes.slice(at, at + 97));
				controller.close();
			},
		}));
	};
	return {
		asked,
		fetchImpl: fetchImpl as typeof fetch,
	};
}

describe("ChadwickPlayerRegister (S209 AC 1)", () =>
{
	it("S209 AC 1: keeps only the asked players' FanGraphs and Baseball-Reference ids, null where the register has none", async () =>
	{
		const { fetchImpl, asked } = registerFetch();
		const found = await new ChadwickPlayerRegister(fetchImpl).lookup([665871, 663538, 669065, 999999999]);
		expect(found.get(665871)).toEqual({
			fangraphsId: "21741",
			bbrefId: "assadja01",
		});
		expect(found.get(663538)).toEqual({
			fangraphsId: "21479",
			bbrefId: "hoernni01",
		});
		expect(found.has(999999999)).toBe(false);
		// Not every player has a FanGraphs id in the register: such a player reads null, not "".
		const noFangraphs = SAMPLE.trim().split("\n").slice(1).map((line) => line.split(",")).find((cells) => cells[6] === "");
		expect(noFangraphs).toBeDefined();
		const id = Number(noFangraphs![2]);
		expect((await new ChadwickPlayerRegister(registerFetch().fetchImpl).lookup([id])).get(id)?.fangraphsId).toBeNull();
		// The register's every file is read from its published folder, at run time.
		expect(asked).toEqual(CHADWICK_REGISTER_FILES.map((name) => `${CHADWICK_REGISTER_BASE_URL}/${name}`));
	});

	it("S209 AC 1: stops reading once every asked player is found", async () =>
	{
		const { fetchImpl, asked } = registerFetch("people-0.csv");
		await new ChadwickPlayerRegister(fetchImpl).lookup([665871]);
		expect(asked).toHaveLength(1);
	});

	it("S209 AC 1: a file that fails rejects the lookup, so nothing is marked checked", async () =>
	{
		const failing = (async () => new Response("nope", {
			status: 503,
		})) as unknown as typeof fetch;
		await expect(new ChadwickPlayerRegister(failing).lookup([665871])).rejects.toThrow(/HTTP 503/);
	});
});
