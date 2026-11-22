import {
	Stack, Text, TextInput, Title,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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
 * search): the title, the box ("Search highlights…"), then for the words searched the count ("5
 * results found") and one typographic `SearchResultRow` per clip, in one column at every pairing
 * (it widens with the host). The words live in the URL (`?q=`), so a search can be shared, Back
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
	const [typed, setTyped] = useState(q);
	const [playing, setPlaying] = useState<SearchResult | null>(null);
	const {
		data, error, refetch, dataUpdatedAt,
	} = useHighlightSearch(q);

	let body = null;
	if (q !== "")
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
			const count = data.highlights.length;
			body = (
				<Stack gap={0}>
					<Text size="xs" fw={700} tt="uppercase" px={12} pb={12} data-testid="search-count" style={{
						borderBottom: "1px solid var(--bt-hairline)",
					}}
					>
						{count} {count === 1 ? "result" : "results"} found
					</Text>
					{data.highlights.map((result) => <SearchResultRow key={result.highlight.id} result={result} onPlay={setPlaying} />)}
					<FooterMeta fetchedAt={new Date(dataUpdatedAt).toISOString()} />
				</Stack>
			);
		}
	}

	return (
		<Stack gap="lg">
			<Title order={1}>Search Highlights</Title>
			<form
				role="search"
				onSubmit={(event) =>
				{
					event.preventDefault();
					const words = typed.trim();
					setParams(words ? {
						q: words,
					} : {});
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
				/>
			</form>
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
