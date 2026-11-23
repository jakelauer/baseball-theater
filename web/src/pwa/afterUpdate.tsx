import {
	Anchor, Popover, Progress, Text,
} from "@mantine/core";
import type { FloatingPosition } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { compareReleaseVersions, parseReleaseVersion } from "@bt/domain";
import {
	useEffect, useId, useState,
} from "react";
import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { CHANGELOG_PATH, isChangelog } from "../layout/nav.js";
import { readStored, writeStored } from "../storage/storage.js";

/** How long the pointer stays (shell-scoreboard A9; owner, 2026-11-10: "that one should disappear with a quick timer, like 10 seconds"). */
export const POINTER_MS = 10_000;

/**
 * Whether this load comes right after an update, and records this load's release (S135 AC 3). Every
 * load of a build whose release is known (`knownRelease`, `web/src/layout/version.ts`) writes it to
 * `bt.lastRelease`; the release is returned (the pointer shows) only when the recorded one is a
 * release version and this one is newer by S131's `compareReleaseVersions`, so `v3.10.0` follows
 * `v3.9.0`. A first visit, a recorded value `parseReleaseVersion` rejects (overwritten here), the
 * same release, an older one (a rollback) and a build with no known release return null, and a
 * build with none records nothing. Storage that throws reads as nothing recorded (`readStored`),
 * so nothing shows; a write that throws is lost, so the pointer may show again on the next load.
 */
export function checkAfterUpdate(release: string | null): string | null
{
	if (!release) return null;
	const recorded = readStored("bt.lastRelease");
	writeStored("bt.lastRelease", release);
	if (!recorded || !parseReleaseVersion(recorded)) return null;
	return compareReleaseVersions(release, recorded) > 0 ? release : null;
}

const CHANGED = "bt:after-update-changed";

/** The release the pointer announces on this load, or null; module state, as `updates.ts` keeps the waiting worker. */
let announced: string | null = null;
/** Set once the pointer has gone (its time, a click, the drawer, A6's box): it never comes back on this load. */
let ended = false;

function changed(): void
{
	window.dispatchEvent(new Event(CHANGED));
}

/** Ends the pointer for this load (A9: "a pointer that was showing goes at once and doesn't come back on that load"). */
function endPointer(): void
{
	if (ended) return;
	ended = true;
	changed();
}

/** Runs once at startup (`main.tsx`) with this build's known release: records it, and arms the pointer when it is newer. */
export function startAfterUpdate(release: string | null): void
{
	announced = checkAfterUpdate(release);
	ended = false;
	changed();
}

/**
 * Development only: shows the pointer as a load right after updating to `release` would, without
 * touching storage. The dev server's build has no known release (`dev`), so the design captures
 * (`e2e/design/S135.spec.ts`) reach the pointer through this, as S73's reach the notice through `btShowUpdate`.
 */
export function exposeDevUpdatedTrigger(): void
{
	(window as { btShowUpdated?: (release: string) => void }).btShowUpdated = (release) =>
	{
		announced = release;
		ended = false;
		changed();
	};
}

/** The pointer while it shows: the release it names, and how the shell ends it (the drawer opening). */
export interface AfterUpdate
{
	release: string;
	end: () => void;
}

/**
 * The after-update pointer's state for the shell (S135 AC 3). Null when no update just happened, once
 * it has gone, and whenever A6's box is up (`updateUp`): the box wins whichever came first (owner,
 * 2026-11-10: "we'd just show the update notice and no post-update notice"), and a pointer the box
 * meets ends for this load, so neither Snooze nor the end of its 10 seconds brings it back. Its 10
 * seconds run from the load (the shell's first render with it armed, at startup) and never pause
 * (owner, 2026-11-16: "don't pause on hover").
 */
export function useAfterUpdate(updateUp: boolean): AfterUpdate | null
{
	const [, rerender] = useState(0);
	useEffect(() =>
	{
		const onChanged = () => rerender((n) => n + 1);
		window.addEventListener(CHANGED, onChanged);
		return () => window.removeEventListener(CHANGED, onChanged);
	}, []);
	const armed = announced !== null && !ended;
	useEffect(() =>
	{
		if (!armed) return;
		if (updateUp)
		{
			endPointer();
			return;
		}
		const timer = setTimeout(endPointer, POINTER_MS);
		return () => clearTimeout(timer);
	}, [armed, updateUp]);
	if (!armed || updateUp || announced === null) return null;
	return {
		release: announced,
		end: endPointer,
	};
}

