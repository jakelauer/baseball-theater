import {
	Stack, TextInput, Title,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SEARCH_QUERY_MAX_LENGTH, searchableQuery } from "@bt/domain";
import { useHighlightSearch } from "../api/search.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import type { SearchResult } from "../components/search/SearchResultRow.js";
import { SearchResultRow } from "../components/search/SearchResultRow.js";
import { gameLabel } from "../components/videos/gameLabel.js";
import { LazyPlayerDialog } from "../components/videos/LazyPlayerDialog.js";
import { FooterMeta } from "../layout/FooterMeta.js";

/**
 * Search Highlights (S5; standings-search-settings `search-*`, retitled by A2 for a highlights-only
 * search): the title, the box ("Search highlights…"), then for the words searched one typographic
 * `SearchResultRow` per clip, in one column at every pairing (it widens with the host). The frames'
 * count line above the rows is not drawn: no number shows until Search pages through MLB's matches
 * (owner, 2026-11-22: "Don’t show any number until we support paging"), since one page lists 36
 * clips while MLB may match thousands. The words live in the URL (`?q=`), so a search can be shared, Back
 * returns to it, and closing the player leaves the same results and words. The filter chips the
 * frames draw are S72's, not built here.
 *
 * A row plays its clip in S70's floating player over the results, whatever the Video Player setting
 * (there is no stage on Search), with the link to its game when it has one (A2, A6). Loading, no
 * results and error are `ViewState`'s generic treatment, through `queryScreen` (S28's one "keep
 * what's on screen" rule). Hide Scores changes nothing here (owner, 2026-10-21: "Search is
 * unaffected by hide scores"): titles and blurbs are MLB's.
 */
export function SearchPage()
{
	const [params, setParams] = useSearchParams();
	const q = (params.get("q") ?? "").trim();
	const [playing, setPlaying] = useState<SearchResult | null>(null);
	const {
		data, error, refetch, dataUpdatedAt,
	} = useHighlightSearch(q);

	let body = null;
	// Words the route would refuse (only hyphens or spaces, or past the limit, as a pasted URL can hold) show what an empty box does.
	if (searchableQuery(q))
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
			body = <ViewState kind="loading" />;
		}
		else if (data.highlights.length === 0)
		{
			body = <ViewState kind="empty" message={`No highlights found for “${data.query}”.`} />;
		}
		else
		{
			body = (
				<Stack gap={0}>
					{data.highlights.map((result) => <SearchResultRow key={result.highlight.id} result={result} onPlay={setPlaying} />)}
					<FooterMeta fetchedAt={new Date(dataUpdatedAt).toISOString()} />
				</Stack>
			);
		}
	}

	return (
		<Stack gap="lg">
			<Title order={1}>Search Highlights</Title>
			<SearchForm
				q={q}
				onSearch={(words) => setParams(words ? {
					q: words,
				} : {})}
			/>
			{body}
			{playing ? (
				<LazyPlayerDialog
					video={playing.highlight}
					onClose={() => setPlaying(null)}
					{...playing.game && {
						game: {
							gamePk: playing.game.gamePk,
							label: gameLabel(playing.game),
						},
					}}
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
