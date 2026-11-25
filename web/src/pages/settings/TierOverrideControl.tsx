import type { PatronTier } from "@bt/domain";
import { PATRON_TIERS } from "@bt/domain";
import { Radio, Stack } from "@mantine/core";
import { useSetTierOverride, useTierOverride } from "../../api/tierOverride.js";

/** The choice that clears the override, so the real tier stands (`{ tier: null }`). */
const REAL = "real";

/** Each choice's words: the real tier, "Not a patron" (`none`), then the four backer tiers by name. */
function choiceLabel(tier: PatronTier): string
{
	return tier === "none" ? "Not a patron" : tier;
}

/**
 * Staging's backer tier override (S215), for testing only: a plain, clearly labelled control from
 * Mantine's existing components, with no design (the owner's exemption, 2026-11-24: "Skip the
 * design (Recommended)"), since fans never see it. It renders only when the server answers
 * `GET /api/v1/me/tier-override` with a 200, which only staging's deploy-time config allows;
 * production answers 404, so production refuses the override on the server (not by this page
 * hiding it), and while loading, on a 404 or a failed request it renders nothing and takes no
 * space. Choosing a tier changes only what this test site shows: never the real tier or Patreon.
 */
export function TierOverrideControl()
{
	const { data } = useTierOverride();
	const setTier = useSetTierOverride();
	if (!data) return null;
	// While a choice is saving it shows as chosen; then the server's answer does.
	const chosen = setTier.isPending ? setTier.variables : data.tier;
	return (
		<Radio.Group
			label="Testing only (staging): backer tier override"
			description="Changes only what this test site shows. Your real tier and Patreon are never changed."
			value={chosen ?? REAL}
			onChange={(choice) => setTier.mutate(choice === REAL ? null : choice as PatronTier)}
		>
			<Stack gap="xs" mt="xs">
				<Radio value={REAL} label={`Use my real Patreon tier (${choiceLabel(data.realTier)})`} disabled={setTier.isPending} />
				{PATRON_TIERS.map((tier) => <Radio key={tier} value={tier} label={choiceLabel(tier)} disabled={setTier.isPending} />)}
			</Stack>
		</Radio.Group>
	);
}
