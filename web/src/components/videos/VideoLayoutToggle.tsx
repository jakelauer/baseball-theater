import { SegmentedControl, VisuallyHidden } from "@mantine/core";
import { IconLayoutGrid, IconList } from "@tabler/icons-react";

/** How a list of clips is drawn: `VideoGrid`'s columns of cards, or the same `VideoCard`s as rows. */
export type VideoLayout = "grid" | "list";

/**
 * The Grid / List icons (owner, 2026-10-30), one segmented control labelled "Layout" whose
 * options read Grid and List to a screen reader. The Videos room (S69) and Search (#588; owner,
 * 2026-11-25: search results "should offer the option to show as a grid or a list") both offer
 * it, so the two switch alike; each keeps its own choice in `useState`.
 */
export function VideoLayoutToggle({ value, onChange }: { value: VideoLayout;
	onChange: (layout: VideoLayout) => void; })
{
	return (
		<SegmentedControl
			size="xs"
			aria-label="Layout"
			color="primary"
			value={value}
			onChange={(next) => onChange(next as VideoLayout)}
			style={{
				flexShrink: 0,
			}}
			data={[
				{
					value: "grid",
					label: <><IconLayoutGrid size={16} style={{
						display: "block",
					}}
					/><VisuallyHidden>Grid</VisuallyHidden></>,
				},
				{
					value: "list",
					label: <><IconList size={16} style={{
						display: "block",
					}}
					/><VisuallyHidden>List</VisuallyHidden></>,
				},
			]}
		/>
	);
}
