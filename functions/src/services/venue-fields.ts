/**
 * Ballpark field drawings (S105): Baseball Savant's SVG outline of each park, keyed by MLB's venue id
 * (`GameSnapshot.venue.id`), for a spray chart of where batted balls went (S103's `x` / `y`). Ingest owns the call
 * (ADR-002): a game's first write asks Savant for its venue's drawing when BT keeps none ({@link keepVenueFields}, run
 * among the write's after-steps in `ingest.ts`), sanitizes it ({@link sanitizeFieldSvg}) and keeps it; the route
 * `GET /api/v1/venues/:venueId/field.svg` only reads what is kept, so neither a request nor the browser ever reaches
 * Savant. The drawings are MLB's artwork; the terms and the owner's go-ahead are in `docs/v3/SAVANT-DATA.md`.
 */
import type { MlbStatsClient, VenueFieldRepository } from "@bt/ports";
import { askWithinLimit } from "./player-of-the-game.js";

/**
 * How long one drawing request may take before it counts as no answer: it runs after a game's write, and in a game's
 * ingest object before the poll publishes, so it stays short. A 250×250 outline is a few kilobytes.
 */
export const VENUE_FIELD_LIMIT_MS = 3_000;

/**
 * How long a venue BT asked and got no drawing for (Savant has none, the call failed or timed out, or its answer was
 * refused) waits before a new game there asks again: a week, so a failure is retried without asking on every game.
 * A kept drawing is never asked again.
 */
export const VENUE_FIELD_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** The largest drawing BT keeps: Savant's are 5–8 kB, so anything far bigger isn't a field outline. */
export const VENUE_FIELD_MAX_LENGTH = 256 * 1024;

/**
 * The SVG elements a field drawing may keep. Anything else is dropped with everything inside it: `script`,
 * `foreignObject` (HTML inside the drawing), `a` and `image` (links and outside images), `animate` / `set` (which can
 * rewrite an attribute such as `href` after the fact), `feImage` and `iframe` among them. An allowlist, so an element
 * nobody thought of is dropped rather than kept. Names are case-sensitive, as SVG's are.
 */
const KEPT_ELEMENTS = new Set([
	"svg", "g", "defs", "symbol", "use", "title", "desc", "style",
	"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath",
	"linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker",
]);

/** XML's predefined entities; numeric references are decoded by code point. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'",
};

/** `text` with its character references decoded, as the browser reads it before acting on a value. */
function decodeEntities(text: string): string
{
	return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, ref: string) =>
	{
		if (ref.startsWith("#"))
		{
			const code = ref.startsWith("#x") ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
			return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
		}
		return NAMED_ENTITIES[ref] ?? whole;
	});
}

/**
 * Whether decoded CSS (a `<style>` element's text or a `style` attribute) can reach outside the drawing or run
 * anything: an `@import`, a `url(…)` to anything but a local `#` fragment, old script hooks (`expression(`,
 * `-moz-binding`, `behavior`, `javascript:`), or any backslash, since a CSS escape can spell any of those (`\75 rl(`).
 */
