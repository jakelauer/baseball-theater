import type { AtBat } from "@bt/domain";
import {
	defaultPlaysInning, halfInningLabel, inningHalves, linescoreCells, ordinal, scoreAfterLabel, scoringPlays, atBatOfPlay, highlightTitle, videosByAtBat,
} from "@bt/domain";
import {
	Accordion, ActionIcon, Badge, Box, Group, Stack, Text, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { IconPlayerPlayFilled } from "@tabler/icons-react";
import type { ReactNode } from "react";
import {
	Fragment, useEffect, useRef, useState,
} from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import type { GamePayload } from "../../api/game.js";
import { useScoresHidden } from "../../settings/useScoresHidden.js";
import { HiddenValue } from "../HiddenValue.js";
import { shortPlayerName } from "../game/format.js";
import { Linescore } from "../game/Linescore.js";
import { useOpenClip } from "../videos/openClip.js";
import { PlayerHost } from "../videos/PlayerHost.js";
import type { Video } from "../videos/VideoCard.js";
import { videoPlayLink } from "../videos/playLink.js";
import { AtBatViewer } from "./AtBatViewer.js";
import { SectionHeading } from "../SectionHeading.js";

/**
 * An open at-bat's header: the matchup, inning and final count, what happened, and the
 * result — in place of the one-line label, rather than repeating it in a box below
 * (owner, 2026-10-29: "When expanded, can the accordion header show the data that's in
 * this box instead of having both the header and the box?").
 */
function OpenHeader({ atBat }: { atBat: AtBat })
{
	return (
		<Stack gap={4} align="flex-start">
			<Text fw={700}>
				{atBat.matchup.batter.fullName} vs {atBat.matchup.pitcher.fullName}
			</Text>
			<Text size="sm" c="dimmed">
				{atBat.about.halfInning === "top" ? "Top" : "Bottom"} {atBat.about.inning} ·{" "}
				{atBat.count.balls}-{atBat.count.strikes}, {atBat.count.outs} out
				{atBat.count.outs === 1 ? "" : "s"}
			</Text>
			<Text>{atBat.result.description}</Text>
			{/* Under the text, not beside it, so a long result isn't clipped by the chevron. */}
			<Badge color={atBat.result.isOut ? "gray" : "teal"} variant="light" style={{
				flexShrink: 0,
			}}>
				{atBat.result.event}
			</Badge>
		</Stack>
	);
}

/** `Top 3` / `Bot 7`: a scoring play's inning tag (`plays-scoring-mobile`), the domain's one half-inning label (S145). */
function inningTag(atBat: AtBat): string
{
	return halfInningLabel(atBat.about);
}

/** The control's accessible name: half, inning, batter and result, whatever the row shows. */
function atBatLabel(atBat: AtBat): string
{
	return `${inningTag(atBat)} · ${atBat.matchup.batter.fullName} — ${atBat.result.event}`;
}

/**
 * What a collapsed row's second line ends with: the outs after it, or the score after a
 * scoring play — masked with Hide Scores on (S75).
 */
type RowEnd = (atBat: AtBat) => ReactNode;

/**
 * A collapsed at-bat row as the frames draw it: `A. Judge — Flyout` over `vs K. Jansen ·
 * 4 pitches · 1 out`; a scoring play leads with its inning tag and ends with the score.
 */
function ClosedRow({
	atBat, tagged, end,
}: { atBat: AtBat;
	tagged: boolean;
	end: RowEnd; })
{
	const meta = [`vs ${shortPlayerName(atBat.matchup.pitcher.fullName)}`, `${atBat.pitches.length} pitch${atBat.pitches.length === 1 ? "" : "es"}`, end(atBat)].filter((part) => part !== null && part !== "");
	return (
		<Stack gap={2}>
			<Text fz={15} fw={600}>
				{tagged ? `${inningTag(atBat)} · ` : ""}
				{shortPlayerName(atBat.matchup.batter.fullName)} — {atBat.result.event}
			</Text>
			<Text fz={12} c="var(--bt-accent)">
				{meta.map((part, i) => <Fragment key={i}>{i > 0 ? " · " : ""}{part}</Fragment>)}
			</Text>
		</Stack>
	);
}

/** One labeled run of rows in the accordion: a half-inning, or the game's scoring plays. */
type Section = {
	label: string;
	plays: AtBat[];
};

/** Which view the sidebar has chosen: an inning, or every scoring play. */
type View = number | "runs";

/**
 * The floating inning sidebar (game-rooms `plays-*`): every inning in order, extras
 * included, then **Runs** under a hairline. The chosen one fills Primary. It stays in
 * view at the room's right edge at every pairing, in reach of the thumb on mobile.
 */
function InningSidebar({
	innings, view, onChoose,
}: { innings: readonly number[];
	view: View;
	onChoose: (view: View) => void; })
{
	const item = (value: View, label: string) => (
		<UnstyledButton
			key={label}
			aria-current={view === value ? "true" : undefined}
			onClick={() => onChoose(value)}
			className={view === value ? undefined : "bt-hover"}
			w={36}
			h={30}
			fz={value === "runs" ? 11 : 14}
			ta="center"
			style={{
				borderRadius: 6,
				background: view === value ? "var(--bt-primary)" : undefined,
				color: "var(--bt-light)",
			}}
		>
			{label}
		</UnstyledButton>
	);
	return (
		<Box
			component="nav"
			aria-label="Inning sidebar"
			p={6}
			style={{
				position: "sticky",
				top: 16,
				flexShrink: 0,
				borderRadius: 12,
				border: "1px solid var(--bt-hairline)",
				background: "var(--bt-raised)",
			}}
		>
			<Stack gap={2}>
				{innings.map((inning) => item(inning, String(inning)))}
				<Box my={4} style={{
					borderTop: "1px solid var(--bt-hairline)",
				}} />
				{item("runs", "Runs")}
			</Stack>
		</Box>
	);
}

/**
 * The Plays room (S41; game-rooms `plays-mobile` / `-medium` / `-desktop` /
 * `plays-scoring-mobile`): the boxed-inning linescore (S2's `Linescore`), then one
 * inning at a time — its top and bottom halves as at-bat rows — with the floating
 * sidebar to choose another inning or **Runs**, every scoring play of the game with the
 * score after it (owner, 2026-10-14: "Plays is basically like browsing a list of the
 * individual batters in Live … you need to be able to select the inning you're looking
 * at. By default, it should show the most recent inning that has any actual information
 * to show"). Every at-bat starts closed (owner, 2026-11-12: "the plays view shouldn't expand
 * any plays by default"), except the one a video's play link arrives on (S97). An open
 * at-bat is Live's cards, zone and pitch sequence (`AtBatViewer`). An at-bat with a clip has a
 * play button on its row that plays the clip in `PlayerHost` without opening the at-bat (#422); the
 * button is a link to this room with the clip open (`useOpenClip`), so a middle-click opens it in a
 * new tab (#424).
 * With Hide Scores on (S75; game-rooms A4 `plays-hidden-nonotice-mobile`,
 * `plays-scoring-hidden-nonotice-mobile`) the linescore masks every inning and R·H·E, the
 * Runs view masks the score after each play, and an in-play pitch reads "IN PLAY"; the
 * descriptions and the batter's line stay, since someone browsing plays wants the plays.
 */
export function PlaysPanel({ game }: { game: GamePayload })
{
	const { plays } = game;
	const latest = defaultPlaysInning(plays);
	const [view, setView] = useState<View | null>(null);
	const scoresHidden = useScoresHidden(game);
	// A video's play link opens the room on that play (S97; game-rooms A6): its inning, its
	// at-bat open and marked. An unknown `?play=` opens the room as usual.
	const [params] = useSearchParams();
	const arrival = atBatOfPlay(plays, params.get("play"));
	// A play button on every at-bat with a clip, however the room was reached: one per at-bat,
	// the first clip in the game's order. It replaced A6's `Video: <clip title>` line, which said a
	// clip existed but gave no way to play it (owner, 2026-11-23, #422).
	const clips = new Map([...videosByAtBat(game.highlights, plays)].map(([index, videos]) => [index, videos[0]!]));
	const {
		playing, href, close,
	} = useOpenClip(game.highlights, (video) => video.id);
	const reduceMotion = useReducedMotion();
	// With Video Player set to Stage, the stage plays at the top of the room, which a row far down a
	// long inning has scrolled out of view: bring it into view, or the button seems to do nothing
	// (#422). The dialog sits in a portal, outside `host`, so it finds nothing to scroll to.
	const host = useRef<HTMLDivElement>(null);
	// Counts presses, so choosing the clip already playing (the same URL, which changes nothing)
	// still brings the stage back into view.
	const [presses, setPresses] = useState(0);
	const play = () => setPresses((n) => n + 1);
	useEffect(() =>
	{
		const stage = playing ? host.current?.querySelector("section") : null;
		if (!stage) return;
		const { top } = stage.getBoundingClientRect();
		if (top >= 0 && top < window.innerHeight) return;
		stage.scrollIntoView({
			behavior: reduceMotion ? "auto" : "smooth",
			block: "start",
		});
	}, [presses, playing, reduceMotion]);
	if (latest === null)
	{
		return <Text c="dimmed">No pitch-level play data for this game yet.</Text>;
	}
	const shown = view ?? arrival?.about.inning ?? latest;
	const away = game.teams.away.abbreviation;
	const home = game.teams.home.abbreviation;
	const { innings } = linescoreCells(game.linescore, game.linescore?.scheduledInnings ?? 9);

	let heading: string;
	let sections: Section[];
	let end: RowEnd;
	if (shown === "runs")
	{
		heading = "Scoring plays";
		sections = [{
			label: "",
			plays: scoringPlays(plays),
		}];
		end = (atBat) => (scoresHidden ? <HiddenValue kind="score" /> : scoreAfterLabel(atBat, away, home));
	}
	else
	{
		const halves = inningHalves(plays, shown);
		heading = `${ordinal(shown)} inning`;
		sections = [{
			label: `Top ${ordinal(shown)} · ${away}`,
			plays: halves.top,
		}, {
			label: `Bottom ${ordinal(shown)} · ${home}`,
			plays: halves.bottom,
		}];
		end = (atBat) => `${atBat.count.outs} out${atBat.count.outs === 1 ? "" : "s"}`;
	}
	const rows = sections.flatMap((section) => section.plays);

	return (
		<Stack gap={16}>
			{/* No waiting first clip (`first`): in Plays the stage shows only once a clip is chosen. */}
			<Box ref={host} style={{
				display: "contents",
			}}>
				<PlayerHost
					video={playing}
					first={undefined}
					onClose={close}
					fromGamePk={game.gamePk}
					scoresHidden={scoresHidden}
					playLink={playing ? videoPlayLink(playing, game) : null}
					stageGame={game}
				/>
			</Box>
			<Linescore linescore={game.linescore} away={away} home={home} hidden={scoresHidden} />
			<Group align="flex-start" gap={8} wrap="nowrap">
				<Stack gap={8} style={{
					flex: 1,
					minWidth: 0,
				}}>
					<SectionHeading>{heading}</SectionHeading>
					{rows.length === 0 ? <Text c="dimmed">No scoring plays yet.</Text> : (
						<PlaysAccordion
							// A new view starts fresh with every row closed (owner, 2026-11-12: "the plays view shouldn't
							// expand any plays by default", over game-rooms DESIGN's open last at-bat). Only a video's play
							// link opens one: the reader asked for that play (S97).
							key={String(shown)}
							plays={plays}
							sections={sections}
							tagged={shown === "runs"}
							end={end}
							scoresHidden={scoresHidden}
							defaultOpen={view === null ? (arrival?.about.atBatIndex ?? null) : null}
							marked={arrival?.about.atBatIndex ?? null}
							clips={clips}
							clipHref={href}
							onPlay={play}
						/>
					)}
				</Stack>
				<InningSidebar innings={innings} view={shown} onChoose={setView} />
			</Group>
		</Stack>
	);
}

/** How long an at-bat takes to open, in ms. */
const OPEN_MS = 200;

/**
 * How many animation frames `item` must sit still, once it has moved, before its scroll
 * counts as over.
 */
const STILL_FRAMES = 3;

/**
 * How many animation frames `item` may sit still before it has moved at all and its
 * scroll still counts as over: a smooth scroll the browser runs off the main thread can
 * take a few frames to start moving the page, and opening before then would open the
 * play mid-scroll. Only a row that can't scroll (one near the bottom of a short page)
 * waits all of them.
 */
const START_FRAMES = 10;

/**
 * Calls `then` once the smooth scroll that brings `item` to the top has finished: on
 * `scrollend`, as soon as `item` reaches the top, once it has moved and then sat still for
 * `STILL_FRAMES` frames, or, if it never moves, after `START_FRAMES` frames. The browser
 * fires no `scrollend` when nothing scrolls (a row near the bottom of a short page can't
 * reach the top) or doesn't support it at all, and waiting out the one-second fallback
 * then made opening a play feel slow (#420). Still frames count as "over" only after a
 * move, because a smooth scroll can start late on screen and the play must not open
 * mid-scroll (owner, 2026-10-29: "The accordion animation is janky because the open one
 * closes while the scrolling animation is happening"). The rules count frames, not time,
 * so a faster screen waits less. The fallback stays only in case frames stop (a hidden
 * tab). Returns a cancel.
 */
function afterScroll(item: Element, then: () => void): () => void
{
	let done = false;
	let frame = 0;
	let last = item.getBoundingClientRect().top;
	let still = 0;
	let moved = false;
	const stop = () =>
	{
		done = true;
		window.clearTimeout(timer);
		window.cancelAnimationFrame(frame);
		window.removeEventListener("scrollend", finish);
	};
	const finish = () =>
	{
		if (done) return;
		stop();
		then();
	};
	const watch = () =>
	{
		const top = item.getBoundingClientRect().top;
		if (top === last) still++;
		else
		{
			still = 0;
			moved = true;
		}
		last = top;
		if (Math.abs(top) < 2 || still >= (moved ? STILL_FRAMES : START_FRAMES)) finish();
		else frame = window.requestAnimationFrame(watch);
	};
	window.addEventListener("scrollend", finish, {
		once: true,
	});
	const timer = window.setTimeout(finish, 1000);
	frame = window.requestAnimationFrame(watch);
	return stop;
}

/**
 * The at-bats as an accordion, one open at a time, in labeled sections. Opening one
 * happens in three steps so nothing moves under the reader at once (owner, 2026-10-29:
 * "Opening an at bat should scroll the accordion item to the top of the screen"; "The
 * accordion animation is janky because the open one closes while the scrolling
 * animation is happening"): the open at-bat closes instantly with the tapped one held
 * where it was on screen, the tapped one scrolls to the top, then it opens — animated when
 * nothing was open, at once when another was, so the close and the open match (#521). Once it's
 * open its pitches replay in turn ("Opening an at bat should animate each pitch in quick
 * succession, starting after the top of screen animation is completed").
 */
function PlaysAccordion({
	plays, sections, tagged, end, defaultOpen, scoresHidden, marked = null, clips = new Map<number, Video>(), clipHref, onPlay,
}: { plays: readonly AtBat[];
	sections: Section[];
	tagged: boolean;
	end: RowEnd;
	defaultOpen: number | null;
	scoresHidden: boolean;
	/** The at-bat a video's play link opened (S97): a bar down its left edge, scrolled into view. */
	marked?: number | null;
	/** Each at-bat's clip, by `atBatIndex`, played from the play button on its row (#422). */
	clips?: ReadonlyMap<number, Video>;
	/** This room with a clip open (`useOpenClip`'s `href`, #424): where a row's play button links. */
	clipHref?: (video: Video) => string;
	/** Called on a press of a row's play button, as its link opens the clip. */
	onPlay?: () => void; })
{
	useEffect(() =>
	{
		if (marked !== null) document.getElementById(`at-bat-${marked}`)?.scrollIntoView?.({
			block: "start",
		});
	}, [marked]);
	const [open, setOpen] = useState<string | null>(defaultOpen === null ? null : String(defaultOpen));
	// 0 while the old at-bat snaps shut; the open animation otherwise.
	const [duration, setDuration] = useState(OPEN_MS);
	// The at-bat being opened, until its pitches start replaying.
	const pending = useRef<string | null>(null);
	// Whether the pending open replaces an at-bat that was open, so it opens at once (#521). A ref,
	// not `open`: a tap mid-switch finds `open` already cleared, yet is still a switch.
	const switching = useRef(false);
	// Which at-bat to replay, and a fresh token each time.
	const [autoplay, setAutoplay] = useState<{ value: string;
		token: number } | null>(null);
	// The at-bat collapsing after a tap on its own header: its contents stay mounted until
	// the collapse ends, so the panel shrinks with them instead of the page jumping (#420).
	const [closing, setClosing] = useState<string | null>(null);
	// The one wait that ends a collapse. A new close or a snap clears the old one first, so
	// a play closed, reopened and closed again keeps its contents through the second collapse.
	const closeTimer = useRef<number | undefined>(undefined);

	// Waits still pending (a scroll's end, the open animation's fallback), cancelled on unmount.
	const waits = useRef<(() => void)[]>([]);
	useEffect(() => () =>
	{
		waits.current.forEach((cancel) => cancel());
		window.clearTimeout(closeTimer.current);
	}, []);
	const later = (run: () => void, ms: number) =>
	{
		const timer = window.setTimeout(run, ms);
		waits.current.push(() => window.clearTimeout(timer));
	};

	const replay = (value: string) =>
	{
		if (pending.current !== value) return;
		pending.current = null;
		setAutoplay((last) => ({
			value,
			token: (last?.token ?? 0) + 1,
		}));
	};

	const choose = (value: string | null) =>
	{
		const wasPending = pending.current !== null;
		pending.current = value;
		const item = value === null ? null : document.getElementById(`at-bat-${value}`);
		if (value === null || !item)
		{
			switching.current = false;
			setDuration(OPEN_MS);
			if (value === null && open !== null)
			{
				// Closing: keep the contents through the collapse, then let them go.
				window.clearTimeout(closeTimer.current);
				setClosing(open);
				closeTimer.current = window.setTimeout(() => setClosing(null), OPEN_MS + 100);
			}
			setOpen(value);
			return;
		}
		// Switching from one open at-bat to another: the new one opens at once too, as the old
		// one closed, since an open animation after an instant close made the page jump (owner,
		// 2026-11-24, #521: "I think we should go with instantly."). A tap while a switch is still
		// scrolling is a switch too. Opening from nothing keeps the animation.
		const instant = open !== null || (wasPending && switching.current);
		switching.current = instant;
		// 1. Close the open at-bat at once, keeping the tapped one where it was on screen
		//    (the closed one above it would otherwise pull it up). One still collapsing
		//    from a close goes at once too, for the same reason.
		const before = item.getBoundingClientRect().top;
		window.clearTimeout(closeTimer.current);
		flushSync(() =>
		{
			setDuration(0);
			setOpen(null);
			setClosing(null);
		});
		window.scrollBy(0, item.getBoundingClientRect().top - before);
		// 2. Scroll it to the top. 3. Then open it; its pitches replay once it's open.
		const opened = () =>
		{
			if (pending.current !== value) return;
			setDuration(instant ? 0 : OPEN_MS);
			setOpen(value);
			// The open animation reports its end (`settled`); this covers reduced motion and an
			// instant open, where there is no animation to end (an instant one replays at once).
			later(() => replay(value), instant ? 0 : OPEN_MS + 400);
		};
		if (Math.abs(item.getBoundingClientRect().top) < 2)
		{
			opened();
			return;
		}
		item.scrollIntoView({
			behavior: "smooth",
			block: "start",
		});
		waits.current.push(afterScroll(item, opened));
	};

	return (
		<Accordion value={open} onChange={choose} variant="separated" transitionDuration={duration}>
			{sections.map((section) => (
				<Fragment key={section.label}>
					{section.label ? <SectionHeading mt={8}>{section.label}</SectionHeading> : null}
					{section.plays.map((atBat) =>
					{
						const value = String(atBat.about.atBatIndex);
						const clip = clips.get(atBat.about.atBatIndex);
						const title = clip ? highlightTitle(clip, scoresHidden) : null;
						// Open, or still collapsing from a close (#420).
						const shown = open === value || closing === value;
						return (
							<Fragment key={value}>
								<Accordion.Item
									id={`at-bat-${value}`}
									value={value}
									data-marked={marked === atBat.about.atBatIndex || undefined}
									style={marked === atBat.about.atBatIndex ? {
										borderLeft: "3px solid var(--bt-primary-light)",
									} : undefined}
								>
									{/* The play button sits beside the toggle, not in it: `Accordion.Control` is a button, which
									    can't hold another, and playing the clip mustn't open the play (#422). */}
									<Group gap={0} wrap="nowrap" align="flex-start">
										<Accordion.Control aria-label={atBatLabel(atBat)} style={{
											flex: 1,
											minWidth: 0,
										}}>
											{shown ? <OpenHeader atBat={atBat} /> : <ClosedRow atBat={atBat} tagged={tagged} end={end} />}
										</Accordion.Control>
										{clip && title && clipHref ? (
											<Tooltip label={title} multiline maw={280}>
												<ActionIcon
													component={Link}
													to={clipHref(clip)}
													replace
													data-testid="play-video"
													aria-label={title}
													variant="subtle"
													color="var(--bt-primary-light)"
													size="lg"
													m={8}
													onClick={() => onPlay?.()}
												>
													<IconPlayerPlayFilled size={18} />
												</ActionIcon>
											</Tooltip>
										) : null}
									</Group>
									<Accordion.Panel onTransitionEnd={() => replay(value)}>
										{/* Only the open at-bat (and one collapsing) is mounted, so a closed one's replay stops with it.
										    `autoplay` is keyed on this row, not on the open one, so its token holds while the row
										    collapses and closing doesn't start the replay again (#420). */}
										{shown ? (
											<AtBatViewer plays={plays} atBat={atBat} autoplay={autoplay?.value === value ? autoplay.token : 0} scoresHidden={scoresHidden} />
										) : null}
									</Accordion.Panel>
								</Accordion.Item>
							</Fragment>
						);
					})}
				</Fragment>
			))}
		</Accordion>
	);
}
