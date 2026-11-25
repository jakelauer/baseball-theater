## 2026-11-24 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T02:49:35Z` |
| HEAD at review | `40bb7e6b` (tree dirty) |
| Trigger | run R20261124T235814Z hard ceiling (focused): S216 (#552) added a dated note to docs/v3/ARCHITECTURE.md inside ADR-022; review-debt.sh read its ADR-020 mention as a frontend ADR change |
| Stories `done` since last review | S216 |
| In flight | B417, B423, B424, B434 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

**Focused review** (inside run R20261124T235814Z; `.claude/skills/run-backlog/SKILL.md` step 2, "Reviews inside a run"): the tracker's focus plus the next items, not a full sweep. Fresh-context subagent. In flight: B417 (claim also carries B423, B424: the `video-cards` group, PR #553) and B434; their text was not edited.

query: seed backlog --since 389b5917 → S213, S193, S149, B526, B529, B429, B430, S135, S134, S81, S153, S150, S148, S161, S173, #516, S181, S91, S103, S176, S178, S179, S180, S190, B551, B543, S216, S215, B530, B528, B527, B525, B522, B521, B434, B432, B431, B428, B427, B426, B424, B423, B421, B418, B417, S175 (read only the focus items)
query: issues --since 2026-11-24T23:54:29.000Z → #551, #543, #537, #536, #530, #529, #528, #527, #526, #525, #522, #521, #434, #432, #431, #430, #429, #428, #427, #426, #424, #423, #421, #418, #417, #364 (as of 2026-11-25T02:37:25.000Z)
query: item B528 → B528
query: item B530 → B530
query: text A15 → S125, S159
(Story text read with `text-records.ts newest` for S213, S215, B433, B522, B528; bug bodies from the issue cache, as data.)

## (a) The S216 note against its code and ADRs 020/021/022

The note is `docs/v3/ARCHITECTURE.md` line 1259, inside **ADR-022 — Idempotent updates** (section lines 1236–1259; ADR-023 starts at 1261). Checked against S216's code at `40bb7e6b`:
- "answers from the snapshot it stamped and the rows the switch stored, never reading back": S216 grader check 1 (no `readServedGame` in `getOrRefreshGame`; `storeGame`/`storeSchedule` take the caller's stored rows). Holds.
- "state row, then the snapshot … stay awaited; a refused write is reported by the write, only then read": `ingest.ts:330-331` (refused gamePks from `upsertMany`, then one `games.getMany(refused)`). Holds.
- "Only writes that carry no version of the answer (projections, the one edge purge, a late playMetrics write) run after the response, through `BackgroundWork` (`ctx.waitUntil`, inside the request's database scope)": `packages/ports/src/background-work.ts`; `functions/src/worker.ts:40` (`inDatabaseScope(env.HYPERDRIVE, handle, (closing) => ctx.waitUntil(closing), () => deferred.drain())`); `ingest.ts:230` (`deps.background.defer("on-read refresh writes", …)`). Holds.
- "a deferred write a newer version refuses is logged and dropped": true of projections (`ingest.ts:217-218`); **imprecise for the late playMetrics write**, which on refusal reads the newer stored snapshot and retries once (`storeLatePlayMetrics`, `ingest.ts:945-975`) before logging and dropping (`:969`). Not wrong in effect, but the next story that touches ADR-022 should say "retried once, then logged and dropped". ADRs are outside this review's write scope; carried to the next review's notes.
- "144 → at most 9, 7 before it answers": the S216 AC 4 bounds (`toBeLessThanOrEqual` 7 / 9); measured 6 / 8 (INDEX **As of**). Consistent.
- ADR-020 (ingest writes Postgres, then publishes): the note keeps in-window games on the ingest object; S216 AC 3's test "game ingest writes before it publishes" passes (commit f3eebe6d). Consistent.
- ADR-021 + S212's 2026-11-24 amendment (lines 1227–1232: a writer that stores a real change purges that URL): S216 still purges after the write, now once per request and after the response; a correction reaches the edge the same way. A response served before its own purge is the fresh data, so nothing stale is cached by the delay. Consistent.
- ADR-022 (apply-if-newer, versioned writes): the answer never carries an unaccepted version; the late playMetrics write is a new version (`stampVersion`), out-of-window only, so no hub publishes it; clients take it on their next fetch, applied if newer. Consistent.
Verdict on (a): accurate, one wording imprecision (above), no amendment needed in the backlog.

## (b) Does it touch a frontend ADR? No.

The note sits in **ADR-022** (lines 1236–1259) and names **ADR-020** once, in passing, to say an active game's ingest path is unchanged. `scripts/review-debt.sh:181` matches any added line naming `ADR-0(03|08|14|16|2[0-6])`, so that mention made it report "ARCHITECTURE.md changed a frontend ADR" (`--json`: `adr-changed`, adrs ADR-020, ADR-022). The note describes the server's on-read refresh only: S216 changed no file under `web/` (`git diff --name-only a1b66e04 40bb7e6b`: functions/, packages/ports, packages/domain/src/game-state.ts, docs, scripts), no API route, response shape or client cache rule (ADR-022's client row unchanged). No UI work follows; **the coordinator can log the design intake as a skip**, citing ADR-022 lines 1236–1259 and this entry.

## (c) Next items — check 2 and 2b

**`video-cards` group (B417, B423, B424; in flight, PR #553) — findings for the overseer, not edited:**
- B417 at HEAD: still real; `web/src/components/videos/PlayerActions.tsx:117-124` falls back to copying when `navigator.share` is missing, and its comment (lines 87-88) says so and must change with it (ADR-025). 2b (feature detection): "share (and canShare for the payload)": a browser with `navigator.share` but no `navigator.canShare` (Safari before 14) would lose a working Share if the check requires `canShare`; call `canShare` only when it exists.
- B423 2b (reduced motion / events): "playback starts only once the transition ends" with reduced motion (no transition) never gets a `transitionend`; playback must start at once when the duration is 0. Also: `play()` with sound after the transition must still fall inside the click's user activation (iOS Safari); test the real device path or start muted-then-unmute.
- B424 (B422 is `done`, so its third bullet applies): 2b (history): whether a plain click pushes `?clip=` (Back then closes the player) or replaces is unsettled; a clip URL loaded in a new tab must resolve a clip that isn't on the page's first render (a collapsed Videos group, Search's later results).

**B434 (in flight) — for the overseer:** the `.pending` Standings question's recommended option ("one column below ~1000px") needs a fourth width: views get only `variant` (mobile / medium / desktop, `web/src/layout/variant.ts`: "views … never read the viewport themselves (ADR-014 rule 8 …). Do not add a fourth"; ADR-014 line 875). The nearest buildable form is "side by side on `desktop` only (Mantine `lg`)", which also departs from the owner's "desktop and tablet". Suggest the question's options say so.

**S215** (`doing`, parked at its grader checkpoint `5104182d`, needs-lead on `wrangler.jsonc`): check 2 at HEAD: `mockSignInAllowed` at `functions/src/worker-app.ts:253`; `wrangler.jsonc` has `env.preview` (76), `env.staging` (100, `BT_MOCK_SIGN_IN` 123), `env.production` (138, `LOGTO_ENDPOINT` 159); `entitlementsForTier(` is called outside tests/contracts only at `functions/src/services/accounts.ts:109` (S216 added none, including `dev-seed.ts`); migrations under `functions/src/adapters/postgres/migrations` (inside `functions/src/`). The last review's "S215's `getTierOverride` spy" is in its grader (`story/S215:scripts/verify-S215.sh:16`). 2b: checklist items applied — server-side gating (no client flag, AC 2), cache (`no-store`, AC 4, against S212's edge cache), personal data (ADR-028 users row, `USERS_STORE`), one rule (AC 1). Holds. For the coordinator: its branch is cut from `ea39e6ea`, before S216 changed `worker-app.ts` and `worker.ts`; rebase before building.

**B433** (no claim in `.run/claims`; the cache shows `status:doing`): check 2: `web/src/components/game/BoxRoom.tsx` (one team at a time, `useState<Side>`), `format.ts:53` `GAME_INFO_LABELS = ["Venue", "First pitch", "Weather", "Wind", "T", "Att"]`, `Linescore.tsx:89-93` header text `TEAM`. 2b (label key vs display): those labels are also the **keys** `gameInfoLines` matches MLB's lines by (`info.find((l) => l.label === label)`): renaming them to "Time"/"Attendance" makes both lines vanish silently. The fix maps display names apart from MLB's keys, with a test that a fixture's `T` and `Att` lines render as "Time" and "Attendance". Layout: "tablet and up" is the `medium`/`desktop` variant BoxRoom already receives (no new breakpoint, ADR-014 rule 8). Bug text is the owner's issue; for the fixer, not edited.

**`plays-pitches` group (B521, B522, B526):** check 2: all in `web/src/components/pitch/PlaysPanel.tsx` / `PitchSequence.tsx` at HEAD. **File overlap:** B417's claim holds `web/src/components/pitch/PlaysPanel.tsx` (B424's play links), so this group waits for `video-cards` to merge.
- B521 2b (event that never fires): `PlaysPanel.tsx:459-480` closes at once, scrolls, then opens with `OPEN_MS` and replays on the panel's `onTransitionEnd` (`:540`). Opening instantly (duration 0) fires no `transitionend`, so the pitch replay waits on the fallback timer `OPEN_MS + 400` (`:479`): call `replay` directly on an instant open. The comment at 459-480 must change with it.
- B522 2b (fence): expected 3 (a live arrival opens, or stays collapsed when an older pitch is open) is `web/src/components/game/LiveRoom.tsx:50-59` (`setPicked(null)` on each arrival; `selected = picked ?? newest`), outside `web/src/components/pitch/`. **Amended:** the fence gains `LiveRoom.tsx` and `LiveRoom.test.tsx`. Also for the fixer: one `selected` today drives both the open sequence row and `PitchTheater`'s zone dot and flight charts (`AtBatViewer.tsx:31-36`, owner: "should always show the selected / last pitch"), so with 0 pitches open the charts should still show the newest pitch: split "open row" from "pitch the charts show".
- B526: `PlaysPanel.tsx:497` renders each section's `SectionHeading`; holds.

**S213:** check 2: `scoreboard-rows.ts:30` (`favorite` closure) and `web/src/pwa/prefetch.ts:27` (`favorites.has(game.teams.away.id) || …`) as stated; `scoreboard-rows.test.ts` exists; depends on nothing. 2b (premise): AC 3 said "`prefetchOnOpen` has no test at `da6ec3e0`, so `web/src/pwa/prefetch.test.ts` is created", but `web/src/pwa/prefetch.test.tsx` exists at `da6ec3e0` (S74, `7cf2f191`; cases "S74 AC 4 signed in/out"): a second test file beside it, and a fence naming `.ts`, would have forced a fence stop or a duplicate file. **Amended:** AC 3, the fence, Goal condition and `/goal` line now extend `prefetch.test.tsx`, adding direct `prefetchOnOpen` cases (null and empty favorites; away-only, home-only and no-favorite games). AC 2's grep regex matches both HEAD forms (`favoriteTeamIds.includes(game.teams…)`, `favorites.has(game.teams…)`). Turn cap 3 holds.

**`scoreboard` group (B429, B430):** check 2: `web/src/pages/ScoreboardPage.tsx:25-28` `scoreboardColumns` (1 / 2 / 2), shared by the skeleton; wide favorites span `1 / -1` (`:62`), fine at 3 columns. B429 maps to desktop 3 / medium 2 / mobile 1 with no new breakpoint. B430 2b: (reuse) the default order must use S213's `isFavoriteGame` (S213 at 72.44 sits before it) and `gamePhase` (`packages/domain/src/game-phase.ts:33`, the one answer to "is this game live?"), and stay a stable sort so `scoreboardRows`' favorites split keeps it; (ties) a doubleheader's game 2 with a TBD time can share game 1's start: tie-break by game number, then `gamePk`; (status) `gamePhase` reads a suspended game (`T`/`U`) live while it stays suspended, so it sorts with in-progress games. For the coordinator: B429 and B430 carry no `status:` label in the cache.

## (d) The `top-bar` group (B528, B530)

Confirmed as stated in `.pending/needs-input.md`: the ratified game-shell DESIGN (line 13: every frame opens with `game-topbar` "← back · `NYY @ BOS` · live indicator · date"; line 59: scrollable top tabs below) and amendment A7 (ratified 2026-11-22; the phone top bar grows 56 → 80px for the own-line marker, A7 lines 20, 52) contradict both requests. The parked `it.fails` tests exist on `bug/B528` (`GamePage.test.tsx:157`, `GameTopBar.test.tsx:102`); both issues are `status:blocked`; B530 `prefer_after: B528`. Stated correctly; nothing to change.

## Check 1 — coverage, bugs, parity items

- **B551** (#551, the owner's; `bug`, no fields block, unaccepted): Claude's review sometimes fails "review JSON lacks summary or findings", stalling the merge gate on every affected PR. Suggest the coordinator accept it at about **72.2**, ahead of the 72.3 polish bugs; a fix may live in `scripts/claude-review/post-review.py` alone, since `claude-review.yml` changes need the owner's review.
- Newest parity review (`audit/2026-11-25/20261125T000056Z-parity-review.md`) "For the next backlog review": (1) S212's purge secrets: answered by **B543** (closed `done`; `.github/workflows/deploy.yml:329-330, 462-463` pass `BT_CF_PURGE_TOKEN`/`BT_CF_ZONE_ID`); whether the repository secrets hold values is the owner's setup, not a story. (2) shell-scoreboard A15's draft file: the owner already answered (2026-11-24, previous review: *"It doesn't need a design, it's very straightforward."*); S125 and S159 are `done` (query `text A15`); the leftover draft file is the design owners' to mark, no backlog work.
- Previous review's "for the next review": S216's bounds held (7/9 expected, 6/8 measured); S215's spy is in its grader; the `layout-type` group (B525, B527, B431) is `done`, and the `videos-room` group's B529 ("Videos" header) and B427 sit in `web/src/components/videos/VideosRoom.tsx`, which B417's claim holds: that group also waits for `video-cards`.

## Check 3 — order

S213 (72.44) before B430 (72.45) still right (B430 needs `isFavoriteGame`). `plays-pitches` and `videos-room` at 72.3 can't start beside `video-cards` (file overlap above); `scoreboard` (72.45) and S213 can. No priority changes; the arrivals since the last review (B528, B530, B529, B526, B527, B525, B522, B521) were placed by the previous review and their places still fit; B551 is named above for acceptance.

## Duplication sweep (S216's code)

Searched S216's added lines (`git diff a1b66e04 40bb7e6b -- functions/src packages`) for status, date and settledness checks (`codedGameState|isFinal|isLive|gameDate|< today`): only test fixtures and `suspendedSince` (an existing domain function); S216 removed `pastFinishedChangedGames`, `purgeDayEdge` and the hand-written pre-filters in favour of `isPastFinishedGame`/`isPastFinishedDay`. `storeGames`' per-game fallback (`ingest.ts:907-919`) calls the same store path. None found. (jscpd not re-run; `pnpm verify` ran it at S216's finish.)

## Personal-data sweep

S216 adds no table, stored field, outside service or browser key (`getMany`/`upsertMany` on existing repositories). Its new log lines (`background-work.ts` `[background] … failed`, `ingest.ts:218, 239, 907, 919, 969`) carry gamePks and errors from game writes, no user fields. S213: no store. S215: its override table is under ADR-028's users row, `USERS_STORE`, manifest-labelled (AC 3). B417–B434 and the bug groups: no stores (B430's sort is not remembered). None found.

## Verdict: amended

S213 (AC 3 and fence) and B522 (fence) amended through text records. No owner question blocks anything.
