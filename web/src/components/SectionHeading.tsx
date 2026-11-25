import { Text } from "@mantine/core";
import type { TextProps } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * A section's header inside a page or room: bold, uppercase, at body size (Mantine `md`, the size
 * `Text` and the page body draw). The one implementation every section header uses (ADR-025), so no
 * header is drawn smaller than the text under it (B527, #527; owner, 2026-11-24: "The headers are
 * smaller than the body text, and they shouldn't be."). The frames drew these at 11–12px; the owner's
 * words replace that size, not the bold uppercase treatment. Callers may set colour and spacing, never
 * the size.
 */
export function SectionHeading({ children, ...props }: Omit<TextProps, "size" | "fz"> & { children: ReactNode })
{
	return (
		<Text size="md" fw={700} tt="uppercase" {...props}>
			{children}
		</Text>
	);
}
