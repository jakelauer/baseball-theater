<!-- Written 2026-11-28 for S256: how supporters fund Baseball Theater and what, if anything, they get. The owner chooses the model from this document (its Question for the owner); docs/v3/PAYMENTS-RESEARCH.md compares the payment providers, a second decision that depends on this one. -->

# How supporters fund Baseball Theater: no perks, one membership or tiers

Researched 2026-11-28 for S256. This is research, not legal advice, as the legal research note it builds on was: it names nothing as settled law, and where it reads the note or the law, it says so. Quotes from the note are its words as the owner read them on 2026-11-28; quotes from the owner are dated.

## What is gated today

Every place BT gates, or plans to gate, anything on support, found in the code and the backlog.

**How it was found.** The flags are the fields of `Entitlements` (`packages/domain/src/types.ts`) other than `tier`. The files that read each flag come from `git grep -l -w <flag> -- packages functions web ':!*.test.ts' ':!*.test.tsx' ':!web/src/api/generated'`, run on commit `166f2278` (`origin/stage` when S256 started); the tests that name each flag are left out (3, 5, 3 and 3 test files for the four flags in the table's order). The tier itself (`PatronTier`) and S215's override were found with `git grep -l -w "PatronTier\|tierOverride\|patron_tier_override\|tier_override" -- packages functions web ':!*.test.ts' ':!*.test.tsx'` on the same commit. The stories come from `pnpm backlog:search text patron`, `pnpm backlog:search text backer`, `pnpm backlog:search text paid` and `pnpm backlog:search text tier` on 2026-11-28, each open match read for whether it gates anything; the closed, superseded and done matches are listed only where they still gate something in the code.

| What | What it gates or plans to gate | Where (files that read it, or the story) | State |
|---|---|---|---|
| `cloudSyncedSettings` | Nothing any more: FEATURES makes cloud-synced settings free for every signed-in user (owner, 2026-10-19; ADR-027), but `entitlementsForTier` still sets it from Backer up | `packages/domain/src/entitlements.ts`, `packages/domain/src/types.ts`, `functions/src/adapters/postgres/repos.ts`, `functions/src/adapters/postgres/schema.ts`, `web/src/test/meApi.ts` (no screen or route reads it) | In code, gates nothing |
| `statsProviderChoice` | S209's stats-site choice: a player's name may open a site other than MLB.com, Backer and up (owner, 2026-11-24: *"Every patron, Backer and up (Recommended)"*) | `packages/domain/src/entitlements.ts`, `packages/domain/src/types.ts`, `packages/domain/src/player-links.ts`, `functions/src/handlers/api.ts`, `functions/src/adapters/memory/repos.ts`, `functions/src/adapters/postgres/repos.ts`, `web/src/pages/SettingsPage.tsx`, `web/src/test/meApi.ts` | Built (S209, done): the one live gate |
| `fasterLiveRefresh` | Nothing: free for every fan since S250 (`FREE_FOR_EVERY_FAN`), kept for compatibility; the live push is the faster refresh | `packages/domain/src/entitlements.ts`, `packages/domain/src/types.ts`, `functions/src/adapters/postgres/repos.ts`, `functions/src/adapters/postgres/schema.ts`, `web/src/test/meApi.ts` | Free (S250, done) |
| `savantLinks` | Nothing: Savant's play and pitch video links are free for every fan since S250 (MLB's video) | `packages/domain/src/entitlements.ts`, `packages/domain/src/types.ts`, `functions/src/adapters/postgres/repos.ts`, `functions/src/adapters/postgres/schema.ts`, `web/src/test/meApi.ts` | Free (S250, done) |
| `PatronTier` and its ranks | The four v2 tiers, `none` → `Backer` → `Pro Backer` → `Star Backer` → `Premium Sponsor`, that every flag above is derived from (`entitlementsForTier`, `effectiveEntitlements`, `hasMinimumTier`, `parsePatronTier`, and `isPatronTier`, which `functions/src/handlers/api.ts` uses to check a tier override's value); stored in the `entitlements` row | `packages/domain/src/entitlements.ts`, `packages/domain/src/types.ts`, `packages/domain/src/api-routes.ts`, `packages/ports/src/auth.ts`, `functions/src/handlers/api.ts`, `functions/src/adapters/memory/repos.ts`, `functions/src/adapters/postgres/repos.ts`, `functions/src/adapters/postgres/schema.ts`, `functions/src/adapters/repository-contract.ts`, `web/src/api/client.ts` | In code; nothing writes a real tier, since the Patreon connector was never built |
| S215's staging tier override | A tester on staging picks the tier BT treats them as; production refuses it on the server. Its own `tier_overrides` table, `GET`/`PUT /api/v1/me/tier-override`, Settings' radio group | `packages/domain/src/entitlements.ts` (`effectiveEntitlements`, `PATRON_TIERS`), `functions/src/adapters/postgres/schema.ts` (`tier_overrides`), `functions/src/services/data-classification.ts`, `web/src/api/tierOverride.ts`, `web/src/pages/settings/TierOverrideControl.tsx` | Built (S215, done) |
| S209's stats-site choice | The same gate as `statsProviderChoice` above, from the story's side: MLB.com for everyone, other sites for any active pledge | S209 (done) | Built |
| S190: next-pitch predictions served live | The prediction is in the game payload only for a session whose entitlements include it, *"Paid tier only"* (owner, 2026-10-29) | S190 (todo), S90's note on the paid tier (todo) | Planned |
| S91: next-pitch odds in the Live room | The screen for S190's prediction, for the paid tier | S91 (todo) | Planned |
| S92: the design of the next-pitch odds | Draws what a viewer without the tier sees | S92 (todo) | Planned |
| S178: the game package | What the AI writes is for patrons, every pledge (owner, 2026-11-23: *"Patrons only"*; 2026-11-24: *"Any patron tier (Recommended)"*); a free session gets `output: null` | S178 (todo) | Planned |
| S179: BT's own recap | Served patrons only, as S178 says | S179 (todo) | Planned |
| S180: the day's round-up | Served patrons only, as S178 says | S180 (todo) | Planned |
| S181: inning notes | Served patrons only, as S178 says | S181 (todo) | Planned |
| S182: explainers | Served patrons only, as S178 says | S182 (todo) | Planned |
| S176: AI groundwork | Leaves "free versus patron outputs" to the stories above; its $100 monthly cap bounds what the AI costs | S176 (todo) | Planned |
| The AI game companion row (FEATURES) | *"What the AI writes is for patrons"* | `docs/v3/FEATURES.md`, New product themes | Planned |
| Push notifications (FEATURES, Later) | FEATURES' Tiers section: *"New gated surfaces (AI depth, push, play theater, etc.) get tiers when those features ship"* | `docs/v3/FEATURES.md`, Push notifications (Later) | Later; no story |
| S258 and S259: former Patreon backers | A former backer links Patreon once and gets *"a great deal or an automatic backer status on the new tiers"* | S258 (todo, design), S259 (todo) | Planned; its benefit turns on this document's answer |

Matches that gate nothing: S6 (done) matched "patron" through its Source, "Settings sync for patrons", which ADR-027 made free for every signed-in fan (the `cloudSyncedSettings` row above); S58 (done) draws the Account section with Patreon not linked and linked with its tier shown, which gates nothing; S177 and S186–S189 say "paid" only of the money a training or test run spends; S235 matched "tier" in another sense. S184 (game chat) was closed with chat on 2026-11-28 and is not listed.

## What the legal note found

The note the owner read on 2026-11-28 (research, not legal advice) found, in its words and as this document reads them:

- **A gift is "detached and disinterested generosity".** Tax law treats a payment as a gift only when nothing comes back for it. A tier that unlocks features is a purchase, whatever the page calls it; Patreon itself collects sales tax on the benefits a membership unlocks.
- **Copyright's commercial-use question** asks whether the user profits from the material without paying the customary price. MLB's notice (`http://gdx.mlb.com/components/copyright.txt`) permits only *"individual, non-commercial, non-bulk use"*.
- **What helps:** a pure tip jar with no perks, or perks that are only BT's own work. It suggested making faster live refresh and the Savant video links free (S250 did, 2026-11-28) and charging for BT's own work, naming the AI companion, the next-pitch model, push and curation.

## The three models

Each model answers under the same five labels. "Perks" are what a supporter gets that a fan who doesn't pay does not.

A choice may change accepted architecture. Retiring or reshaping v2's four tiers (Model A, Model B, or Model C with new tiers) departs from ADR-004's product gates that *"carry v2"* (Backer → Pro → Star → Premium); moving payments off Patreon (PAYMENTS-RESEARCH's provider question) departs from ADR-004 (payments *"Remain on Patreon"*) and ADR-019 (*"payments stay on Patreon"*) and changes ADR-022's *"Patreon webhooks"* dedupe line. Either needs the proposed ADR-019 amendment this story drafts after the provider answer (AC 12), which names the ADR-022 line it changes; accepting it is the owner's decision. Model C keeping v2's four tiers on Patreon departs from none of them.

### Model A: no perks

**Perks:** None. A fan gives once or every month and gets nothing that a fan who gives nothing lacks, apart, perhaps, from a thank-you that unlocks nothing (a name on a thanks page, if the supporter asks for it). Every feature BT builds is free for every fan.

**Legal exposure:** The least of the three, though not none. This is the framing the note found reads most like a donation: nothing unlocked, so no purchase, which is the note's point about "detached and disinterested generosity". BT is not a charity, so a supporter can't deduct it, and BT still has income to report; whether a tip with no perks owes sales tax or VAT is the provider's and the tax adviser's call, not this document's (PAYMENTS-RESEARCH's Tax section). On copyright's commercial-use question, BT sells nothing, so nothing a supporter pays for is built on MLB's material; BT's use of MLB's data and video stays what it is today, a free site.

**Entitlement code:** `PatronTier`, `TIER_RANK`, `entitlementsForTier`, `hasMinimumTier`, `parsePatronTier`, `isPatronTier` and `effectiveEntitlements` have nothing left to decide: every flag is true for every fan. A follow-up story would retire them, keeping only what the spec needs for compatibility (ADR-015: `Entitlements` stays in `GET /api/v1/me`, every flag `true`), retire S215's staging override, its route, its `tier_overrides` table and its Settings control (nothing left to test), and leave the `entitlements` row holding nothing that varies, or drop it in a migration. No provider writes to BT at all, unless a thank-you list is wanted.

**Gated stories:** None gate. S178–S182's AI writing is free for every fan, so S178's planned `canReadAiOutput` check allows everyone or goes (the owner's earlier *"Patrons only"* answer for AI output is replaced); S190, S91 and S92's next-pitch odds are free; push is free; S209's stats-site choice becomes free (a new story, since S209 is done).

**Former backers:** S259 gives a former backer a thank-you: a supporter badge or a credit on a thanks page, by the level they had and for how long, since there is no membership to grant. S259 shrinks to reading the level once and showing the thanks.

### Model B: one membership

**Perks:** One perk set for every member, chosen by the owner from the Candidate perks below; one price, monthly or yearly, with an optional one-off tip beside it that unlocks nothing.

**Legal exposure:** A membership that unlocks features is a purchase, by the note's reading of tax law: sales tax and VAT apply to it, so the provider choice matters (a merchant of record handles that tax; plain Stripe leaves it to BT, PAYMENTS-RESEARCH). On the commercial-use question, the exposure turns on what the perks are: the note found that perks which are only BT's own work help, so the perk set holds only BT's own work, and nothing that sells MLB's data or video as it comes (Excluded, below). Where BT's own work is computed from MLB's data (the AI's writing, the next-pitch odds), the line is the owner's call (Where the line falls).

**Entitlement code:** `PatronTier` becomes two values, `none` and one member value (for example `"Supporter"`); `TIER_RANK` and `PATRON_TIERS` shrink with it; `entitlementsForTier` maps the member value to the chosen perks' flags, and each new perk gets a flag; `isPatronTier` checks the two values; `parsePatronTier`, which reads Patreon's reward titles, is left only for S259's one-time lookup or retired; `effectiveEntitlements` and `FREE_FOR_EVERY_FAN` stay as they are. S215's override offers the two values, and its `tier_overrides` table keeps its shape. The `entitlements` row is written by the provider's webhook (PAYMENTS-RESEARCH, Running it), applied once and in order (ADR-022).

**Gated stories:** S178–S182 gate on membership instead of "any patron tier", through S178's planned `canReadAiOutput` check (the same gate under a new name, if the AI writing is a perk); S190, S91 and S92 gate on membership if the next-pitch odds are a perk, else they turn free; push gates on membership if chosen; S209's stats-site choice either stays gated on membership or turns free (a new story either way, since its gate names Backer).

**Former backers:** S259 grants a former backer membership for a time, longer for a higher old tier or a longer pledge (for example a month per $10 they gave, or a fixed term by level), or a lasting discount; the owner's *"great deal or an automatic backer status"* maps onto either.

### Model C: tiers

**Perks:** Two or more price levels, each with a larger perk set than the one below (cumulative, as v2's were), chosen by the owner from the Candidate perks below.

**Legal exposure:** Model B's, more of it: each tier is a purchase taxed as one, and every tier boundary is one more line between perks to draw and defend as BT's own work. Several prices for more perks also reads most like a store, the reverse of the donation framing the note found helps. The owner's own words lean away from it (*"I'm not sure I even want tiers"*, 2026-11-28).

**Entitlement code:** `PatronTier`, `TIER_RANK` and `PATRON_TIERS` keep their shape with new names and as many ranks as the owner picks; `entitlementsForTier` maps each rank to its flags; `isPatronTier` checks the new names; `hasMinimumTier` stays the one check each gate uses; S215's override offers the new tiers; the `entitlements` row holds the tier the provider's webhook writes, applied once and in order (ADR-022), and a plan change (an upgrade or downgrade mid-period) has to be applied in order too.

**Gated stories:** Each of S178–S182 (through S178's planned `canReadAiOutput` check), S190, S91, S92 and push picks a minimum tier (FEATURES today: *"minimum tier set when it ships"*); S209's stats-site choice gets a new minimum tier (a new story).

**Former backers:** S259 maps each old tier to a new one (for example Backer → the lowest, Premium Sponsor → the highest) for a time, or gives a discount by old tier.

## Candidate perks

For models B and C. Every candidate here is BT's own work in some sense; whether the line the owner draws (Where the line falls) keeps it is asked below. "BT's own work" is the note's sense: the note named the AI companion, the next-pitch model, push and curation as BT's own work to charge for. "Built from MLB's data" is the agent's own observation, not the note's. Costs are a month at **200 supporters**, a number BT doesn't know (nothing in the repository counts Patreon's backers), so every per-supporter figure is an **estimate**, marked as such; figures BT already has are named. Each is held to the owner's rule for anything computed: *"For the computation ones though, I want to focus on performance of the computation. I don't want to end up spending a ton on compute"* (2026-11-28), and to FEATURES' principle that *"patronage should feel like power, not a paywall on the homepage"*.

| Perk | BT's own work (the note) | Built from MLB's data (the agent's observation) | Cost a month at 200 supporters | Compute rule | Power, not a paywall |
|---|---|---|---|---|---|
| AI companion's writing: recaps, the day's round-up, inning notes, explainers (S178–S182) | Yes: the note named the AI companion | Yes: worked from MLB's game data (plays, pitches, scores), though the words are BT's | At most **$100**, S176's monthly AI cap, which bounds it whatever the number of supporters (each piece is written once per game and served from a cache, so readers don't add model calls) | Fits: capped at $100, one write per game, cached | Fits: depth on a game page, nothing taken from the free scoreboard |
| Next-pitch odds in the Live room (S190, S91) | Yes: the note named the next-pitch model | Yes: trained on and run against MLB's pitch data | **Estimate:** a few dollars, since S190 runs the model in a Worker once per pitch of each live game and pushes the result, so cost follows games, not supporters (about 2,400 games a season, about 300 pitches each); training is S90's own budget, `ml/budget.toml`, paid once | Fits if inference stays one small model run per pitch per game, shared by every viewer | Fits: an extra layer in the Live room |
| Push alerts for favorite teams (FEATURES, Later) | Yes: the note named push | Partly: what triggers an alert (a game starting, a lead change) is read from MLB's data; the alert's wording and timing are BT's | **Estimate:** under $1: about 10 alerts a supporter a day, 60,000 Web Push sends a month from a Worker, far inside Workers' paid plan's included requests | Fits: one send per alert, no model | Fits, if free fans keep everything they have today |
| Curation: BT's pick of the day's best clips across the league | Yes: the note named curation | Yes, and the clips themselves are MLB's video, so the perk is the ranking, never the clips (Excluded) | **Estimate:** under $1 for a rules-and-statistics ranking computed once a day; inside the $100 AI cap if a model helps | Fits if computed once a day for everyone | Fits only if the clips stay free and only the pick is the perk; the agent's reading is that this is the closest of these to selling MLB's material |
| Supporter badge or credit (a mark on the account, a name on a thanks page) | Yes: BT's own, nothing computed | No | About $0 | Fits: nothing computed | Fits |
| Early access to new features (a feature reaches members a few weeks first) | Yes: BT's own | Depends on the feature | About $0 beyond the feature's own cost | Fits | Fits, if every feature reaches every fan in the end |
| A vote on what BT builds next | Yes: BT's own | No | About $0 (an occasional poll) | Fits | Fits |
| Choice of stats site for player links (S209, gated today) | Yes: the links are BT's; the sites are others' | No: FanGraphs' and Baseball-Reference's pages, not MLB's | About $0: links built from ids BT stores | Fits | Weak: gating a link to another free site feels like a paywall more than power (the agent's reading) |

## Excluded

A candidate that would sell MLB's data or video as it comes is listed only to say why it is out:

- **The raw feed** (MLB's Stats API data as BT stores it, faster or in bulk): it is MLB's data, which its notice permits only for *"individual, non-commercial, non-bulk use"*; selling access to it is the commercial use the note warns of.
- **MLB's clips** (the highlight and play videos, or a download of them): MLB's video, which S250 already made free for the same reason as the Savant links.
- **Savant's values** (exit velocity, spin rate and the like, as Savant publishes them): MLB's data, as above; S250 made the Savant links free.
- **Faster live refresh:** retired as a perk (S250); the live push every fan gets is the faster refresh.

## Where the line falls

The note drew the line at BT's own work and named the AI companion and the next-pitch model as such. The agent observes that both are computed from MLB's game data: the AI writes about MLB's plays and the model predicts from MLB's pitches. The agent's reading is that a perk is BT's own work when what the supporter receives is something BT made (words BT's model wrote, a prediction BT's model made, a ranking or an alert BT chose to send) and it does not reproduce MLB's values or video; a perk that shows MLB's values or video as they come is MLB's, however it is wrapped. On that reading the AI's writing, the next-pitch odds, push and the badge are BT's own; curation is BT's only while the clips stay free. The owner decides where the line falls (the question below); nothing here is a legal finding.

## Recommendation

**Model B: one membership**, whose perks are only BT's own work on the reading above (the AI companion's writing and the next-pitch odds, with a supporter badge and early access), with a one-off tip beside it that unlocks nothing, and S209's stats-site choice made free.

Why: it keeps the two gates the owner has already chosen (the AI's writing for patrons, the next-pitch odds for the paid tier) as one simple gate, with none of the tier boundaries the owner doubts (*"I'm not sure I even want tiers"*); its perks are the ones the note named as BT's own work; their cost is bounded (the AI by S176's $100 cap, the odds by games, not supporters), which keeps to the owner's compute rule; S259's former-backer benefit becomes "membership for a time", which matches *"an automatic backer status"*; and the entitlement code shrinks rather than grows. Model A is the safer choice legally and the simplest in code, and is the right one if the owner would rather fund BT by goodwill alone and make the AI writing and the odds free; Model C carries the most exposure and work for the least clear gain.

## Question for the owner

**How should supporters fund BT, and what, if anything, do they get?**

1. **Model B: one membership (Recommended).** One price, monthly or yearly, plus an optional one-off tip that unlocks nothing. Members get only BT's own work: the AI companion's writing and the next-pitch odds, a supporter badge and early access to new features. S209's stats-site choice becomes free. Former backers get membership for a time.
2. **Model A: no perks.** One-off or monthly support that unlocks nothing; every feature, the AI writing and the odds included, is free for every fan. Former backers get a thank-you badge or credit. Reads most like a donation.
3. **Model C: tiers.** Two or more prices, each unlocking more. Say how many tiers and which perks go in each.

For B or C, also say **which perks** (from the Candidate perks table: AI writing, next-pitch odds, push alerts, curation, supporter badge, early access, a vote on what's built, the stats-site choice) and **where the line falls**: does BT's own work computed from MLB's data (the AI's writing, the odds) count as BT's own work (the agent's reading, recommended), or only perks with no MLB data in them (the badge, early access, the vote)?

## What follows

Once the owner answers, the coordinator records these with `scripts/audit.sh edit` (this story edits no other story's text and no code). What each says depends on the model chosen:

- **S178** (the game package): its *"Patrons only"* / *"Any patron tier"* access, which its planned `canReadAiOutput` check decides, becomes "members" under B, a minimum tier under C, or "every fan" under A, and its test of a free and a patron session follows.
- **S179, S180, S181, S182** (recap, round-up, inning notes, explainers): their gate and their free-and-patron cache test follow S178's.
- **S176** (AI groundwork): its "free versus patron outputs" note points to the answer.
- **S190** (next-pitch predictions live): its *"Paid tier only"* server check names membership (B), a minimum tier (C), or is removed (A).
- **S91** (next-pitch odds screen): its "paid tier" follows S190.
- **S92** (next-pitch design): what a viewer without the perk sees is drawn only under B or C; under A that frame goes.
- **S90** (next-pitch model): its note on the paid tier follows S190.
- **S259** (former backers): the benefit becomes the answer's (A: a badge or credit; B: membership for a time; C: a tier mapping), and its read of the old level stays.
- **S258** (former-backer design): draws that benefit.
- **A new story for S209's stats-site choice** (S209 is done, so its text is not rewritten): make it free under A (and under B as recommended), or gate it on membership or a minimum tier.
- **A new story for S215's staging tier override** (S215 is done): retire it with its route, table and control under A, or offer the new values under B or C.
- **A new story for the entitlement code**: `PatronTier`, `TIER_RANK`, `entitlementsForTier`, `parsePatronTier` and the `entitlements` row reshaped as the model's Entitlement code says, with `cloudSyncedSettings` (gated in code, free by FEATURES) set true for every fan at the same time.
- **ARCHITECTURE** (this story, after the provider answer): the proposed ADR-019 amendment (AC 12), saying what the choice changes in ADR-004 and, if payments leave Patreon, ADR-022's Patreon-webhooks line.
- **FEATURES** (this story): the Free vs paid and Modern membership rows and the Tiers section say what was chosen, in the owner's words.
