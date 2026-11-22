import { useEffect, useState } from "react";
import {
	Stack, Text, Title,
} from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import type { SeasonPhaseName, StandingsViews } from "@bt/domain";
import {
	championBoxShows, clinchLegend, isCalendarDate, mlbToday, SEASON_PHASES, standingsHasNoTeams, standingsViews,
} from "@bt/domain";
import { useStandings } from "../api/standings.js";
import type { StandingsPayload } from "../api/standings.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import { ChampionBox } from "../components/standings/ChampionBox.js";
import { ClinchLegend } from "../components/standings/ClinchLegend.js";
import { DivisionTable } from "../components/standings/DivisionTable.js";
import { ViewSwitch } from "../components/standings/ViewSwitch.js";
import { VIEW_LABELS } from "../components/standings/viewLabels.js";
import { formatLongDate } from "../format/datetime.js";
import { FooterMeta } from "../layout/FooterMeta.js";
import type { LayoutVariant } from "../layout/variant.js";

type Table = Pick<StandingsPayload, "divisions">;

/** What the page draws: a view, the answer it came in and that view's table, for the day it was asked for. */
interface Drawn {
	date: string | undefined;
	view: SeasonPhaseName;
	answer: StandingsPayload;
	table: Table;
	/** The day's views, or null for an answer cached before S139 (no `phases`): S128's table, no switch. */
	views: StandingsViews | null;
}

function isView(value: string | null): value is SeasonPhaseName
{
	return SEASON_PHASES.some((phase) => phase === value);
}

/** The phases a request names (S130 AC 1): always the regular season, plus the view shown when it is another. */
function phasesFor(view: SeasonPhaseName | null): SeasonPhaseName[]
{
	return view && view !== "regularSeason" ? ["regularSeason", view] : ["regularSeason"];
}

/**
 * Standings (S4; S130; standings-search-settings `standings-*` and A9): the heading, with "as of
 * <day>" on a day in the address that isn't MLB's today; the view switch (spring training, the regular
 * season, the playoffs) when the day offers more than the regular season; the World Series box when
 * `championBoxShows`; then one `DivisionTable` per division of the shown view's table, the clinch
 * legend under the last. Loading, empty and error are `ViewState`'s, with no switch and no box.
 *
 * Which views a day offers and which opens first is `standingsViews`, given the day being viewed
 * (`?date=`, else MLB's today) and the answer. The view shown is the address's `?view=` when the day
 * offers it, else the day's default; an address naming anything else is corrected in place (no history
 * entry), and one naming no view never is, so the default opens on every visit. The page asks only for
 * the phases it shows (owner, 2026-11-13): the regular season always (its `clinched` says whether the
 * playoffs are offered), plus the address's view when it is spring or the playoffs; when the default
 * is another view it asks again for that phase. Until the shown view's table arrives the page draws
 * the loading state the first time, and afterwards keeps the table already on screen (`drawn`), so
 * switching views or correcting the address never blanks it. S28's keep-what's-on-screen rule
 * (`queryScreen`) is applied to each of the two requests on its own: a refetch of an answer the page
 * already had that fails keeps it, but a request that has never answered (the first load, or a view
 * just chosen) shows the error state, with no switch and no box (A9), and Retry asks for that request
 * again. Choosing the view already shown does nothing (no history entry). The tab title is Standings'
 * own, names the view the switch marks (none while the error state shows), and goes back to the
 * app's on leaving.
 */
