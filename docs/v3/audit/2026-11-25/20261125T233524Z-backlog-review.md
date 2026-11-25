## 2026-11-25 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T23:35:24Z` |
| HEAD at review | `621dce73` (tree dirty) |
| Trigger | review tracker 7/7 after S200 (run R20261125T180846Z, focused) |
| Stories `done` since last review | S200 |
| In flight | S100 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

Focused mid-run review (run R20261125T180846Z, `.claude/skills/run-backlog/SKILL.md` step 2): the review tracker's focus (S146, S168, S198, S221) plus the next 3 `todo` stories (S198, S207, S209). Not a full sweep. Also stands as the pre-PR review of `621dce73` (S146's fence edit). Long evidence: `.run/reports/review-1125h-report.md` (main checkout).

query: seed backlog --since 62a304d8 → S146, S221, S198, S207, S209, B583, B577, S168, S108, S151, S174, S201, S202, S196, S100, B586, B433, S210, S103, S211, S105, #643, #642, #640, B629, B564, B508, S200
query: issues --since 2026-11-25T19:38:11.000Z → #647, #643, #642, #640, #629, #564, #508, #455, #451, #232 (as of 2026-11-25T23:23:22.000Z)
query: text deploys nothing → S121, S146
query: path docs/v3/LOOP.md → S15, S84, S118, S121, S156, S164, S168

