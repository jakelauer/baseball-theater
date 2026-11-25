## 2026-11-25 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T19:47:22Z` |
| HEAD at review | `fae9ca7a` (tree dirty) |
| Trigger | run R20261125T180846Z hard ceiling: docs/v3/ARCHITECTURE.md changed (B629 corrected ADR-020's 2026-11-25 placement hint to enam); focused review |
| Stories `done` since last review | S196, S101 |
| In flight | B508, B564 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

# Backlog review 2026-11-25, run R20261125T180846Z (focused), worktree review-1125e, HEAD fae9ca7a

Focused mid-run review (run-backlog step 2, "Reviews inside a run"): the focus (B629's change to ADR-020's 2026-11-25 note; S101's overlap with S100 and S200) plus the next 3 eligible items S100, S200, S198. Not a full sweep. In flight: B508, B564 (no findings on either).

query: seed backlog --since d58d1c58 → S198, S207, S209, S196, B508, B564, B586, B433, S210, S103, S211, S105, S100, #619, S181, #634, B631, B629, B626, S220, S200, S101
query: issues --since 2026-11-25T15:28:59.000Z → #634, #631, #629, #626, #598, #564, #508, #473, #455, #447, #233, #232 (as of 2026-11-25T19:38:11.000Z)
query: text placement → S3, S21, S25, S28, S33, S51, S73, S135, S220
query: text us-east-2 → S113, S216, S220
query: text locationHint → S220
query: item S100 → S100; item S200 → S200; item S198 → S198
query: item B588, B428, B426, B424, S196 → all done

## Focus 1: ADR-020 note (B629)
`git diff d58d1c58 HEAD -- docs/v3/ARCHITECTURE.md`: one sentence changes `placement.hint` from `aws:us-east-2` to `enam` (Cloudflare's region code; the AWS form was refused at upload, #629). The decision (staging seeds placement near Neon; production takes neither hint until the owner approves on staging's numbers) is unchanged. Stories naming the hint/region/locationHint: S113, S216, S220, all done. Open stories citing ADR-020 (S209, S181) cite it for the cron resolve step and the live hub, not placement. No story amended for it.

## Focus 2: S101's overlap with S100 and S200
S101 changed `packages/ports/src/mlb.ts` (`fetchGameUniforms`, `MlbGameSources`), `functions/src/services/player-of-the-game.ts` (`askWithinLimit`, `askGameUniforms`, `withAskedUniforms`), `packages/domain/src/player-of-the-game.ts` (`StoredExtras`, `KEPT_WHOLE`, `keepStoredExtras`, `uniformsDue`), `ingest.ts` (`ingestGame` optional `mlb`, `readGames` Promise.all), `game-ingest.ts` (`UNIFORMS_ASKED_KEY`), `backfill.ts` (`EXTRA_SOURCES` + "uniforms", writes via `ingestGame` without `mlb`), overlay/fixture/HTTP adapters, recorder, scan-drift, openapi + generated client.
- S100: overlaps directly. Its note still said "whichever of S100 and S101 lands first generalizes" (checklist 18: done work still queued). Amended (below).
- S200: no overlap. It reads highlights (`teamIds`, `classifyHighlight`), web videos components; S101's spec/client change adds `uniforms` only.

## Check 2 / 2b: next 3 items at HEAD
### S100 (doing label, no claim, branch story/S100 empty at fdefa9b9)
Paths: fixtures/, packages/mlb-api/src/, packages/ports/src/mlb.ts, functions/src/mappers/, functions/src/adapters/fixtures/bundled.ts, functions/src/adapters/http/mlb.ts (live feed URL line 388 `api/v1.1/game/${gamePk}/feed/live`, matching AC 1's endpoint, so the hydrate can ride it), openapi/, web/src/api/generated/ exist. Depends on: none. Turn cap 14 still holds (cheaper now the helper exists). Fence holds every file the wiring touches (all under functions/src, packages/).
Checklist applied: 2 (backfill give-up state: `EXTRA_SOURCES` keys, `sourceGivenUpAt` tolerates a new key), 3 (partly present: stored final without the field), 7 (request budget: read waits one bounded limit via readGames' Promise.all; final-trail guard), 18 (stale "whichever lands first"), 9 (generated files in fence: yes), 33 (AC 4's 53.5%/27% name AC 1's recording: yes).
Finding (amended): breaking sequence — S100 wires its ask into `ingestGame`'s `mlb` like the uniforms; the backfill strips `mlb` (`const { mlb: _askedInFetch, ...writes } = deps`), so a backfill stores last week's games final without `ruleSettings`; the 7-day re-check passes; nothing asks again. Amendment: name S101's helpers as the reuse targets and require either `ruleSettings` in `EXTRA_SOURCES` (test in backfill.test.ts) or the gap accepted in the ledger with #619's.
### S200 (doing label, no claim, branch story/S200 empty)
Paths: packages/domain/src/highlights.ts (`classifyHighlight` l20, `filterHighlights` l39, `groupHighlights` l183), web/src/components/videos/{VideosRoom,VideoCard,VideoGrid,VideoLayoutToggle,QuickFilters}.tsx, web/src/layout/variant.ts, DayDigest.tsx, SearchPage.tsx (uses VideoGrid + VideoLayoutToggle, B588) exist. Prefer-after B428, B426, B588 all done. AC 1's grep claim at HEAD: `teamIds` under web/src outside tests in settings/store.ts, api/client.ts, api/generated, test/calendar.tsx — matches; VideosRoom.test.tsx is a test (allowed).
Checklist applied: 11 (contradictions: none), 14 (AC 1's grep scope: two folders, tests excluded, holds), 18/ADR-025 (duplicate row markup).
Finding (amended): `VideoCard layout="list"` is already a list row used by VideosRoom and Search, and `VideoGrid`'s list branch is a one-column Stack. A worker adding a new row component beside it leaves two list-row markups. Amendment names VideoCard's list layout and VideoGrid's list branch as the places.
### S198 (todo)
Paths: PlayerHost, LazyPlayerDialog, PlayerDialog, PlayerStage, VideoPlayer (web/src/components/videos/), SearchPage, DayDigest, web/src/layout/, routes.tsx exist; e2e/flows/player-modal.spec.ts exists (S196). Depends on S196: done. `<VideoPlayer` renders at HEAD in PlayerStage.tsx:111 and PlayerDialog.tsx:187 (AC 3 moves both to the provider). Turn cap 9 holds.
Checklist applied: 22 (reload re-applies attributes), 23 (intent the platform can refuse: autoplay), 11.
Finding (amended): PlayerStage.tsx:111 keys `VideoPlayer` by `${video.id}:${autoPlay}`. Sequence: stage clip mounted with autoPlay false, fan presses play in the element, leaves the page, corner host passes autoPlay true, key changes, new `<video>`, AC 1's identity check fails and the clip restarts. Amendment: provider keys by video.id only; autoPlay turning on goes through VideoPlayer's existing #423 effect.

## Check 1: coverage, bugs and issues
- #634 (enhancement from B631, owner-filed): migrate.ts still reads raw bodies; nothing hits it today (migrate is one-time). No story owns it; enters the backlog only if the owner asks. No question raised (already filed by the pipeline with its reasoning).
- B629, B631, B626 closed (fixed at HEAD). B508 p107.9 and B564 p107.95 in flight, placed ahead of S198 (p108) and after S200 (p107.8) by the coordinator; order kept (both test-only CI fixes, run beside S200).
- No open bug without a fields block among the seeded issues.
- Last review's "for the next review": S100/S101 choice — S101 asked off the fetch path and generalized the helper (answered by the S100 amendment); S168's ADR-030, S146's fence, #619, #609 carried (no owner answer yet).
- Parity review 20261125T184446Z queued nothing for the backlog review that these items carry (read through audit.jsonl).

## Check 3: order
S100 (106) → B508/B564 (107.9x, in flight) → S200 (107.8) ... S198 (108). S101 landing made S100 cheaper (helper exists), no reason to reorder. S200 and S198 independent (S200 web list rows; S198 player provider); both touch web/src/components/videos/ — S198's note on B424 already says the second keeps the first's behavior. Nothing obsolete. Nothing new arrived needing triage beyond the coordinator-accepted B508/B564 (kept).
Current baseline: frame 01 rows for S196/S101 updated in-range (diff since d58d1c58, 6 lines); `pnpm backlog:check` passes (Baseline lines of done stories enforced).

## Duplication sweep (S101, S196 since last review)
Searched: `setTimeout(() => resolve(null)` across functions/src, packages — one site (askWithinLimit). backfill.ts `ask` (gate + catch) vs `askWithinLimit` (bound) — different jobs, backfill calls askGameUniforms inside ask. `keepPlayerOfTheGame` reused by `keepStoredExtras`, not copied. S196: PlayerDialog/VideoPlayer/insetPlayer test helper — no duplicate player markup beyond the two render sites S198 consolidates. None found.

## Personal-data sweep
S100 (game rule settings), S200 (in-visit grouping, no storage, note says so), S198 (in-memory state, note says so): no personal data, no new browser key or outside service. New console.* in S101/S196 changed files (game-recheck.ts:63, ingest.ts 261/282/1052/1064/1123/1206) carry gamePk/dates only. None found.
