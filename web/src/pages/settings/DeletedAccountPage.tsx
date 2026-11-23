import { Stack, Text } from "@mantine/core";
import type { SetFooterMode } from "../../layout/footerMode.js";
import { useFooterMode } from "../../layout/footerMode.js";

/**
 * What `/settings` shows once, right after an account is deleted (S79, to
 * standings-search-settings A5): an otherwise blank page with one line — no
 * dismiss, no action, no footer (owner, 2026-10-29: "the deletion message should
 * be on an otherwise blank page. Not dismissable. It should be the settings page").
 * The app's signed-out chrome stays around it; the shell's site footer does not (A5; A14
 * Where it shows), so the page switches it off through `setFooter` while it shows (S142).
 */
export function DeletedAccountPage({ setFooter }: { setFooter?: SetFooterMode })
{
	useFooterMode(setFooter, "none");
	return (
		<Stack align="center" pt={160} px="md">
			<Text fz={16} c="var(--bt-light)" ta="center">
				Your account and your data are deleted.
			</Text>
		</Stack>
	);
}
