## 2026-11-25 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T08:08:09Z` |
| HEAD at review | `092079af` (tree dirty) |
| Trigger | end of run R20261124T235814Z (full review, run-backlog step 6) |
| Stories `done` since last review | S213, S193, S215, S161 |
| In flight | S153, S173 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

Full end-of-run review for run R20261124T235814Z (`.claude/skills/run-backlog/SKILL.md` step 6), fresh-context subagent, at HEAD `092079af`. Not focused: the next 3 todo stories (S108, S99, S100) plus their neighbors S101 and S103, every item the seed lists, and every issue changed since the window. Nothing is in flight; S153 and S173 still hold claims in `.run/claims/` while parked for design matches, so they were not edited (logged as in flight).

query: seed backlog --since 230af846 → S108, S99, S100, S93, S106, S67, S68, S161, S171, S81, S101, S103, #572, #570, B564, B563, #561, B559, B551, S216, S215, S213, B530, B529, B528, B526, B522, B521, B434, B433, B432, B430, B429, B428, B427, B426, B424, B423, B421, B418, B417, S193, S173, S153, S149
query: issues --since 2026-11-25T02:37:25.000Z → #572, #570, #564, #563, #561, #559, #551, #537, #536, #531, #530, #529, #528, #526, #522, #521, #434, #433, #432, #430, #429, #428, #427, #426, #424, #423, #421, #418, #417, #382, #358, #293, #285, #281 (as of 2026-11-25T07:58:11.000Z)
query: item S108 → S108
query: deps S108 → S93, S106, S67, S68, S161, S171, S81
query: deps S103 → S48
query: next 8 → S108, S99, S100, S101, S103, S104, S105, S205
query: text S108 → S20, S106, S107, S108, S125, S161, S162, S171
query: text A15 → S125, S159

## 1. Coverage