/** Tests only: forget the pointer between cases. */
export function resetAfterUpdate(): void
{
	announced = null;
	ended = false;
}

/**
 * The pointer itself (Figma `after-update-pointer` 651:13439; A9's `updated-pointer-*` frames): Mantine's
 * `Popover` with its arrow, opened on `children`, the menu's change log link (rail) or the menu button
 * (drawer layouts), as the shell chooses by its `LayoutVariant`. A Raised popover 264px wide with a
 * hairline edge and 8px corners: "Update complete", "You're on <release>. What changed is in the
 * changelog." and the link "Open the changelog" (`Link=Yes`); on the change log page "… What changed is
 * on this page." and no link (`Link=No`). A 2px countdown line along its foot shrinks over the 10 seconds.
 * It has no ✕; a click anywhere on it ends it (its link still opens the page). Under reduced motion it
 * neither fades nor slides and draws no countdown line, though the 10 seconds still run. With no
 * `pointer` it draws `children` alone, closed. The target gets none of Popover's dialog roles (it
 * opens nothing when pressed); while the pointer shows it is described by it (`aria-describedby`).
 */
export function AfterUpdatePointer({
	pointer, position, offset, children,
}: {
	pointer: AfterUpdate | null;
	position: FloatingPosition;
	/** The gap from the target to the popover's edge, so the frames' spacing holds (A9: the rail's 11px past its edge; 1px under the menu button). */
	offset: number;
	children: ReactElement;
})
{
	const reduceMotion = useReducedMotion() === true;
	const onChangelog = isChangelog(useLocation().pathname);
	const id = useId();
	return (
		<Popover
			id={id}
			withRoles={false}
			opened={pointer !== null}
			position={position}
			offset={offset}
			withArrow
			arrowSize={10}
			arrowOffset={14}
			width={264}
			radius={8}
			shadow="md"
			zIndex={150}
			transitionProps={reduceMotion ? {
				duration: 0,
			} : {
				transition: "fade",
				duration: 150,
			}}
		>
			<Popover.Target aria-describedby={pointer ? `${id}-dropdown` : undefined}>{children}</Popover.Target>
			<Popover.Dropdown
				id={`${id}-dropdown`}
				data-testid="after-update-pointer"
				role="status"
				onClick={pointer?.end}
				p={0}
				bg="var(--bt-raised)"
				style={{
					borderColor: "var(--bt-hairline)",
				}}
			>
				{pointer ? <PointerBody release={pointer.release} onChangelog={onChangelog} reduceMotion={reduceMotion} /> : null}
			</Popover.Dropdown>
		</Popover>
	);
}

/** The popover's words and its countdown line (A9 `after-update-pointer`). */
function PointerBody({
	release, onChangelog, reduceMotion,
}: {
	release: string;
	onChangelog: boolean;
	reduceMotion: boolean;
})
{
	return (
		<>
			<div style={{
				padding: "12px 14px 14px",
			}}>
				<Text fz={14} fw={600} c="var(--bt-light)">Update complete</Text>
				<Text fz={13} lh={1.3} c="var(--bt-muted)" mt={4}>
					{onChangelog ? `You're on ${release}. What changed is on this page.` : `You're on ${release}. What changed is in the changelog.`}
				</Text>
				{onChangelog ? null : (
					<Anchor component={Link} to={CHANGELOG_PATH} fz={13} fw={600} c="var(--bt-primary-light)" underline="never" lh={1.3} mt={4} display="inline-block">
						Open the changelog
					</Anchor>
				)}
			</div>
			{reduceMotion ? null : <Countdown />}
		</>
	);
}

/** A9's 2px countdown line: Primary Light over a hairline track, shrinking to nothing over `POINTER_MS`. */
function Countdown()
{
	const [value, setValue] = useState(100);
	// Start full, then let the bar's own transition run it down: one state change, no ticking timer.
	useEffect(() =>
	{
		const frame = requestAnimationFrame(() => setValue(0));
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<Progress
			data-testid="pointer-countdown"
			value={value}
			size={2}
			radius={0}
			color="var(--bt-primary-light)"
			bg="var(--bt-hairline)"
			transitionDuration={POINTER_MS}
			styles={{
				section: {
					transitionTimingFunction: "linear",
				},
			}}
			mx={14}
			mb={1}
		/>
	);
}
