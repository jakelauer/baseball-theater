import {
	Badge, Box, CloseButton, Divider, Group, Stack, Text, Title,
} from "@mantine/core";
import { Fragment } from "react";
import type { PublicRelease } from "../api/releases.js";
import { useReleases } from "../api/releases.js";
import { ViewState } from "../components/ViewState.js";
import { queryScreen } from "../components/queryScreen.js";
import { formatDate } from "../format/datetime.js";
import type { SetFooterMode } from "../layout/footerMode.js";
import { useFooterMode } from "../layout/footerMode.js";

/**
 * The words on each item's kind label (shell-scoreboard A9, Q8 and Q12), one per S131 kind. A tab
 * built before a kind was added can still be served it by a newer API, so the page falls back to the
 * kind's own word rather than an empty label. `satisfies` still fails the type check when a known
 * kind has no word.
 */
const KIND_LABEL: Partial<Record<string, string>> = {
	feature: "Feature",
	enhancement: "Enhancement",
	performance: "Performance",
	fix: "Bug fix",
} satisfies Record<PublicRelease["items"][number]["kind"], string>;

/**
 * One release as A9's `changelog-*` frames draw it: its version (SemiBold 20) with its date beside it
 * (muted 13, `formatDate`, so `2026-11-24` reads "Nov 24, 2026" wherever the reader is; a release
 * with no date shows its version alone); each headline addition under its own gold "Major Feature"
 * header with no box around it (owner, 2026-11-10); each other item under its kind label, every
 * label in one neutral style (Figma `kind-label` 763:16423); then the one "Fixes and polish" line
 * when the notes have one. Long titles and sentences wrap, even an unbroken URL; nothing is cut.
 * Entries are keyed by position, since the notes may repeat a title within a bucket.
 */
function Release({ release }: { release: PublicRelease })
{
	return (
		<Stack gap={14} component="section" aria-label={release.version} data-testid="release" style={{
			// A9: "Long titles and sentences wrap; nothing is cut", a long unbroken URL included.
			overflowWrap: "anywhere",
		}}>
			<Group gap={10} align="baseline">
				<Title order={2} fz={20} fw={600}>
					{release.version}
				</Title>
				{release.date ? (
					<Text fz={13} c="var(--bt-muted)" data-testid="release-date">
						{formatDate(release.date)}
					</Text>
				) : null}
			</Group>
			{release.headline.map((entry, i) => (
				<Stack key={i} gap={2} data-testid="major-feature">
					<Text fz={12} fw={700} tt="uppercase" lts={0.6} c="var(--bt-accent)">
						Major Feature
					</Text>
					<Title order={3} fz={17} fw={600}>
						{entry.title}
					</Title>
					<Text fz={14}>{entry.sentence}</Text>
				</Stack>
			))}
			{release.items.map((item, i) => (
				<Stack key={`${item.kind}:${i}`} gap={2} align="flex-start" data-testid="release-item">
					<Badge
						data-testid="kind-label"
						data-kind={item.kind}
						radius={4}
						size="sm"
						fz={11}
						fw={600}
						tt="uppercase"
						styles={{
							root: {
								background: "var(--bt-raised-current)",
								color: "var(--bt-light)",
							},
						}}
					>
						{KIND_LABEL[item.kind] ?? item.kind}
					</Badge>
					<Title order={3} fz={14} fw={600}>
						{item.title}
					</Title>
					<Text fz={14} c="var(--bt-muted)">
						{item.sentence}
					</Text>
				</Stack>
			))}
			{release.fixesAndPolish ? (
				<Stack gap={2} data-testid="fixes-and-polish">
					<Text fz={13} fw={600} c="var(--bt-muted)">
						Fixes and polish
					</Text>
					<Text fz={14} c="var(--bt-muted)">
						{release.fixesAndPolish}
					</Text>
				</Stack>
			) : null}
		</Stack>
	);
}

/**
 * The change log (S134; shell-scoreboard A9 `changelog-*`): every approved release's notes, newest
 * first as the API serves them (S132), in a column at most 640px wide under the Standings page's
 * title style, a hairline between releases and no "Fetched … ago" line (owner, 2026-11-10). The
 * list starts with the public launch release, v4.0.0 (S131 AC 6), so until its notes land the API
 * answers an empty list, which is the empty state. Loading, empty and error are `ViewState`'s, the
 * title kept above each. Release notes carry no scores, so Hide Scores changes nothing here.
 *
 * The same component is the change log modal's body over a game page (S193; shell-scoreboard A17's
 * `changelog-modal`, which places A9's `changelog-heading` and `changelog-body` rather than redrawing
 * them): given `onClose`, the title row carries A8's ✕ at its right, which calls it. The modal passes no
 * `setFooter`, so it leaves the shell's footer alone.
 */
export function ChangelogPage({ setFooter, onClose }: { setFooter?: SetFooterMode;
	onClose?: () => void; })
{
	const {
		data, error, refetch,
	} = useReleases();

	let body;
	// As every page: notes already shown stay shown if a later refetch fails (S28's one rule).
	const screen = queryScreen({
		data,
		error,
	});
	// No shell footer while the notes load, so it never jumps (S142; `FooterMode`).
	useFooterMode(setFooter, screen === "error" || (screen !== "loading" && data) ? "plain" : "none");
	if (screen === "error")
	{
		body = <ViewState kind="error" title="Couldn't load the change log" onRetry={() => void refetch()} />;
	}
	else if (screen === "loading" || !data)
	{
		// Release notes are prose: a heading over lines (B584, #584).
		body = <ViewState kind="loading" shape="text" />;
	}
	else if (data.releases.length === 0)
	{
		body = <ViewState kind="empty" message="No release notes yet." />;
	}
	else
	{
		body = (
			<Stack gap={28} maw={640}>
				{data.releases.map((release, i) => (
					<Fragment key={release.version}>
						{i > 0 ? <Divider color="var(--bt-hairline)" /> : null}
						<Release release={release} />
					</Fragment>
				))}
			</Stack>
		);
	}

	return (
		<Stack gap="lg">
			{onClose ? (
				<Group justify="space-between" wrap="nowrap" align="center">
					<Title order={1}>Changelog</Title>
					<CloseButton size="md" aria-label="Close the change log" onClick={onClose} />
				</Group>
			) : <Title order={1}>Changelog</Title>}
			<Box>{body}</Box>
		</Stack>
	);
}
