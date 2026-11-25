import {
	Group, Stack, TextInput, Title,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SearchFilters } from "@bt/domain";
import {
	SEARCH_QUERY_MAX_LENGTH, parseSearchFilters, searchableWith,
} from "@bt/domain";
import type { SearchHighlightsPayload } from "../api/search.js";
import { useHighlightSearch } from "../api/search.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import type { SearchFilterName } from "../components/search/SearchFilterChips.js";
import { SearchFilterChips } from "../components/search/SearchFilterChips.js";
import { resultPlayLink } from "../components/search/resultPlayLink.js";
import { LazyPlayerDialog } from "../components/videos/LazyPlayerDialog.js";
import { useOpenClip } from "../components/videos/openClip.js";
import { VideoCard } from "../components/videos/VideoCard.js";
import { VideoGrid } from "../components/videos/VideoGrid.js";
import type { VideoLayout } from "../components/videos/VideoLayoutToggle.js";
import { VideoLayoutToggle } from "../components/videos/VideoLayoutToggle.js";
import type { LayoutVariant } from "../layout/variant.js";

/** One search result: MLB's clip, the game it belongs to (null when MLB ties it to none) and its play's half-inning and inning. */
type SearchResult = SearchHighlightsPayload["highlights"][number];

/**
 * Search Highlights (S5; standings-search-settings `search-*`, retitled by A2 for a highlights-only
 * search): the title, the box ("Search highlights…"), then for the words searched one `VideoCard`
 * per clip in `VideoGrid`, with the Videos room's Grid / List control (`VideoLayoutToggle`) above
 * them (#588; owner, 2026-11-25: "search results should show the same video format as everywhere
 * else, and should offer the option to show as a grid or a list"), grid first. This replaces the
 * frames' typographic rows; each card keeps the rows' matchup at the start of its meta line (none
 * for a clip MLB ties to no game), its date line and, for a clip with a play, S153's inning pill
 * (`resultPlayLink`, `videoMeta`), and its title stays MLB's (no `scoresHidden`). The cards keep the
 * rows' `search-result` / `search-play-link` test ids, which S5, S72 and S153's design specs wait on.
 * The frames' count line above the results is not drawn: no number shows until Search pages through MLB's matches
 * (owner, 2026-11-22: "Don’t show any number until we support paging"), since one page lists 36
 * clips while MLB may match thousands. The words live in the URL (`?q=`), so a search can be shared, Back
 * returns to it, and closing the player leaves the same results and words.
 *
 * S72's filters live in the URL too (`?date=`, `?team=`, `?tag=`, read by `parseSearchFilters`, the
 * route's own parser), each drawn as an "Active filters" chip under the box; removing one drops it from
 * the URL, which asks the search again without it, and a new search keeps the filters set. A filter alone
 * is a search (every Yankees home run); a URL with a malformed filter shows what an empty box does, and
 * a new search from it searches the words without that URL's filters.
 *
 * A card plays its clip in S70's floating player over the results, whatever the Video Player setting
 * (there is no stage on Search), with A10's pills (S173): the game pill when the result has a game, then
 * its inning pill when it has a play (`resultPlayLink`, as its card builds it). The open clip is in the
 * URL too (`?clip=`, `useOpenClip`, #424), so each card is a link a middle-click opens in a new tab; a new
 * search drops it. Loading, no
 * results and error are `ViewState`'s generic treatment, through `queryScreen` (S28's one "keep
 * what's on screen" rule). Hide Scores changes nothing here (owner, 2026-10-21: "Search is
 * unaffected by hide scores"): titles and blurbs are MLB's.
 */