function unsafeCss(css: string): boolean
{
	const lower = css.toLowerCase();
	if (/[\\]|@import|expression\s*\(|-moz-binding|behavior\s*:|javascript:/.test(lower)) return true;
	for (const match of lower.matchAll(/url\s*\(\s*(['"]?)\s*([^'")]*)/g))
	{
		if (!(match[2] ?? "").startsWith("#")) return true;
	}
	return false;
}

/**
 * Whether an attribute may stay: never an event handler (`on…`), never `xml:base`, an `href` in any namespace
 * (`href`, `xlink:href`) only to a local `#` fragment, never a value naming `javascript:`, and a value with CSS in
 * it (`style`, or `url(…)` in `fill`, `clip-path`, …) only when {@link unsafeCss} passes it. Values are read decoded.
 */
function keptAttribute(name: string, rawValue: string): boolean
{
	const lower = name.toLowerCase();
	const local = lower.slice(lower.lastIndexOf(":") + 1);
	const value = decodeEntities(rawValue);
	const squashed = value.replace(/\s+/g, "").toLowerCase();
	if (lower.startsWith("on") || lower === "xml:base") return false;
	if (local === "href") return value.trim().startsWith("#");
	if (squashed.includes("javascript:")) return false;
	if (lower === "style" || squashed.includes("url(")) return !unsafeCss(value);
	return true;
}

/** One parsed start tag: its name, its attributes as written, whether it closes itself, and where it ends. */
type StartTag = { name: string;
	attributes: { name: string;
		value: string;
		text: string; }[];
	selfClosing: boolean;
	end: number; };

/** Parses the start tag at `at` (`svg[at] === "<"`); null when it isn't well-formed XML (an unquoted value, no `>`). */
function parseStartTag(svg: string, at: number): StartTag | null
{
	const name = /^<([A-Za-z_][\w.:-]*)/.exec(svg.slice(at, at + 256))?.[1];
	if (name === undefined) return null;
	const attributes: StartTag["attributes"] = [];
	let i = at + 1 + name.length;
	for (;;)
	{
		const space = /^\s*/.exec(svg.slice(i))![0].length;
		i += space;
		if (svg.startsWith("/>", i)) return {
			name,
			attributes,
			selfClosing: true,
			end: i + 2,
		};
		if (svg[i] === ">") return {
			name,
			attributes,
			selfClosing: false,
			end: i + 1,
		};
		// Attributes are separated by whitespace; anything else is malformed.
		if (space === 0) return null;
		const attribute = /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])/.exec(svg.slice(i, i + 512));
		if (!attribute) return null;
		const quote = attribute[2]!;
		const valueStart = i + attribute[0].length;
		const valueEnd = svg.indexOf(quote, valueStart);
		if (valueEnd === -1) return null;
		attributes.push({
			name: attribute[1]!,
			value: svg.slice(valueStart, valueEnd),
			text: svg.slice(i, valueEnd + 1),
		});
		i = valueEnd + 1;
	}
}

/**
 * The one sanitizer for a field drawing before BT stores it (S105 AC 3): Savant's SVG with nothing that can run or
 * reach outside the drawing, or null when it can't be read safely. Kept: the leading `<?xml …?>` declaration, comments,
 * text, and the {@link KEPT_ELEMENTS} with their attributes as written, so a clean drawing (4169's, 3313's) comes out
 * byte for byte as it went in. Dropped: every other element with all it holds (`<script>`, `<foreignObject>`, …),
 * any other processing instruction (`<?xml-stylesheet?>` loads outside CSS), and each attribute
 * {@link keptAttribute} refuses (`on…` handlers, an `href` / `xlink:href` to anything but a `#` fragment). A
 * `<style>` whose CSS {@link unsafeCss} refuses keeps the element but loses its text. Refused whole (null): a
 * `<!DOCTYPE` or other declaration (its entities could smuggle markup in), anything that isn't well-formed (an
 * unclosed or mismatched tag, an unquoted attribute), a document over {@link VENUE_FIELD_MAX_LENGTH}, or one left with
 * no `<svg>` element. It parses, never regex-replaces, so markup split across a comment or an attribute can't slip
 * through.
 */
export function sanitizeFieldSvg(svg: string): string | null
{
	if (svg.length > VENUE_FIELD_MAX_LENGTH) return null;
	let out = "";
	let i = 0;
	/** Open elements, innermost last; `dropped` marks one dropped (with all it holds). */
	const open: { name: string;
		dropped: boolean; }[] = [];
	const dropping = () => open.some((element) => element.dropped);
	const inStyle = () => open.at(-1)?.name === "style" && !dropping();
	/** Text inside a kept `<style>` is CSS: kept only when safe. */
	let styleText: string[] = [];
	const emitText = (text: string, decoded: string) =>
	{
		if (dropping() || text === "") return;
		if (inStyle()) styleText.push(text, decoded);
		else out += text;
	};
	while (i < svg.length)
	{
		const lt = svg.indexOf("<", i);
		if (lt === -1)
		{
			emitText(svg.slice(i), decodeEntities(svg.slice(i)));
			break;
		}
		emitText(svg.slice(i, lt), decodeEntities(svg.slice(i, lt)));
		if (svg.startsWith("<!--", lt))
		{
			const end = svg.indexOf("-->", lt + 4);
			if (end === -1) return null;
			// A comment does nothing in SVG; inside a style it would be CSS text, so it goes through the CSS check.
			emitText(svg.slice(lt, end + 3), svg.slice(lt, end + 3));
			i = end + 3;
		}
		else if (svg.startsWith("<![CDATA[", lt))
		{
			const end = svg.indexOf("]]>", lt + 9);
			if (end === -1) return null;
			// Character data isn't entity-decoded, so its decoded form is itself.
			emitText(svg.slice(lt, end + 3), svg.slice(lt + 9, end));
			i = end + 3;
		}
		else if (svg.startsWith("<?", lt))
		{
			const end = svg.indexOf("?>", lt + 2);
			if (end === -1) return null;
			// Only the XML declaration, and only first in the document, is kept.
			if (lt === 0 && /^<\?xml\s/.test(svg.slice(0, 6))) out += svg.slice(lt, end + 2);
			i = end + 2;
		}
		else if (svg.startsWith("<!", lt))
		{
			return null;
		}
		else if (svg.startsWith("</", lt))
		{
			const end = svg.indexOf(">", lt);
			if (end === -1) return null;
			const name = svg.slice(lt + 2, end).trim();
			const element = open.pop();
			if (!element || element.name !== name) return null;
			if (!element.dropped && !dropping())
			{
				if (name === "style")
				{
					// Every piece of the style's text is checked together, as the browser reads it as one sheet.
					const decoded = styleText.filter((_, index) => index % 2 === 1).join("");
					if (!unsafeCss(decoded)) out += styleText.filter((_, index) => index % 2 === 0).join("");
					styleText = [];
				}
				out += svg.slice(lt, end + 1);
			}
			i = end + 1;
		}
		else
		{
			const tag = parseStartTag(svg, lt);
			if (!tag) return null;
			const dropped = dropping() || !KEPT_ELEMENTS.has(tag.name) || inStyle();
			if (!dropped)
			{
				const kept = tag.attributes.filter((attribute) => keptAttribute(attribute.name, attribute.value));
				out += kept.length === tag.attributes.length
					? svg.slice(lt, tag.end)
					: `<${tag.name}${kept.map((attribute) => ` ${attribute.text}`).join("")}${tag.selfClosing ? "/>" : ">"}`;
			}
			if (!tag.selfClosing) open.push({
				name: tag.name,
				dropped,
			});
			i = tag.end;
		}
	}
	if (open.length > 0) return null;
	return /<svg[\s>/]/.test(out) ? out : null;
}

/**
 * What an ingest path may carry for {@link keepVenueFields} (`ingest.ts`'s after-steps): an MLB client that can ask for
 * a drawing, and where drawings are kept. Either absent, nothing is asked.
 */
export type VenueFieldAsk = {
	mlb?: Partial<Pick<MlbStatsClient, "fetchVenueField">>;
	venueFields?: VenueFieldRepository;
};

/** What {@link keepVenueFields} needs: Savant through the MLB client, and where drawings are kept. */
export type VenueFieldDeps = {
	mlb: Pick<MlbStatsClient, "fetchVenueField">;
	venueFields: VenueFieldRepository;
};

/**
 * Keeps each venue's field drawing (S105 AC 2), the first time a game there is stored: for each venue id (a positive
 * integer; repeats count once) with no drawing kept, and no failed ask in the last {@link VENUE_FIELD_RETRY_MS}, asks
 * Savant once (bounded by `limitMs`), sanitizes the answer and stores it, or stores null (no drawing, a failed or slow
 * call, or an answer the sanitizer refused) so the venue isn't asked again on every game. A kept drawing is never asked
 * again or replaced. `at` is the write's time: the row's `fetchedAt`. The source is optional (AC 5), so this never
 * throws: a venue whose read or write fails is logged and skipped, the rest still asked, and the game's own writes,
 * which ran before it, stand.
 */
export async function keepVenueFields(deps: VenueFieldDeps, venueIds: Iterable<number>, at: Date, limitMs: number = VENUE_FIELD_LIMIT_MS): Promise<void>
{
	for (const venueId of new Set(venueIds))
	{
		if (!Number.isSafeInteger(venueId) || venueId <= 0) continue;
		try
		{
			const stored = await deps.venueFields.get(venueId);
			if (stored && (stored.svg !== null || at.getTime() - Date.parse(stored.fetchedAt) < VENUE_FIELD_RETRY_MS)) continue;
			const answer = await askWithinLimit(() => deps.mlb.fetchVenueField(venueId), limitMs);
			const svg = answer === null ? null : sanitizeFieldSvg(answer);
			if (answer !== null && svg === null) console.warn(`venue field ${venueId}: Savant's drawing refused by the sanitizer; kept as none`);
			await deps.venueFields.upsert({
				venueId,
				svg,
				fetchedAt: at.toISOString(),
			});
		}
		catch (error)
		{
			console.warn(`venue field ${venueId}: not kept: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