## Check 1 (coverage)
- S200 (done) left no gap: VideosRoom groups through `groupHighlightsByTeam`/`groupHighlights` in `packages/domain/src/highlights.ts`; its one `PlayerHost` (VideosRoom.tsx:385) and `useOpenClip` links unchanged.
- `git grep '<PlayerHost|<LazyPlayerDialog'` at origin/stage `0f91c1cf`: PlaysPanel.tsx, DayDigest.tsx, VideosRoom.tsx, SearchPage.tsx (+ the two components). S198 named three hosts; PlaysPanel (#422, since c632fdf4) is a fourth → amended.
- Issues: #643 (web tests time out under load) bears on S168's parallel graph → S168 amended (ADR states concurrency). #642 (refresh.test.ts other cases read the real clock) hides a latent test bug → owner question in `.pending/needs-input.md` (accept as bug). #640: test speed only, no latent bug; stays enhancement. B629, B564, B508 closed done. No open bug lacks a fields block in the seed; no triage issues.
- Newest parity entry (20261125T202544Z) queued nothing for this review.

## Check 2 (ground truth at origin/stage 0f91c1cf)
- S146: `.claude/skills/release/SKILL.md` line 10 holds **Prepare** step (1) with `scripts/ci-changes.sh push <served> <release>` / `code=false`; CLAUDE.md's release bullet only points there (no deploy wording in CLAUDE.md, grep `deploy`); `scripts/verify-S146.sh` absent (rule 9, created by the story); `scripts/verify-S131.sh` extracts from CLAUDE.md at its own commit (frozen). Depends: none. Status `blocked` on GitHub (parked for the fence question, now answered) → coordinator sets `todo`. Barrier (fence reaches `functions/src/deploy/`, `.github/`, `wrangler.jsonc`, `.claude/`).
- S168: `docs/v3/ARCHITECTURE.md` at origin/stage ends at ADR-029; `ADR-030` occurs 0 times, so nothing assumes the lost draft and the next free number is 030. AC 1 parks it (checkpoint, `status:blocked`); run-backlog step 4 releases a parked item's claim and opens its checkpoint, so it may start, draft and park before acceptance. Barrier; runs alone after S100 finishes. Status `blocked` → coordinator sets `todo`.
- S198: depends S196 `done`; paths `PlayerStage.tsx`, `VideoPlayer.tsx`, `web/src/layout/NoticeSlot.tsx`, `web/src/routes.tsx` exist; fence `web/src/` covers S200's VideosRoom/VideoCard/VideoGrid.
- S207: depends B586 `done`, prefer B433 `done`; `BoxRoom.tsx`, `projectGameBoxscore` (projections.ts:112), `BoxscorePitchingRow`, `mapBoxscore` (functions/src/mappers/live.ts:204), `fixtures/raw/live-823823.json` exist. v2 path `/Users/jakelauer/Repos/BaseballTheater` does not exist in the container; `/home/user/baseball-theater-legacy` holds all four named files → amended.
- S209: prefer S207 (todo); `MatchupCards.tsx`, `DEFAULT_SETTINGS`/`videoPlayer` (settings.ts:47,58), `savantLinks` exist; `**Owner answer (tier):**` recorded. Turn cap 17 unchanged.
- S221: `RUN_ITEM_KINDS`, `RUN_KINDS` (claims.ts:197,199), `summarizeRun` (runs.ts:236), `ITEM_ID` (in-flight.ts:24) exist.

## Check 2b (review-class checklist, LOOP.md §7)
- 621dce73 / S146: items 9, 10, 11, 14, 17, 18, 29. Item 17: LOOP.md:84 (§7) and :168 (§9) say a merge into `stage` deploys staging unless docs-only; after S146 an input-unchanged code merge deploys nothing too, like `wrangler.jsonc`'s comment (2026-11-16 review's (f)) → LOOP.md joins the fence for those two sentences. Item 10: the release skill is one line; the rewritten step (1) names "step (2)'s smoke test", so a grader cutting at the first `(2)` stops inside step (1) and misses `build:inputs` → end marker `(2) smoke-test`. Item 11: Goal condition forbade every `scripts/` change while `/goal` allows creating the grader → aligned. Fence: CLAUDE.md no longer holds anything S146 changes → removed (widening is the one file). Item 18: the 2026-11-16 note's "with CLAUDE.md in the fence" annotated. No other story owns LOOP.md's two sentences (`text "deploys nothing"` → S121 done, S146); `ci-law.test.ts:258` comment stays true.
- S168: items 11, 18, 25 checked; ADR list gains concurrency (#643's evidence: 4-core, load ~15, web tests at the 5 s timeout); its note says the ADR is drafted afresh.
- S198: items 11, 17, 22, 23: four hosts (above); key-by-clip note intact.
- S207: item 33 (recordings named: 823823) holds; missing-input break fixed.
- S209: items 2, 3, 6 (ADR-028: public ids, no personal data), 7 (capped resolve) — unchanged since the 2026-11-25 reviews; no new break found.
- S221: items 4, 10, 17: in this run's `.run/run.json`, S200's events end `merged`, `review-score` (id S200) ×2, and `claim` follows `resume`; "newest item event" without a kind list would read S200 as in flight → AC 1 names `RUN_ITEM_KINDS`, with a test.

## Check 3 (order)
S146 (103.7) and S168 (103.8) after B578, as the owner placed them; both barriers, serial, after S100. S221 at 121.05 after S174 (owner: "after s174"); it changes no next item's fence (its fence `scripts/backlog-vault/`, run-backlog SKILL.md; S168 also reaches both, but runs far earlier). Order kept. Current baseline: S200's commit edited `frame/01 Current baseline.md`.

## Duplication sweep
S200's added code: `groupHighlightsByTeam` in domain, used by VideosRoom:339; `VideoGrid` columns constants only; no second grouping in web (grep `teamIds`/`filter(` in the diff shows test helpers only). None found.

## Personal-data sweep
S200 diff (web/src, packages/domain/src): no `localStorage`/`sessionStorage`/`console.`/email lines. S146 (file hashes), S168, S198 (memory only), S207, S221 (local journal) add no personal data; S209's ids are public. None found.

## In flight
S100: no edits; `claims.ts review-edits` exit 0. No findings on S100.

Verdict: amended (S146, S168, S198, S207, S221). One owner question (#642), non-blocking.
