/**
 * A release's fan-facing notes (S131): the owner-approved summary of what changed for fans in one
 * release, kept as `releases/<version>.json` and read by the release check (`pnpm release:check`),
 * the releases API (S132) and the change log page (S134). `CHANGELOG.md` stays the full per-story
 * record; these notes are the subset a fan reads, bucketed as FEATURES' "Update / change log UX"
 * row says: the really big additions (`headline`, shown under the page's gold "Major Feature"
 * header), every change that gets its own entry (`items`, each one of four kinds), and one sentence
 * standing for all the minor fixes (`fixesAndPolish`). The owner approves each release's notes in
 * session (owner, 2026-11-08: "Draft, you approve in session"), and `approval` quotes them.
 */
import { isCalendarDate } from "./calendar-date.js";

/**
 * The kinds an item can be (owner, 2026-11-10: "maybe feature, enhancement, bug fix, are the big
 * three"; 2026-11-16, asked whether to add a fourth and which: "Performance").
 */
export const RELEASE_ITEM_KINDS = ["feature", "enhancement", "performance", "fix"] as const;

/** One of {@link RELEASE_ITEM_KINDS}. */
export type ReleaseItemKind = (typeof RELEASE_ITEM_KINDS)[number];

/** A change in the notes: a short title and the one sentence that explains it to a fan. */
export interface ReleaseEntry
{
	title: string;
	sentence: string;
}

/** A change that gets its own entry on the change log page, labelled with its kind. */
export interface ReleaseItem extends ReleaseEntry
{
	kind: ReleaseItemKind;
}

/** The owner's sign-off: the calendar date they approved the notes and their words, quoted. */
export interface ReleaseApproval
{
	date: string;
	quote: string;
}

/**
 * One release's notes, as `releases/<version>.json` holds them. An entry is in `headline` or
 * `items`, never both. Notes with no `approval` are a draft: nothing publishes from them and
 * {@link currentRelease} ignores them.
 */
export interface ReleaseNotes
{
	/** `vMAJOR.MINOR.PATCH` ({@link parseReleaseVersion}). */
	version: string;
	/**
	 * A calendar date, `YYYY-MM-DD`, if given. The release procedure (CLAUDE.md, step (4)) leaves it empty:
	 * the file is frozen in the release commit before the day the release ships, and the GitHub Release
	 * records that day.
	 */
	date?: string;
	/** The really big additions. */
	headline: ReleaseEntry[];
	/** Every other change with an entry of its own. */
	items: ReleaseItem[];
	/** The one sentence that stands for every minor fix and bit of polish. */
	fixesAndPolish?: string;
	/** The owner's in-session approval, dated and quoted; absent on a draft, which never deploys. */
	approval?: ReleaseApproval;
}

/** A release version split into its numeric parts, with the text it came from. */
export interface ReleaseVersion
{
	text: string;
	major: number;
	minor: number;
	patch: number;
}

/** One thing wrong with a notes file, named by the field it is in (`items[2].kind`, `approval.quote`, …). */
export interface ReleaseNotesProblem
{
	field: string;
	problem: string;
}

/** What {@link parseReleaseNotes} gives back: the notes, or every problem it found. */
export type ReleaseNotesResult =
	| { ok: true;
		notes: ReleaseNotes }
	| { ok: false;
		problems: ReleaseNotesProblem[] };

/** A number part: `0` or digits with no leading zero, so `01` is never read as `1`. */
const PART = "(0|[1-9]\\d*)";
const VERSION = new RegExp(`^v${PART}\\.${PART}\\.${PART}$`);

/**
 * The one check of a release version (S131 AC 2): `vMAJOR.MINOR.PATCH`, each part a number with no
 * leading zero, so `v3.01.0` is rejected rather than read as `v3.1.0`, and `3.1.0` (no `v`) is not a
 * version. A part too big to be a safe integer is not one either, so {@link compareReleaseVersions}
 * never compares rounded numbers (two distinct versions tied, or NaN). Returns the parts, or null for
 * anything else. Git tags, notes files and the release check all go through it.
 */
export function parseReleaseVersion(text: string): ReleaseVersion | null
{
	const match = VERSION.exec(text);
	if (!match) return null;
	const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (![major, minor, patch].every(Number.isSafeInteger)) return null;
	return {
		text,
		major,
		minor,
		patch,
	};
}

/**
 * Orders two release versions, numerically per part (S131 AC 2), so `v3.10.0` is newer than
 * `v3.9.0`: negative when `a` is older, positive when newer, 0 when equal. Throws on a string that
 * isn't a version; callers parse first.
 */
