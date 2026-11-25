import { Paper, Transition } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useState } from "react";
import type { LayoutVariant } from "../layout/variant.js";
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
 * and 24px on medium, where A6's update notice sat. The whole of it is one button, reached by Tab and
 * pressed by a tap, Enter or Space, that ends the after-update moment (`pointer.end`) and opens the change
 * log over the game page (`onOpen`); its "Open the changelog" is part of that button, never a link to the
 * `/changelog` page. A live region around it announces it as A9's pointer is announced. A9's other rules come with `pointer`
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
				<div
					data-testid="after-update-notice"
					role="status"
					style={{
						...styles,
						position: "fixed",
						right: inset,
						bottom: `calc(${inset}px + env(safe-area-inset-bottom, 0px))`,
						zIndex: 150,
					}}
				>
					<Paper
						component="button"
						type="button"
						onClick={open}
						w={264}
						p={0}
						radius={8}
						shadow="md"
						bg="var(--bt-raised)"
						withBorder
						style={{
							borderColor: "var(--bt-hairline)",
							cursor: "pointer",
							display: "block",
							textAlign: "left",
							font: "inherit",
							color: "inherit",
						}}
					>
						<PointerBody release={release} timeLeft={pointer?.timeLeft ?? fadingOut} link="inline" reduceMotion={reduceMotion} />
					</Paper>
				</div>
			))}
		</Transition>
	);
}
