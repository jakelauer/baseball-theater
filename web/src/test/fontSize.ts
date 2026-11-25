/**
 * Mantine's default type scale in px (`--mantine-font-size-*`, `--mantine-h*-font-size` at scale 1).
 * The theme (`App.tsx`) overrides neither, so these are the sizes the app draws.
 */
const FONT_SIZES: Record<string, number> = {
	xs: 12,
	sm: 14,
	md: 16,
	lg: 18,
	xl: 20,
};
const HEADING_SIZES: Record<string, number> = {
	h1: 34,
	h2: 26,
	h3: 22,
	h4: 18,
	h5: 16,
	h6: 14,
};

/** The body text size: Mantine's `md`, which `Text` draws when given no size and the page body uses. */
export const BODY_FONT_PX = FONT_SIZES.md ?? 16;

/**
 * The font size, in px, that a Mantine `Text` or `Title` element asks for. jsdom loads no Mantine
 * CSS, so this reads what Mantine writes inline instead: `fz` as `font-size: calc(Xrem * …)` or a
 * scale name, `size` as `--text-fz` / `--title-fz`, and a `Text` with neither falls back to `md`
 * (B527, #527: a test can check a header is never smaller than body text).
 */
export function mantineFontPx(element: HTMLElement): number
{
	const inline = element.style.fontSize;
	const rem = /^calc\(([\d.]+)rem/.exec(inline);
	if (rem?.[1]) return Number(rem[1]) * 16;
	const px = /^([\d.]+)px$/.exec(inline);
	if (px?.[1]) return Number(px[1]);
	const token = inline || element.style.getPropertyValue("--text-fz") || element.style.getPropertyValue("--title-fz");
	const named = /--mantine-(?:font-size-(\w+)|(h\d)-font-size)/.exec(token);
	if (named?.[1]) return FONT_SIZES[named[1]] ?? Number.NaN;
	if (named?.[2]) return HEADING_SIZES[named[2]] ?? Number.NaN;
	return BODY_FONT_PX;
}