export function compareReleaseVersions(a: string, b: string): number
{
	const [left, right] = [parseReleaseVersion(a), parseReleaseVersion(b)];
	if (!left || !right) throw new Error(`not a release version: ${!left ? a : b}`);
	return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** Whether the owner has approved these notes: an approval with a real date and a non-empty quote. */
export function isApproved(notes: ReleaseNotes): boolean
{
	return notes.approval !== undefined && isCalendarDate(notes.approval.date) && notes.approval.quote.trim() !== "";
}

/**
 * The newest approved notes among those given (S131 AC 2), or null when none is approved; drafts
 * are ignored even when newer. Since #47 a build's own release label comes from its pull request's
 * milestone (S135 AC 1), so this answers what the releases API and the change log page show, not
 * which build is running.
 */
export function currentRelease(all: readonly ReleaseNotes[]): ReleaseNotes | null
{
	return approvedReleasesNewestFirst(all)[0] ?? null;
}

/**
 * Every approved notes among those given, newest version first (S132 AC 1), compared numerically
 * per part ({@link compareReleaseVersions}); drafts are left out whatever their version. The one
 * ordering the releases API's `releases` list and {@link currentRelease} share, so the API's
 * `current` is always its list's first entry.
 */
export function approvedReleasesNewestFirst(all: readonly ReleaseNotes[]): ReleaseNotes[]
{
	return all.filter(isApproved).sort((a, b) => compareReleaseVersions(b.version, a.version));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isFilled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const TOP_FIELDS = new Set(["version", "date", "headline", "items", "fixesAndPolish", "approval"]);

/**
 * The one parser of a release's notes (S131 AC 1), from parsed JSON. It checks everything and
 * returns every problem it found, by field, rather than stopping at the first, so the release check
 * can print them all at once. Notes need at least one entry in some bucket; notes holding only
 * `fixesAndPolish` are valid, as a fixes-only release's are. Unknown fields are problems, so a
 * misspelt `fixesAndPolsh` is caught instead of silently dropped.
 */
export function parseReleaseNotes(input: unknown): ReleaseNotesResult
{
	const problems: ReleaseNotesProblem[] = [];
	const problem = (field: string, text: string) => problems.push({
		field,
		problem: text,
	});
	if (!isRecord(input)) return {
		ok: false,
		problems: [{
			field: "(notes)",
			problem: "must be a JSON object",
		}],
	};

	for (const key of Object.keys(input)) if (!TOP_FIELDS.has(key)) problem(key, "is not a release notes field");

	const version = input.version;
	if (typeof version !== "string" || !parseReleaseVersion(version)) problem("version", "must be vMAJOR.MINOR.PATCH, each part a number with no leading zero");

	if (input.date !== undefined && (typeof input.date !== "string" || !isCalendarDate(input.date))) problem("date", "must be a real calendar date, YYYY-MM-DD");

	// An entry's title and sentence, each a non-empty string; returns whether both were.
	const entry = (field: string, value: unknown): value is Record<string, unknown> =>
	{
		if (!isRecord(value))
		{
			problem(field, "must be an object with a title and a sentence");
			return false;
		}
		const allowed = field.startsWith("items") ? ["title", "sentence", "kind"] : ["title", "sentence"];
		for (const key of Object.keys(value)) if (!allowed.includes(key)) problem(`${field}.${key}`, "is not an entry field");
		if (!isFilled(value.title)) problem(`${field}.title`, "must be a non-empty title");
		if (!isFilled(value.sentence)) problem(`${field}.sentence`, "must be a non-empty sentence");
		return true;
	};

	const list = (field: "headline" | "items"): unknown[] =>
	{
		const value = input[field];
		if (value === undefined) return [];
		if (Array.isArray(value)) return value;
		problem(field, "must be a list");
		return [];
	};

	const headline = list("headline");
	headline.forEach((value, i) => entry(`headline[${i}]`, value));
	const items = list("items");
	items.forEach((value, i) =>
	{
		if (entry(`items[${i}]`, value) && !(RELEASE_ITEM_KINDS as readonly unknown[]).includes(value.kind))
		{
			problem(`items[${i}].kind`, `must be one of ${RELEASE_ITEM_KINDS.join(", ")}`);
		}
	});

	// The same change in both buckets: compared by title, ignoring case and surrounding space.
	const titleOf = (value: unknown) => (isRecord(value) && typeof value.title === "string" ? value.title.trim().toLowerCase() : "");
	const headlineTitles = new Set(headline.map(titleOf).filter((t) => t !== ""));
	items.forEach((value, i) =>
	{
		if (headlineTitles.has(titleOf(value))) problem(`items[${i}].title`, "is also in headline; an entry is in headline or items, never both");
	});

	const fixes = input.fixesAndPolish;
	if (fixes !== undefined && !isFilled(fixes)) problem("fixesAndPolish", "must be a non-empty sentence when present");

	if (headline.length === 0 && items.length === 0 && fixes === undefined)
	{
		problem("(notes)", "has nothing in any bucket: needs a headline, an item or fixesAndPolish");
	}

	const approval = input.approval;
	if (approval !== undefined)
	{
		if (!isRecord(approval)) problem("approval", "must be an object with a date and the owner's quote");
		else
		{
			for (const key of Object.keys(approval)) if (key !== "date" && key !== "quote") problem(`approval.${key}`, "is not an approval field");
			if (typeof approval.date !== "string" || !isCalendarDate(approval.date)) problem("approval.date", "must be a real calendar date, YYYY-MM-DD");
			if (!isFilled(approval.quote)) problem("approval.quote", "must quote the owner's approval");
		}
	}

	if (problems.length > 0) return {
		ok: false,
		problems,
	};
	// A bucket left out of the file is an empty list, so readers never check for a missing one.
	return {
		ok: true,
		notes: {
			...(input as unknown as ReleaseNotes),
			headline: headline as ReleaseEntry[],
			items: items as ReleaseItem[],
		},
	};
}
