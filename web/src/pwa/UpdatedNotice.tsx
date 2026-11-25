import {
	Modal, Paper, Transition,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import {
	useEffect, useRef, useState,
} from "react";
import type { LayoutVariant } from "../layout/variant.js";
import { ChangelogPage } from "../pages/ChangelogPage.js";
import type { AfterUpdate } from "./afterUpdate.js";
import { PointerBody } from "./afterUpdate.js";

/** A notice fading out has no time left. */
const fadingOut = () => 0;

/**
 * The after-update notice on a game page at mobile and medium widths (S193; shell-scoreboard A17
 * `game-updated-notice-*`, Figma `after-update-pointer` `Arrow=None, Link=Yes` 778:25455). There the
 * game's top bar replaces the app header, so A9's pointer has no menu button to aim at; the shell draws
 * this in its place (`AppShellLayout`). It is A9's popover without its arrow, its words, link line and
 * countdown line (`PointerBody`), 264px wide, floating at the bottom right 16px from the edges on mobile
 * and 24px on medium, where A6's update notice sat. The whole of it is one tap target that ends the
 * after-update moment (`pointer.end`) and opens the change log over the game page (`onOpen`); its
 * "Open the changelog" does the same, never the `/changelog` page. A9's other rules come with `pointer`
 * (`useAfterUpdate`): never while A6's box is up, the 10 seconds it has left, once per release. It fades
 * as A9's pointer does, and under reduced motion neither fades nor draws the countdown line.
 */
export function UpdatedNotice({
	pointer, variant, onOpen,
}: {
	pointer: AfterUpdate | null;
	variant: LayoutVariant;
	onOpen: () => void;
})
{
	const reduceMotion = useReducedMotion() === true;
	// Kept while it fades out, after `pointer` has already gone.
	const [release, setRelease] = useState<string | null>(null);
	if (pointer && pointer.release !== release) setRelease(pointer.release);
	const inset = variant === "mobile" ? 16 : 24;
	const open = () =>
	{
		if (!pointer) return;
		pointer.end();
		onOpen();
	};
	return (
		<Transition mounted={pointer !== null} transition="fade" duration={reduceMotion ? 0 : 150}>
			{(styles) => (release === null ? <></> : (
				<Paper
					data-testid="after-update-notice"
					role="status"
					onClick={open}
					w={264}
					radius={8}
					shadow="md"
					bg="var(--bt-raised)"
					withBorder
					style={{
						...styles,
						borderColor: "var(--bt-hairline)",
						cursor: "pointer",
						position: "fixed",
						right: inset,
						bottom: `calc(${inset}px + env(safe-area-inset-bottom, 0px))`,
						zIndex: 150,
					}}
				>
					<PointerBody release={release} timeLeft={pointer?.timeLeft ?? fadingOut} link="button" reduceMotion={reduceMotion} />
				</Paper>
			))}
		</Transition>
	);
}

/** Marks the history entry the modal adds, so Back closes it (A17, "How it closes"). */
const MODAL_ENTRY = "btChangelogModal";

function onModalEntry(): boolean
{
	const state: unknown = window.history.state;
	return typeof state === "object" && state !== null && MODAL_ENTRY in state;
}

/**
 * The change log over the game page (S193; shell-scoreboard A17 `game-updated-changelog-*`, Figma
 * `changelog-modal` 778:26305): Mantine's `Modal` holding S134's `ChangelogPage`, the same component and
 * request as the `/changelog` page, its states (releases, loading, empty, error with Retry) included, so
 * nothing of the page is copied. On mobile a card inset 16px from the screen's edges under the game's
 * 56px top bar; on medium a centered dialog 688px wide, 80px from the top; both Raised with 12px corners,
 * a hairline edge and a soft shadow, over A8's 70% Dark scrim, scrolling inside. The game page stays
 * under it, its live updates still arriving.
 *
 * It closes on its ✕ (the title row's, `ChangelogPage`'s `onClose`), a tap on the scrim, Escape, and
 * the phone's Back, which closes it and stays on the game page. For Back, opening it adds a history
 * entry for the same URL (the router's own state kept, so the router sees the same location when it is
 * popped), and Back pops it; closing it any other way pops that entry too, so the next Back leaves the
 * game page for the page before it, with no stop on a leftover entry. The URL never changes. It has no
 * timer, and A6's update notice coming up leaves it open (A17, "A9's other rules"): that is why the
 * shell, not the notice, holds whether it is open.
 */
export function ChangelogModal({
	opened, onClose, variant,
}: {
	opened: boolean;
	onClose: () => void;
	variant: LayoutVariant;
})
{
	const reduceMotion = useReducedMotion() === true;
	// The latest `onClose`, so the Back listener below needn't be re-added when the shell re-renders.
	// It must not be: Back's popstate re-renders the shell (the router's location) between its
	// listeners, and a listener removed and re-added then misses that event.
	const closeRef = useRef(onClose);
	useEffect(() =>
	{
		closeRef.current = onClose;
	});
	// One entry per opening, keyed on `opened` alone; the check covers the effect running twice in development.
	useEffect(() =>
	{
		if (!opened) return;
		if (!onModalEntry())
		{
			const state: unknown = window.history.state;
			window.history.pushState({
				...(typeof state === "object" && state !== null ? state : {}),
				[MODAL_ENTRY]: true,
			}, "");
		}
		const onPop = () =>
		{
			if (!onModalEntry()) closeRef.current();
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, [opened]);
	const dismiss = () =>
	{
		onClose();
		if (onModalEntry()) window.history.back();
	};
	const mobile = variant === "mobile";
	return (
		<Modal
			opened={opened}
			onClose={dismiss}
			withCloseButton={false}
			size={mobile ? "100%" : 688}
			radius={12}
			padding={mobile ? 16 : 24}
			shadow="xl"
			overlayProps={{
				backgroundOpacity: 0.7,
				color: "var(--bt-dark)",
			}}
			transitionProps={reduceMotion ? {
				duration: 0,
			} : {
				transition: "pop",
				duration: 200,
			}}
			styles={{
				// Mobile: 16px under the 56px top bar and 16px from the other edges; medium: A17's 80px top, 56px foot.
				inner: {
					padding: mobile ? "72px 16px calc(16px + env(safe-area-inset-bottom, 0px))" : "80px 0 56px",
				},
				content: {
					height: "100%",
					maxHeight: "100%",
					background: "var(--bt-raised)",
					border: "1px solid var(--bt-hairline)",
				},
			}}
		>
			{/* Focus lands on the modal itself, not its ✕, so no focus ring shows on opening (A17 draws none); Tab reaches the ✕. */}
			<div data-testid="changelog-modal" data-autofocus tabIndex={-1} style={{
				outline: "none",
			}}>
				<ChangelogPage onClose={dismiss} />
			</div>
		</Modal>
	);
}