export function StandingsPage({ variant = "desktop" }: { variant?: LayoutVariant })
{
	const [params, setParams] = useSearchParams();
	// An empty `?date=` is no day at all, as the request already treats it (`fetchStandings`).
	const date = params.get("date") || undefined;
	const asked = params.get("view");
	const day = date ?? mlbToday(new Date());

	const basePhases = phasesFor(asked === "spring" || asked === "playoffs" ? asked : null);
	const base = useStandings(date, basePhases);
	const views = base.data?.phases ? standingsViews(day, base.data) : null;
	const shown: SeasonPhaseName | null = views ? (isView(asked) && views.offered.includes(asked) ? asked : views.first) : null;
	// Until the day's views are known it is the first request itself (the same key, so no second request).
	const current = useStandings(date, shown ? phasesFor(shown) : basePhases);

	// The shown view's table once its own answer is in (never a placeholder kept from another request).
	let next: Drawn | null = null;
	const answer = current.data && !current.isPlaceholderData ? current.data : undefined;
	if (answer && !answer.phases)
	{
		next = {
			date,
			view: "regularSeason",
			answer,
			table: answer,
			views: null,
		};
	}
	else if (answer && shown)
	{
		const table = answer.phases[shown]?.table;
		if (table || shown === "regularSeason")
		{
			next = {
				date,
				view: shown,
				answer,
				table: table ?? answer,
				views: standingsViews(day, answer),
			};
		}
	}
	const [drawn, setDrawn] = useState<Drawn | null>(null);
	if (next && (drawn?.answer !== next.answer || drawn.view !== next.view))
	{
		setDrawn(next);
	}
	const display = next ?? (drawn?.date === date ? drawn : null);

	// Correct an address naming a view the day doesn't offer, or no view at all, without a history entry.
	const correct = views !== null && asked !== null && !(isView(asked) && views.offered.includes(asked));
	useEffect(() =>
	{
		if (!correct) return;
		setParams((p) =>
		{
			p.delete("view");
			return p;
		}, {
			replace: true,
		});
	}, [correct, setParams]);

	// S28's rule per request: one that has never answered and failed is the error state, even with
	// another view's table on screen; a failed refetch of an answer already had keeps it.
	const failed = [base, current].find((query) => queryScreen(query) === "error");

	// The "as of" words only for a real calendar day, so `?date=bogus` or `2027-02-30` never reaches the
	// heading; S138 extends this check with its lower bound on the days it accepts (1901-04-18).
	const asOf = date && isCalendarDate(date) && date !== mlbToday(new Date()) ? formatLongDate(date) : null;
	const heading = asOf ? `Standings as of ${asOf}` : "Standings";
	// The view the switch marks, even while its table is on its way; no view while the error state shows.
	const titleView = failed ? null : shown ?? display?.view ?? null;
	const title = titleView ? `${heading} · ${VIEW_LABELS[titleView]} · Baseball Theater` : `${heading} · Baseball Theater`;

	// Only Standings sets the tab's title (A9): put back whatever the app had on leaving.
	useEffect(() =>
	{
		const previous = document.title;
		return () =>
		{
			document.title = previous;
		};
	}, []);
	useEffect(() =>
	{
		document.title = title;
	}, [title]);

	const choose = (view: SeasonPhaseName) =>
	{
		if (view === shown) return;
		setParams((p) =>
		{
			p.set("view", view);
			return p;
		});
	};

	let body;
	if (failed)
	{
		body = <ViewState kind="error" title="Couldn't load standings" onRetry={() => void failed.refetch()} />;
	}
	else if (!display)
	{
		body = <ViewState kind="loading" />;
	}
	else
	{
		body = <StandingsBody display={display} shown={shown ?? display.view} day={day} date={date} variant={variant} onChoose={choose} />;
	}

	return (
		<Stack gap="xl">
			<Title order={1}>
				Standings
				{asOf
					? (
						<Text span inherit={false} fz={variant === "mobile" ? 18 : 20} fw={400} c="var(--bt-muted)" ml={4}>
							{" "}
							{`as of ${asOf}`}
						</Text>
					)
					: null}
			</Title>
			{body}
		</Stack>
	);
}

/**
 * The page under its heading once a table is in: the switch (marking `shown`, the view the address
 * asks for, even while its table is still on its way), the World Series box, the drawn view's tables
 * and the clinch legend (in the switch's panel when there is a switch), then the footer line.
 */
function StandingsBody({
	display, shown, day, date, variant, onChoose,
}: { display: Drawn;
	shown: SeasonPhaseName;
	day: string;
	date: string | undefined;
	variant: LayoutVariant;
	onChoose: (view: SeasonPhaseName) => void; })
{
	const {
		view, table, answer, views,
	} = display;
	const champion = answer.champion ?? null;
	const offersPlayoffs = views?.offered.includes("playoffs") ?? false;
	const playoffsHref = offersPlayoffs && view !== "playoffs"
		? `/standings?${new URLSearchParams({
			...date && {
				date,
			},
			view: "playoffs",
		}).toString()}`
		: null;

	let tables;
	if (view === "spring" && standingsHasNoTeams(table))
	{
		tables = (
			<Stack gap={4} data-testid="spring-empty">
				<Title order={3} fz={18}>Spring training starts today</Title>
				<Text fz={14}>Its standings show here once the first spring game is final.</Text>
			</Stack>
		);
	}
	else if (table.divisions.length === 0)
	{
		tables = <ViewState kind="empty" message="No standings for this date." />;
	}
	else
	{
		const columns = view === "spring" ? "spring" : view === "playoffs" ? "teams" : "full";
		tables = (
			<>
				{table.divisions.map((division) => <DivisionTable key={division.divisionId ?? division.name} division={division} columns={columns} variant={variant} />)}
				{view === "spring" ? null : <ClinchLegend lines={clinchLegend([table])} />}
			</>
		);
	}

	const content = (
		<>
			{champion && championBoxShows(champion, view, day) ? <ChampionBox champion={champion} playoffsHref={playoffsHref} variant={variant} /> : null}
			{tables}
		</>
	);

	return (
		<>
			{views && views.offered.length > 1
				? <ViewSwitch offered={views.offered} shown={shown} onChoose={onChoose}>{content}</ViewSwitch>
				: content}
			<FooterMeta fetchedAt={answer.fetchedAt} />
		</>
	);
}