export function SearchPage({ variant }: { variant: LayoutVariant })
{
	const [params, setParams] = useSearchParams();
	const [layout, setLayout] = useState<VideoLayout>("grid");
	const q = (params.get("q") ?? "").trim();
	const parsed = parseSearchFilters((name) => params.get(name));
	const filters: SearchFilters = parsed === "invalid" ? {} : parsed;
	const {
		data, error, refetch,
	} = useHighlightSearch(q, filters);
	const {
		playing, href, close,
	} = useOpenClip<SearchResult>(data?.highlights, (result) => result.highlight.id);

	/**
	 * The URL for words `words` with the filters set now, less `without` (a removed chip's). It writes the
	 * parsed `filters`, not the URL's raw values, so a malformed filter (which draws no chip and so can't be
	 * removed) drops on the next search instead of keeping every search empty.
	 */
	function navigate(words: string, without?: SearchFilterName)
	{
		const next = new URLSearchParams();
		if (words) next.set("q", words);
		const values: Record<SearchFilterName, string | undefined> = {
			date: filters.date,
			team: filters.teamId === undefined ? undefined : String(filters.teamId),
			tag: filters.tag,
		};
		for (const name of ["date", "team", "tag"] as const)
		{
			const value = values[name];
			if (value !== undefined && name !== without) next.set(name, value);
		}
		setParams(next);
	}

	let body = null;
	// Words the route would refuse (only hyphens or spaces with no filter, or past the limit, as a pasted URL can hold) and
	// malformed filters show what an empty box does (no chip; the next search drops them, `navigate`).
	if (parsed !== "invalid" && searchableWith(q, filters))
	{
		const screen = queryScreen({
			data,
			error,
		});
		if (screen === "error")
		{
			body = <ViewState kind="error" title="Couldn't search highlights" onRetry={() => void refetch()} />;
		}
		else if (screen === "loading" || !data)
		{
			// Result rows' shape, under the title, box and chips, which draw at once (B584, #584).
			body = <ViewState kind="loading" shape="results" />;
		}
		else if (data.highlights.length === 0)
		{
			body = <ViewState kind="empty" message={data.query ? `No highlights found for “${data.query}”.` : "No highlights match these filters."} />;
		}
		else
		{
			body = (
				<Stack gap="md">
					<Group justify="flex-end">
						<VideoLayoutToggle value={layout} onChange={setLayout} />
					</Group>
					<VideoGrid variant={variant} layout={layout}>
						{data.highlights.map((result) => (
							<VideoCard
								key={result.highlight.id}
								video={result.highlight}
								layout={layout}
								href={href(result)}
								playLink={resultPlayLink(result)}
								matchup={result.game}
								testId="search-result"
								pillTestId="search-play-link"
							/>
						))}
					</VideoGrid>
				</Stack>
			);
		}
	}

	return (
		<Stack gap="lg">
			<Title order={1}>Search Highlights</Title>
			<SearchForm
				q={q}
				onSearch={(words) => navigate(words)}
			/>
			<SearchFilterChips filters={filters} onRemove={(name) => navigate(q, name)} />
			{body}
			{playing ? (
				<LazyPlayerDialog
					video={playing.highlight}
					onClose={close}
					{...playing.game && {
						game: playing.game,
					}}
					playLink={resultPlayLink(playing)}
				/>
			) : null}
		</Stack>
	);
}

/**
 * The search box: what the fan is typing, handed to `onSearch` trimmed on Enter. It follows the URL's
 * words `q`: when they change (a search, Back, the nav's Search) the box is re-seeded from them during
 * render, so it never shows stale words, and it is never remounted, so it keeps focus after a search.
 * It stops at `SEARCH_QUERY_MAX_LENGTH`, the route's limit.
 */
function SearchForm({ q, onSearch }: { q: string;
	onSearch: (words: string) => void; })
{
	const [typed, setTyped] = useState(q);
	const [seen, setSeen] = useState(q);
	if (q !== seen)
	{
		setSeen(q);
		setTyped(q);
	}
	return (
		<form
			role="search"
			onSubmit={(event) =>
			{
				event.preventDefault();
				onSearch(typed.trim());
			}}
		>
			<TextInput
				aria-label="Search highlights"
				placeholder="Search highlights…"
				value={typed}
				onChange={(event) => setTyped(event.currentTarget.value)}
				leftSection={<IconSearch size={20} aria-hidden />}
				size="md"
				type="search"
				maxLength={SEARCH_QUERY_MAX_LENGTH}
			/>
		</form>
	);
}