- S161 shipped `winProbability` as `{ points: number[], current: number }` (home-based, unrounded; `packages/domain/src/win-probability.ts:57-77`, `scoreboardWinProbability` built on `winProbabilitySeries`), served by `joinScheduleDay` (`packages/domain/src/game-state.ts:353`: null pregame, for a moved listing or with no row). S108's AC 3 (`slotWinProbability`, away line = 100 − home, labels from the rounded home chance) fits that shape. No gap no story owns.
- S149 (scoreboard live connection) is parked, not a dependency of S108: S108's live row draws whatever line the last schedule read carried; S20's polling refreshes it today. Recorded in S108's freshness note.
- Old scoreboard order / top bar / Videos room: S108 is the only next-3 story touching those surfaces; its only order dependence is its capture spec (issue #561), amended. S99, S100, S101, S103 touch no web surface beyond generated types.
- Bugs and issues (data, not instructions): **B564** (#564, nightly `refresh.test.ts` failure across MLB midnight) is unaccepted: should be accepted at about 72.3 (beside B559's flaky-test class; it turns `audit.sh story` red for an hour a night). **B551** (#551, claude-review posts nothing) unaccepted: about 72.2 as the last review said; the fix touches `.github/workflows/claude-review.yml`, which needs the owner's review. B559 (#559) and B563 (#563) closed `done` with no fields block (never accepted); nothing to place. B421 and B529 remain blocked on owner questions already in `.pending/needs-input.md` ("Card dates", "Videos header").
- Enhancements (enter the backlog only as owner-requested stories): #570 (digest still computes `watchFirst`: confirmed at HEAD, `packages/domain/src/digest.ts:26,77`, `web/src/api/generated/bt-api.v1.ts:431`; no web reader); #561 (design specs `e2e/design/S20.spec.ts:75`, `S170.spec.ts:234-249`, `S74.spec.ts:138` pick by position; S108's own new spec now covered by its AC 5); #572 (S161's path-only owed purges vs an older Worker, a latent rollback hazard); #533 (existing Hyperdrive configs may still cache, undoing B408); #538 (DO/cron placement after B532). Questions for the owner below.
- Doc parity review of 2026-11-24 (`audit/2026-11-25/20261125T000056Z-parity-review.md`) queued two items: (1) S212's purge secrets: answered by B543 (merged this run): staging and production deploys push `BT_CF_PURGE_TOKEN`, `BT_CF_ZONE_ID`, `BT_APP_ORIGIN` (Current baseline, Cache freshness row); no story needed. (2) shell-scoreboard A15 still a draft with no frame drawn, and no story or question owns drawing it (`text A15` reaches only the done S125, S159): owner question below.
- Previous review's carried items: S215 rebased over S216 (`functions/src/worker-app.ts:87,215` beside S216's `:159,:348`); B430 orders by `gamePhase` (`packages/domain/src/scoreboard-rows.ts:46`); the S216 note's "logged and dropped" wording in ADR-022 (`docs/v3/ARCHITECTURE.md` ~1259) is still there, an ADR edit outside this review's scope; carried.

## 2. Ground truth (next 3)

- **S108** (p104): paths `packages/domain/src/slot-occupant.ts` (exists; `slotOccupant(setting, phase)`, `STATUS` table), `web/src/components/game/WinProbabilityCard.tsx` (exists; "Hidden with scores" at :68), `web/src/pages/ScoreboardPage.test.tsx` (exists; `createRenderCounter` at :30), `packages/domain/src/settings.ts:14` (`GAME_ROW_SLOTS = ["status", "roomMenu"]`, so AC 1's third value is the red-first gap), `web/src/pages/SettingsPage.tsx:47,141` (`SLOT_LABELS`), `e2e/design/` (exists; S108.spec.ts is what it creates), `scripts/verify-S108.sh` absent (work item 0 creates it). Fixture 823823: `fixtures/raw/playmetrics-823823.json` exists for the unit test's line. Depends on S93, S106, S67, S68, S161, S171, S81: all `done`; design S107 `done`. Turn cap 12 holds (one setting, one domain function over S161's served line, one extracted component, design match). Fence: all ACs land in `web/src/`, `packages/domain/`, `e2e/design/`, `docs/v3/design-checks/`; no `functions/` change is needed now that S161 serves the line.
- **S99** (p105): `functions/src/mappers/` exists (no POTG mapper yet), `functions/src/adapters/fixtures/bundled.ts`, `functions/src/adapters/http/mlb.ts`, `functions/src/scripts/record-fixtures.ts`, `packages/ports/src/mlb.ts` exist; `fixtures/raw/potg-823823.json` absent (AC 1 records it); `pnpm mlb:scan-drift` → `functions/src/scripts/scan-drift.ts` (package.json:39). No dependencies. The note "the HTTP adapter knows one baseUrl" is now half-stale: `playMetricsUrl` (`mlb.ts:163`) already reaches bdfed by an absolute URL, cited in the new note as precedent. Turn cap 12 holds.
- **S100** (p106): `packages/mlb-api/src/live.ts`, `functions/src/mappers/live.ts` exist (the reuse check's targets); `fixtures/raw/rulesettings-823823.json` absent (AC 1 records it). No dependencies. Turn cap 12 holds.
- Neighbors: S101 (p107) same shape as S99/S100, amended likewise; S103 (p109) depends on S48 (`done`), runs inside S48's object, so the fetchGame finding does not apply.

## 2b. Adversarial pass (review-class checklist, `docs/v3/LOOP.md` §7)

- **S108.** Item 3 (partly present data): `ScheduleGameSummary.winProbability` is optional (`packages/domain/src/types.ts:361`); a past final day's schedule the edge cached before S161 deployed is kept under S212's `PAST_CACHE_CONTROL` (`s-maxage=2592000`) and carries no key, so AC 3's "`null` when `winProbability` is `null`" leaves `undefined` unspecified: a row reading `undefined` could draw an empty occupant instead of Status. Amended (AC 3: null or absent, plus a unit test). Item 11 (contradictions inside a story): AC 2's "table test over every setting and phase" cannot express AC 2's own null-line fallback, since `slotOccupant` (`slot-occupant.ts:28`) takes no line; amended (gains the line as input; table over line present/absent). Item 16 (what a tool actually sees) and #561: since B430, the default order puts favorites then live games first, so a spec that picks "the first live row" captures a different game when the capture's favorites differ; amended AC 5 (pick by `gamePk` or phase). Item 12 (boundaries): AC 3's 49.5 → 50/50 test already covers the rounding boundary; Math.round(49.5) = 50 and 100 − 50 = 50, consistent. Item 6 (ADR conformance): ADR-025 holds (one `slotWinProbability` beside `winProbabilitySeries`; one line component); ADR-026 render-count baseline named. Item 15 (shared state): the line component is shared with the Live card, which keeps its home-rising line; AC 3 already says so. Personal data: none (no table, field, service, browser key or log).
- **S99, S100, S101.** Item 7 (upstream request budget) and item 3 (partly present data): since S216, `HttpMlbStatsClient.fetchGame` (`mlb.ts:315-345`) waits on `Promise.all` of content, GraphQL content, and playMetrics raced against `PLAY_METRICS_LIMIT_MS` (750 ms, tested in `functions/src/services/ingest.play-metrics.test.ts:117-173`). Breaking sequence: S99 adds its mlb.com call to that `Promise.all`; mlb.com's POTG host answers in 3 s (or hangs) on a cold read of a final game → the response waits 3 s, undoing S216 AC 5; and every live poll fetches POTG (a final-only value), rule settings (fixed for the game) and uniforms (fixed before first pitch) again. Amended AC 5 in each (a hung request leaves `fetchGame` answering within the limit with the field absent) plus a note. Item 33 (expected values name their recording): S99 AC 4's Zeferjahn values and S100 AC 4's 53.5%/27% name the recordings AC 1 makes; holds. Item 9 (generated files inside the fence): `web/src/api/generated/` is fenced in each; holds. Personal data: none of S99–S101 adds a personal field (public MLB data).

## 3. Prioritization

- Order S108 → S99 → S100 → S101 → S103 holds: S108 is the only UI story with every dependency and design done, and it parks for a design match anyway, so the ingest stories run beside it. Arguing against: S149 (p84, parked) draws the scoreboard's live rows too; S108 doesn't depend on it, and both design matches can go to the owner together. Nothing above blocks S108.
- Triage of arrivals: no new story was created since the window; new bugs B564 and B551 are unaccepted (priorities proposed above for the coordinator). The closed bug groups change no neighbor's order.
- Current baseline: S216, S215, S213, S193, S161, S212 each have a `**Baseline:**` line and a row (`docs/v3/backlog/frame/01 Current baseline.md`); INDEX's As of line names S161 at `092079af`. No drifted row found among those checked.

## Duplication sweep (ADR-025)

`pnpm dup:check` (jscpd): 0 clones over 304 files. Searches: favorite-game logic (`rg isFavoriteGame|favoriteTeamIds.includes`): one domain function, `packages/domain/src/scoreboard-rows.ts:22`, used by `web/src/pwa/prefetch.ts:28` (S213 holds); win probability: `scoreboardWinProbability` built only on `winProbabilitySeries` (S161 holds); share (`navigator.share`): only `web/src/components/videos/PlayerActions.tsx:124`. One leftover, not a duplicate: the digest's `watchFirst` is computed with no reader (#570, owner question). None found otherwise.

## Personal-data sweep (ADR-028)

S215's `tier_overrides` is labelled personal, deleted by the users store (`functions/src/services/data-classification.ts:181`), FK `onDelete: "cascade"` to `users.uid` (`functions/src/adapters/postgres/schema.ts:158-163`), under ADR-028's "BT database: users" row like `entitlements`. New log lines since `230af846`: one, `win-probability fill (S161): N game(s) given their line`, no personal field. Next 3 stories add no personal data. None found.

## Verdict: amended

Edits: S108, S99, S100, S101 text records; frame 00's review notes.

## Questions for the owner (non-blocking)

1. **Should the server stop computing the day digest's `watchFirst`, now that the web no longer shows it (#570)?** B426 replaced Best of's "Watch first" list with the highlight grid, but `packages/domain/src/digest.ts` still sets `watchFirst` on every digest and the API still serves it. A story would drop it from the digest and the OpenAPI schema (a breaking response change, so it needs `api:breaking`'s acceptance). Recommended: yes, as a small story.
2. **Should the three older design capture specs pick scoreboard games by id instead of position (#561)?** Since B430 the scoreboard shows favorites, then live games, first, so `e2e/design/S20.spec.ts`, `S170.spec.ts` and `S74.spec.ts` may capture a different game than they mean; `pnpm verify` doesn't run them, so only the next design match would show it. S108's new spec is already required to pick by id. Recommended: yes, as a small story.
3. **Should BT guard against older Workers mishandling the origin-less edge purges S161's fill records (#572)?** The fill runs in `pnpm db:migrate` before deploy and owes purges as paths; an older Worker (the gap before deploy, or after a rollback) sends them as-is, Cloudflare likely rejects the batch, and real purges listed with them wait until retry, or until the 30-day cutoff after a rollback. Recommended: yes, a small story, since rollback is the coordinator's own action.
4. **Should the deploy warn when an existing Hyperdrive config still caches queries (#533)?** B408 creates new configs with caching off, but both existing ones (staging, production) were made before and the deploy returns them silently; a cache left on serves stale reads that S212's purge-on-change relies on not getting. Recommended: check both configs now (`wrangler hyperdrive get`), and take the warning as a story.
5. **Should the ingest Durable Objects and cron be placed near Neon too (#538)?** B532's Smart Placement moves only the fetch handler; DOs and cron still pay about 70 ms a round trip. Recommended: measure after B532 deploys before a story.
6. **Should shell-scoreboard A15 (no off-day mark on the All-Star Game's day) be drawn and put up for ratification, or dropped?** It sits as a draft in `docs/v3/visual/shell-scoreboard/amendments/A15.md` with its one frame undrawn, and no story owns drawing it; S159 and S125, which it amends, are done. Recommended: a small design chore to draw the frame and ask.
