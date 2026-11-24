/**
 * The ratified reference a design capture is judged against (backlog rule 22): the one
 * implementation behind both `pnpm design:review` (e2e/design-review.ts, which lays the pair out
 * for the owner) and `scripts/audit.sh … --design-match` (which records the pair in the ledger),
 * so the ledger names exactly what the owner was shown (ADR-025: one implementation per rule).
 *
 * A ratified amendment frame (docs/v3/visual/<surface>/amendments/<frame>.png) wins over the
 * original frame of the same name, since it is what the build is matched against. A written
 * amendment (its "## Frames" section says "None") that overrides a frame wins too, and since it
 * has no picture the amendment file itself is the reference: an older frame it supersedes is never
 * paired with a capture (S73: the old under-the-header banner frames, shown beside captures after
 * A6 moved the notice to the bottom, made a stale build look right; S28's ledger row named the
 * same superseded frames).
 *
 * A story can instead name the ratified frame(s) a capture is judged against, in
 * `docs/v3/design-checks/<ID>/frames.json` beside its captures (owner, 2026-11-24, asked how S154
 * should record a verdict for page captures with no ratified frame of their own: "Change the tool
 * (Recommended)", "A small separate PR lets a story name the frame a capture is judged against"):
 * `{ "about-mobile.png": ["docs/v3/visual/shell-scoreboard/amendments/changelog-mobile.png"] }`.
 * Each path is repo-relative under docs/v3/visual/, must exist, be ratified and not be superseded;
 * a capture with no entry keeps the same-name rule above.
 *
 *   node scripts/backlog-vault/design-reference.ts <visual dir> <capture name>.png [<story checks dir>]
 *
 * prints the governing reference(s), one path per line: the written amendment alone, else every
 * candidate frame (amendment frames if any, else originals) so a caller can refuse an ambiguous name.
 * Given the story's checks dir it prints the pairing the ledger records (captureReferences) and
 * exits 2 when there is none: a bad map entry, or an unmapped name matching other than one reference.
 */

import {
	existsSync, readdirSync, readFileSync,
} from "node:fs";
import {
	basename, join, normalize, sep,
} from "node:path";

/** A capture's reference: a drawn frame, or the written amendment that governs its name. */
export interface DesignReference
{
	kind: "frame" | "amendment";
	path: string;
}

/** The surface folders under the visual dir (docs/v3/visual/<surface>/). */
function surfaces(visualDir: string): string[]
{
	return readdirSync(visualDir, {
		withFileTypes: true,
	}).filter((d) => d.isDirectory()).map((d) => join(visualDir, d.name)).sort();
}

/**
 * Every ratified frame named like the capture: the amendment frames of that name if any surface
 * has one, else the original frames. More than one means the name is ambiguous across surfaces.
 */
export function ratifiedFrames(visualDir: string, name: string): string[]
{
	const dirs = surfaces(visualDir);
	const amended = dirs.map((s) => join(s, "amendments", name)).filter((p) => existsSync(p));
	return amended.length > 0 ? amended : dirs.map((s) => join(s, name)).filter((p) => existsSync(p));
}

/**
 * The ratified written amendment that governs a frame, if one does: the highest-numbered
 * amendment of any surface whose text names the frame, where that amendment is written (no
 * drawn frames) and names it on its **Overrides:** line. Names there are backticked: whole
 * (`shell-notice-mobile`), a suffix shorthand for the name before it (`-medium`), or a glob
 * (`settings-*`). A later amendment that draws the frame (`<name>.png` in its text) governs instead.
 */
export function writtenAmendment(visualDir: string, name: string): { path: string;
	text: string; } | null
{
	const frame = name.replace(/\.png$/, "");
	let best: { n: number;
		path: string;
		text: string;
		written: boolean; } | null = null;
	for (const surface of surfaces(visualDir))
	{
		const dir = join(surface, "amendments");
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir).filter((f) => /^A\d+\.md$/.test(f)))
		{
			const path = join(dir, file);
			const text = readFileSync(path, "utf8");
			const n = Number(file.slice(1, -3));
			const written = /^## Frames\s+None\b/m.test(text);
			const overrides = written ? overriddenNames(text) : [];
			const covers = text.includes(`${frame}.png`) || overrides.some((o) => (o.endsWith("*") ? frame.startsWith(o.slice(0, -1)) : o === frame));
			if (covers && (!best || n > best.n)) best = {
				n,
				path,
				text,
				written,
			};
		}
	}
	return best?.written ? {
		path: best.path,
		text: best.text,
	} : null;
}

