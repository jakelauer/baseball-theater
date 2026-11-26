import {
	Box, Button, Group,
} from "@mantine/core";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import {
	useEffect, useRef, useState,
} from "react";
import type { ReactNode } from "react";
import { fittingFilters } from "./fit-filters.js";

/** Space between pills, in px; the measuring copy and the visible row use the same. */
const GAP = 8;

/**
 * One filter pill (S69; owner, 2026-10-30: "I'd prefer rounded rectangles"): every quick
 * filter, the Filters button and the sort control share this size and shape, so they line
 * up at one height. `active` fills it lightly.
 */
export function FilterPill({
	active = false, children, ...props
}: { active?: boolean;
	children: ReactNode; } & Omit<React.ComponentPropsWithoutRef<typeof Button<"button">>, "children">)
{
	return (
		<Button
			size="compact-sm"
			h={28}
			radius="sm"
			fw={400}
			fz={13}
			variant={active ? "light" : "default"}
			{...props}
			styles={{
				root: {
					flexShrink: 0,
					background: active ? undefined : "transparent",
					borderColor: "var(--mantine-color-dark-4)",
				},
			}}
		>
			{children}
		</Button>
	);
}

/**
 * The quick filters, as many as fit (S69; owner, 2026-10-30). Decided by the row's own
 * width, never by device size: when every pill fits they all show; when not, the ones
 * that fit (`fittingFilters`) show in order and a Filters button comes last, opening `onMore` (the drawer listing
 * every filter). The first pill, the Featured team control, always shows (#583), so the row
 * never narrows below it and the Filters button: its `minWidth`, which lets a wrapping parent
 * row move its other controls to the next line instead of drawing over them. A hidden copy of
 * the pills and the button is measured on every resize, so a pill whose label changes (a
 * team chosen) is re-measured too.
 */
export function QuickFilters({ pills, onMore }: { pills: { key: string;
	node: ReactNode;
	active: boolean; }[];
onMore: () => void; })
{
	const row = useRef<HTMLDivElement>(null);
	const probe = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState<readonly number[] | null>(null);
	const [minWidth, setMinWidth] = useState(0);

	useEffect(() =>
	{
		// Both boxes are mounted by the time an effect runs.
		const rowBox = row.current!;
		const probeBox = probe.current!;
		const measure = () =>
		{
			const items = [...probeBox.children] as HTMLElement[];
			const more = items.pop()!.offsetWidth;
			setShown(fittingFilters(items.map((item) => item.offsetWidth), more, rowBox.clientWidth, GAP));
			// The pinned first pill, plus the Filters button whenever there is a pill it could hold; not
			// whether it shows now, which depends on this width and would make the parent row flicker.
			setMinWidth((items[0]?.offsetWidth ?? 0) + (items.length > 1 ? GAP + more : 0));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(rowBox);
		observer.observe(probeBox);
		return () => observer.disconnect();
	}, [pills.length]);

	const visible = shown ?? pills.map((_, index) => index);
	const more = (
		<FilterPill active={pills.some((pill, index) => pill.active && !visible.includes(index))} leftSection={<IconAdjustmentsHorizontal size={14} />} onClick={onMore}>
			Filters
		</FilterPill>
	);
	return (
		<Box ref={row} pos="relative" style={{
			flex: 1,
			minWidth,
		}}
		>
			<Group gap={GAP} wrap="nowrap" data-testid="filter-row">
				{visible.map((index) => <Box key={pills[index]!.key}>{pills[index]!.node}</Box>)}
				{visible.length < pills.length ? more : null}
			</Group>
			{/* The measuring copy: laid out at natural width, never seen or reached. */}
			<Group
				ref={probe}
				gap={GAP}
				wrap="nowrap"
				aria-hidden
				inert
				pos="absolute"
				top={0}
				left={0}
				style={{
					visibility: "hidden",
					pointerEvents: "none",
					width: "max-content",
				}}
			>
				{pills.map((pill) => <Box key={pill.key}>{pill.node}</Box>)}
				{more}
			</Group>
		</Box>
	);
}
