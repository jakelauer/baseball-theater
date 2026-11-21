/**
 * text-records.ts (S164 AC 2): the record chain `pnpm backlog:check` holds at every commit, from
 * the fragments alone: one recorded item per ID, stated hashes that match, fields blocks that parse,
 * an intact chain with a fork named by both fragments, and no note left once migrated.
 */
import {
	describe, expect, it,
} from "vitest";
import { parseFragment } from "./ledger.ts";
import type { RecordInput, TextRecord } from "./text-records.ts";
import {
	chains, goalLine, newestBody, parseFields, parseRecord, renderFields, renderRecord, sha256, textRecordProblems, withFields, withoutFields,
} from "./text-records.ts";

const body = (text: string, priority = 5) => `${text}\n\n${renderFields({
	priority,
	scope_files: ["a/"],
})}`;

let clock = 0;
/** A record as audit.sh would write it, parsed back. */
function rec(kind: RecordInput["kind"], id: string, text: string, extra: Partial<RecordInput> = {}): TextRecord
{
	clock++;
	const stamp = `2026-11-21T00:00:${String(clock).padStart(2, "0")}Z`;
	const file = `2026-11-21/${stamp.replace(/[-:]/g, "")}-${id}-${kind}.md`;
	return parseRecord(renderRecord({
		kind,
		id,
		date: "2026-11-21",
		stamp,
		head: "abc1234",
		body: text,
		...extra,
	}), file);
}

describe("text records (AC 2)", () =>
{
	it("round-trips a body byte-exact, with its hash, issue and rewrite, and the ledger reads its heading and issue", () =>
	{
		const text = body("**Gap:** a\n```text\n/goal S9 (S9). x\n```\n## not an entry\n  trailing  ");
		const r = rec("migration", "S9", text, {
			issue: 12,
			base: "deadbee",
			rewrites: ["-old\n+new"],
		});
		expect(r.body).toBe(text);
		expect(r.hash).toBe(sha256(text));
		expect(r.issue).toBe(12);
		expect(r.base).toBe("deadbee");
		expect(r.rewrites).toEqual(["-old\n+new"]);
		expect(goalLine(r.body)).toBe("/goal S9 (S9). x");
		const entry = parseFragment(renderRecord({
			kind: "migration",
			id: "S9",
			date: "2026-11-21",
			stamp: "s",
			head: "h",
			body: text,
			issue: 12,
		}), "2026-11-21/20261121T000000Z-S9-migration.md");
		expect(entry.kind).toBe("migration");
		expect(entry.story).toBe("S9");
		expect(entry.issue).toBe(12);
	});

	it("reports one recorded item per ID: a duplicate migration or create", () =>
	{
		const problems = textRecordProblems([rec("migration", "S1", body("a")), rec("create", "S1", body("b"))], []);
		expect(problems.join("\n")).toMatch(/S1 is recorded more than once/);
	});

	it("reports a body whose hash isn't the one its fragment states", () =>
	{
		const r = rec("create", "S2", body("a"));
		expect(textRecordProblems([{
			...r,
			body: `${r.body}x`,
		}], []).join("\n")).toMatch(/SHA-256/);
	});

	it("reports a story body whose fields block is missing or doesn't parse", () =>
	{
		expect(textRecordProblems([rec("create", "S3", "**Gap:** no fields")], []).join("\n")).toMatch(/S3 .*no ### Backlog fields/);
		expect(textRecordProblems([rec("create", "S4", "### Backlog fields\n\n```yaml\npriority: [\n```\n")], []).join("\n")).toMatch(/does not parse/);
		expect(() => parseFields(body("x", 2.5), "S5")).not.toThrow();
		expect(parseFields(body("x", 2.5), "S5").priority).toBe(2.5);
	});

	it("orders a chain by its from links and reports a fork naming both fragments", () =>
	{
		const start = rec("migration", "S6", body("v1"));
		const e1 = rec("edit", "S6", body("v2"), {
			from: start.hash,
		});
		const e2 = rec("edit", "S6", body("v3"), {
			from: e1.hash,
		});
		expect(chains([e2, start, e1]).get("S6")!.records.map((r) => r.body)).toEqual([start.body, e1.body, e2.body]);
		expect(newestBody([e2, start, e1], "S6")!.body).toBe(e2.body);
		const fork = rec("edit", "S6", body("v2b"), {
			from: start.hash,
		});
		const problems = textRecordProblems([start, e1, fork], []).join("\n");
		expect(problems).toMatch(/forks/);
		expect(problems).toContain(e1.file);
		expect(problems).toContain(fork.file);
	});

	it("reports a gap: an edit whose from is not the body before it", () =>
	{
		const start = rec("create", "S7", body("v1"));
		const lost = rec("edit", "S7", body("v9"), {
			from: sha256("something else"),
		});
		expect(textRecordProblems([start, lost], []).join("\n")).toMatch(/gap in the chain/);
	});

	it("reports no story or bug notes once a migration record exists", () =>
	{
		expect(textRecordProblems([rec("create", "S8", body("a"))], ["docs/v3/backlog/stories/todo/S8.md"])).toEqual([]);
		expect(textRecordProblems([rec("migration", "S8", body("a"))], ["docs/v3/backlog/stories/todo/S8.md"]).join("\n")).toMatch(/no note belongs/);
	});

	it("reports a snapshot whose body matches no recorded body of its story", () =>
	{
		const start = rec("migration", "S10", body("v1"));
		expect(textRecordProblems([start, rec("snapshot", "S10", start.body, {
			status: "done",
		})], [])).toEqual([]);
		expect(textRecordProblems([start, rec("snapshot", "S10", body("other"), {
			status: "done",
		})], []).join("\n")).toMatch(/matches none/);
	});

	it("keeps a bug's symptoms when its fields block is replaced", () =>
	{
		const once = withFields("steps to reproduce", {
			priority: 3,
		});
		const twice = withFields(once, {
			priority: 4,
		});
		expect(withoutFields(twice)).toBe("steps to reproduce");
		expect(parseFields(twice, "B1").priority).toBe(4);
	});
});