/** The frame names on an amendment's **Overrides:** line, with `-medium`-style shorthands expanded. */
export function overriddenNames(text: string): string[]
{
	const line = /^\*\*Overrides:\*\*(.*)$/m.exec(text)?.[1] ?? "";
	const names: string[] = [];
	for (const [, token] of line.matchAll(/`([a-z0-9*-]+)`/g))
	{
		const previous = names.at(-1);
		names.push(token!.startsWith("-") && previous ? previous.replace(/-[a-z0-9]+$/, token!) : token!);
	}
	return names;
}

/** Every reference that could govern the capture: the written amendment alone, else the candidate frames. */
export function designReferences(visualDir: string, name: string): DesignReference[]
{
	const amendment = writtenAmendment(visualDir, name);
	if (amendment) return [{
		kind: "amendment",
		path: amendment.path,
	}];
	return ratifiedFrames(visualDir, name).map((path) => ({
		kind: "frame",
		path,
	}));
}

/** Where a map entry's paths must start: they are repo-relative, and stand for the visual dir. */
const VISUAL_PREFIX = "docs/v3/visual/";

/** The file in a story's checks dir that names the frames its captures are judged against. */
export const FRAMES_MAP = "frames.json";

/**
 * Whether an amendment's text is still a draft: a draft marker (`**Draft`, "not ratified", "not yet
 * ratified", any case) and no "Ratified by: <name>" line. The same test as is_draft in
 * scripts/review-debt.sh, which reads the committed text instead of a file.
 */
export function isDraftAmendment(text: string): boolean
{
	return /\*\*Draft|not (yet )?ratified/i.test(text) && !/^Ratified by:[ \t]*\S/m.test(text);
}

/**
 * Whether the path exists with exactly this spelling, level by level from the directory listings:
 * macOS's disk ignores case, so existsSync would accept `FOO-mobile.png` for `foo-mobile.png`,
 * which then dodges the name checks below (they compare with case) and doesn't exist on Linux.
 */
function existsExactly(root: string, parts: string[]): boolean
{
	let dir = root;
	for (const part of parts)
	{
		if (!existsSync(dir) || !readdirSync(dir).includes(part)) return false;
		dir = join(dir, part);
	}
	return true;
}

/**
 * Why a frame under the visual dir can't be a ratified reference, or null when it can. `rel` is its
 * path relative to the visual dir: `<surface>/<name>.png` (ratified with its surface's RATIFIED.md,
 * and superseded by an amendment frame of that name in the same surface) or
 * `<surface>/amendments/<name>.png` (ratified when the highest-numbered amendment that names
 * `<name>.png` is not a draft). Either is superseded by a written amendment that overrides its name.
 */
export function frameProblem(visualDir: string, rel: string): string | null
{
	const parts = rel.split("/");
	const name = parts.at(-1)!;
	if (!name.endsWith(".png")) return "is not a .png frame";
	if (!existsExactly(visualDir, parts)) return "does not exist";
	const surface = join(visualDir, parts[0]!);
	if (parts.length === 2)
	{
		if (!existsSync(join(surface, "RATIFIED.md"))) return "is in a surface with no RATIFIED.md";
		if (existsSync(join(surface, "amendments", name))) return `is superseded by ${join(surface, "amendments", name)}`;
	}
	else if (parts.length === 3 && parts[1] === "amendments")
	{
		const dir = join(surface, "amendments");
		// Whole-name match: `changelog-mobile.png` must not count as named by `drawer-changelog-mobile.png`.
		const named = new RegExp(`(?<![a-z0-9-])${name.replace(/[.]/g, "\\.")}`);
		const naming = readdirSync(dir).filter((f) => /^A\d+\.md$/.test(f))
			.map((f) => ({
				n: Number(f.slice(1, -3)),
				text: readFileSync(join(dir, f), "utf8"),
			}))
			.filter((a) => named.test(a.text))
			.sort((a, b) => b.n - a.n)[0];
		if (!naming) return "is named by no amendment, so nothing ratified it";
		if (isDraftAmendment(naming.text)) return `is drawn by A${naming.n}, still a draft`;
	}
	else return "is not a surface frame (<surface>/<name>.png or <surface>/amendments/<name>.png)";
	const amendment = writtenAmendment(visualDir, name);
	if (amendment) return `is superseded by the written amendment ${amendment.path}`;
	return null;
}

