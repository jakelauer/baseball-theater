/**
 * Law L18 (docs/v3/LAWS.md; owner, 2026-11-27: "Yes, add item 33 to the tests slice and the parse test"):
 * every agent definition (`.claude/agents/*.md`) and every skill (`.claude/skills/<name>/SKILL.md`) opens
 * with YAML frontmatter that parses, names itself (an agent by its file name, a skill by its directory
 * name) and says what it is for; every skill directory holds a `SKILL.md`.
 *
 * Why a test and not only review checklist item 35 (docs/v3/LOOP.md §7): Claude Code drops a definition
 * whose frontmatter fails to parse without any error, so the Agent tool silently stops listing that
 * agent. PR #668 left two apostrophes unescaped inside `pre-pr-reviewer`'s single-quoted description
 * ("the diff's risk", "note 00's review log"); every session after it found no `pre-pr-reviewer` to
 * dispatch until #672. `@bt/scripts#test` declares `.claude/agents/**` and `.claude/skills/**` as
 * inputs (turbo.json), so an edit to either re-runs this test instead of replaying it.
 *
 * Assumes the `yaml` package parses as strictly as Claude Code's loader: the negative cases below show
 * it refuses the #668 defect and an unquoted `: ` inside a value.
 */
import {
	existsSync, readdirSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	describe, expect, it,
} from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The frontmatter block of a definition: the text between an opening `---` line and the next `---` line, or null when there is none. */
function frontmatterOf(text: string): string | null
{
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
	return match ? match[1]! : null;
}

/** Parse a frontmatter block into a mapping, throwing on a YAML error or a non-mapping (a bare string or a list). */
function parseFrontmatter(block: string): Record<string, unknown>
{
	const value: unknown = parseYaml(block);
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		throw new Error("frontmatter is not a mapping");
	}
	return value as Record<string, unknown>;
}

/**
 * Every definition file, relative to the repository root: each agent, then each skill directory's SKILL.md.
 * A skill directory is listed whether or not its SKILL.md exists, so one saved under another name
 * (`skill.md`) fails its test instead of being skipped: Claude Code would skip it silently too.
 */
function definitionFiles(): string[]
{
	const agents = readdirSync(join(ROOT, ".claude/agents")).filter((f) => f.endsWith(".md")).map((f) => `.claude/agents/${f}`);
	const skills = readdirSync(join(ROOT, ".claude/skills"), {
		withFileTypes: true,
	})
		.filter((d) => d.isDirectory())
		.map((d) => `.claude/skills/${d.name}/SKILL.md`);
	return [...agents, ...skills].sort();
}

/** The name a definition must declare: an agent's file name without `.md`, or a skill's directory name. */
function expectedName(file: string): string
{
	return file.startsWith(".claude/agents/") ? file.slice(".claude/agents/".length, -".md".length) : file.split("/")[2]!;
}

describe("agent and skill frontmatter parses (law L18)", () =>
{
	const files = definitionFiles();

	it("finds the agent definitions and skills", () =>
	{
		expect(files.some((f) => f === ".claude/agents/pre-pr-reviewer.md")).toBe(true);
		expect(files.some((f) => f === ".claude/skills/run-backlog/SKILL.md")).toBe(true);
	});

	for (const file of files)
	{
		it(`${file}: frontmatter parses, with a name and a description`, () =>
		{
			expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true);
			const block = frontmatterOf(readFileSync(join(ROOT, file), "utf8"));
			expect(block, `${file} opens with no --- frontmatter block`).not.toBeNull();
			const data = parseFrontmatter(block!);
			expect(typeof data.description, `${file}: description`).toBe("string");
			expect((data.description as string).trim().length, `${file}: description`).toBeGreaterThan(0);
			// Claude Code addresses an agent or a skill by its `name`; one that differs from its file or
			// directory name is a renamed copy (and the comparison also rules out a missing or empty name).
			expect(data.name, `${file}: name`).toBe(expectedName(file));
		});
	}

	it("refuses #668's defect: an unescaped apostrophe inside a single-quoted value", () =>
	{
		expect(() => parseFrontmatter("name: x\ndescription: 'sized to the diff's risk'")).toThrow();
		expect(parseFrontmatter("name: x\ndescription: 'sized to the diff''s risk'").description).toBe("sized to the diff's risk");
	});

	it("refuses an unquoted colon and space inside a value, and a file with no frontmatter", () =>
	{
		expect(() => parseFrontmatter("name: x\ndescription: Use for: reviews")).toThrow();
		expect(() => parseFrontmatter("just a sentence")).toThrow();
		expect(frontmatterOf("# A heading\n\nNo frontmatter here.\n")).toBeNull();
	});
});
