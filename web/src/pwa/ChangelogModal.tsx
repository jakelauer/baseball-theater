import { Modal } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useEffect, useRef } from "react";
import type { LayoutVariant } from "../layout/variant.js";
import { ChangelogPage } from "../pages/ChangelogPage.js";

/** Where focus goes once the modal has closed: the page's first control (on a game page, the top bar's back link). */
function focusPage(): void
{
	document.querySelector<HTMLElement>("main a[href], main button")?.focus();
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
 * shell, not the notice, holds whether it is open. Focus can't go back to the notice that opened it (it
 * has gone), so on closing it goes to the page's first control, the game top bar's back link (`<main>`'s
 * first link or button), rather than being dropped to the document.
 *
 * This module, the change log page with it, is loaded only when the modal first opens (`AppShellLayout`
 * lazy-loads it), so neither is in the entry chunk, as `routes.tsx` keeps the page out (S110).
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
			returnFocus={false}
			onExitTransitionEnd={focusPage}
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