/**
 * The frames a story's map names for a capture, or null when the map (or its entry) is absent.
 * Throws, naming the capture and path, on an entry that isn't a path or list of paths under
 * docs/v3/visual/, names the same frame twice, or names a frame frameProblem refuses.
 */
export function mappedReferences(visualDir: string, checksDir: string, name: string): DesignReference[] | null
{
	const file = join(checksDir, FRAMES_MAP);
	if (!existsSync(file)) return null;
	const map = JSON.parse(readFileSync(file, "utf8")) as unknown;
	if (typeof map !== "object" || map === null || Array.isArray(map)) throw new Error(`${file} must be an object of capture name → frame path(s)`);
	const entry = (map as Record<string, unknown>)[name];
	if (entry === undefined) return null;
	const paths = typeof entry === "string" ? [entry] : entry;
	if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string"))
	{
		throw new Error(`${file}: ${name} must map to a frame path or a non-empty list of them`);
	}
	const seen = new Set<string>();
	return (paths as string[]).map((path) =>
	{
		const rel = path.startsWith(VISUAL_PREFIX) ? normalize(path.slice(VISUAL_PREFIX.length)).split(sep).join("/") : null;
		if (rel === null || rel.startsWith("..") || rel.startsWith("/")) throw new Error(`${file}: ${name} → ${path} is not under ${VISUAL_PREFIX}`);
		// One row per pair: a frame listed twice would put the same pair in the ledger twice.
		if (seen.has(rel)) throw new Error(`${file}: ${name} names ${path} more than once`);
		seen.add(rel);
		const problem = frameProblem(visualDir, rel);
		if (problem) throw new Error(`${file}: ${name} → ${path} ${problem}`);
		return {
			kind: "frame",
			path: join(visualDir, rel),
		};
	});
}

/**
 * The references a capture is judged against, as the ledger records them: the story's map entry
 * when it has one (every frame it names), else the one reference its name resolves to. Throws on a
 * bad map entry and on an unmapped name that resolves to no reference or to more than one.
 */
export function captureReferences(visualDir: string, checksDir: string, name: string): DesignReference[]
{
	const mapped = mappedReferences(visualDir, checksDir, name);
	if (mapped) return mapped;
	const refs = designReferences(visualDir, name);
	if (refs.length !== 1)
	{
		throw new Error(`capture ${name} matches ${refs.length} ratified frames under ${visualDir}; need exactly one, or name its frames in ${join(checksDir, FRAMES_MAP)}`);
	}
	return refs;
}

/**
 * captureReferences for `pnpm design:review`, which lays out every capture rather than stop at the
 * first bad one: the same references, or no references and the same refusal audit.sh would print,
 * so the folder never shows a pair the ledger would refuse to record.
 */
export function reviewPairing(visualDir: string, checksDir: string, name: string): { references: DesignReference[];
	error: string | null; }
{
	try
	{
		return {
			references: captureReferences(visualDir, checksDir, name),
			error: null,
		};
	}
	catch (error)
	{
		return {
			references: [],
			error: (error as Error).message,
		};
	}
}

if (import.meta.main)
{
	const [visualDir, name, checksDir] = process.argv.slice(2);
	if (!visualDir || !name)
	{
		console.error("usage: node scripts/backlog-vault/design-reference.ts <visual dir> <capture name>.png [<story checks dir>]");
		process.exit(2);
	}
	try
	{
		const refs = checksDir ? captureReferences(visualDir, checksDir, basename(name)) : designReferences(visualDir, name);
		for (const ref of refs) console.log(ref.path);
	}
	catch (error)
	{
		console.error(`audit: ${(error as Error).message}`);
		process.exit(2);
	}
}
