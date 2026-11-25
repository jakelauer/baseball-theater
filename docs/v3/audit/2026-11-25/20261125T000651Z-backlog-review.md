## 2026-11-24 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T00:06:51Z` |
| HEAD at review | `4242e1a2` (tree dirty) |
| Trigger | run R20261124T235814Z hard ceiling: .claude/agents/backlog-reviewer.md changed (PR #544); docs/v3/ARCHITECTURE.md changed; S213 added |
| Stories `done` since last review | S212 |
| In flight | none |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

**Focused mid-run review** (run R20261124T235814Z, forced by the hard ceiling): the brief's focus plus the next 3 items, not a full sweep. Nothing in flight (`backlog/fields-1125` records B543's fields and the bug groups; those bugs' fields left alone).

query: seed backlog --since a7eb6159 → S212, S213, S215, S216, B408, B529, B530, B430, B431, B417, B418, #516, S99, S100, S101, S104, S161, S190, S176, S173, S178, S179, S180, S181, S182, S183, S205, S91, S103, S149, B543, #538, #533, B532, B528, B527, B526, B525, B522, B521, B514, B508, B506, … (full list in the seed; read only the focus items)
query: issues --since 2026-11-22T20:22:44.000Z → #543, #538, #537, #536, #533, #532, #531, #530, #529, #528, #527, #526, #525, … (as of 2026-11-24T23:54:29.000Z)
query: item S216 → S216
query: item S215 → S215
query: item S213 → S213 (newest text records via `text-records.ts newest`)

## (a) PR #544 against frame note 00
Stale: rule 11, the Backlog reviews paragraph, the Doc parity "When it is due" paragraph still said only count and drift schedule reviews; the fields list in "Where to edit" lacked `group`. Amended all four to say what CLAUDE.md, LOOP.md §4 and run-backlog step 2 now say (owner, 2026-11-24: "Yes, with a ceiling (Recommended)"; "Yes, five groups (Recommended)"). `group` is parsed by `text-records.ts` (`GROUP_NAME` slug). Note for the overseer: the brief says the fields PR records **six** groups; run-backlog step 3 lists the **five** the owner approved (videos-room, video-cards, plays-pitches, top-bar, layout-type). A sixth needs the owner's OK in session.

## (b) S212 and B532 as they reach the next items
S212 shipped `clockWindowMode`, `servedGame(snapshot, row, now)` (3 args), `joinStoredScheduleDay`, `getScheduleRead` (a new read-back at `ingest.ts:447`), `listGameListings`, owed purges (`edge-purge.ts`, `retryOwedEdgePurges` in `worker.ts:55`), and purges inside `storeGame` (`ingest.ts:142-146`, one `listGameListings` per call) and `storeSchedule` (`pastFinishedChangedGames` one `games.getByPk` per changed game, `:239`). ADR-021 amendment (ARCHITECTURE.md:1227-1232) says the purge runs "when any writer stores a real change"; without B543's secrets the Noop purger logs once (worker-app.ts:142). B532's note (ARCHITECTURE.md:1114): Smart Placement moves only the fetch handler; S216's Gap ("B532 places it") stays true. #538 (enhancement, data) asks to move DOs/cron too; no story owns it; it enters only as a story the owner asks for.

## (c) Next items — check 2 and 2b
**S216** (p72.22; depends S212 `done`, #523 closed). Check 2: every named function exists, but its line cites were the pre-S212 probe's (`ingest.ts:371,107,155,158,325,351,69-78`); at HEAD `readServedGame` is :512, `storeGame`'s getByPk :121, `storeSchedule`'s getByDate :186 and read-back :190, S150's order :110-139. Paths in fence: functions/src/worker.ts, local-server.ts, adapters/postgres/connect.ts, packages/ports/src/, ARCHITECTURE.md exist. Checklist items applied: stale references, read-after-write, version monotonicity (ADR-022), batching/N+1, test composition vs production composition, bound arithmetic, ADR-025 duplication, db-reviewer list (multi-row upsert, RETURNING). Breaks found and amended:
- AC 1: `getScheduleRead` (S212) re-reads the day at `ingest.ts:447` for `pastFinished`; AC 1 didn't name it, so a correct worker missed it and its own no-read-back test failed. Named; verdict from the formed day.
- AC 1: built with bare `joinScheduleDay` the day lacks `windowMode` and `moved`; now `joinStoredScheduleDay` over outcome rows.
- AC 1: input "a stored day lists A and B, the refresh lists only A": `schedules.upsert` raises `served_base` by B's version in the same write, so a day formed from the pre-read base answers a lower version than the store. Now the upsert reports the base it stored; test added.
- AC 2: a multi-row guarded upsert must report refusals per key.
- AC 3/4: input "cold 2021-06-15 digest with `edgePurge` composed (the Worker always composes one, `edgePurgeFor`)": 15 `storeGame` purges = 15 `listGameListings` reads plus up to 15 `games.getByPk` in `pastFinishedChangedGames`, so "9 in all" was unreachable, and a cold game's "5 in all" missed its purge's read. Now: one deferred `purgeGameEdge` per request, judged from data the request holds (one `games.getMany` at most on a day read), counts taken with `edgePurge` composed; cold game 4/6; digest's 7 enumerated as reachable (feed switch reuses the schedule switch's rows).
- Personal data: none (no new store, logs carry URLs and gamePks only).
**S215** (p72.25; no deps). Check 2: `mockSignInAllowed` (worker-app.ts:240), `WorkerEnv`, `entitlementsForTier`/`parsePatronTier`/`hasMinimumTier` (entitlements.ts), `PatronTier` five values (types.ts:368), `toMeResponse`, `SignInResponse`, `SettingsPage.tsx`, `web/src/api/`, `web/src/session/SessionProvider.tsx` (`keepSession` :132), wrangler.jsonc env.preview/staging/production (staging sets `BT_MOCK_SIGN_IN`, production LOGTO_*), `pnpm api:breaking`, `pnpm comments:stale` exist. Only `entitlementsForTier` callers outside tests: accounts.ts:109 and the two contracts, as AC 1 allows. Checklist applied: config gating, prod cost, ADR-028 inventory, caching of per-user answers, contract coverage, migration/db review. Breaks amended: (1) `GET /api/v1/me` on every app load would read the override table in production; now none where not allowed, spy-asserted. (2) ADR-028: a new table needs its inventory row and registry; placed under "BT database: users" (What lists entitlements), `deletedBy: USERS_STORE`, exported and deleted through the user repository (personal-data.ts), FK to users.uid. (3) Answers `Cache-Control: no-store`.
**S213** (p72.44; no deps). Check 2: `scoreboard-rows.ts:30` closure, `prefetch.ts:27` Set check, no `prefetch.test.ts` at HEAD, `export *` of scoreboard-rows in domain index. AC 2's grep matches both today (rg run). 2b: grep pattern, signature (prefetch holds a `Set`, so it passes an array or the function takes either; either satisfies AC 1), first test file, coverage floors only rise. No breaks: `continue` for S213.
**B543**: issue text read as data; owner chose to wire `deploy.yml` (explicit request, so the workflow-change ask is answered). Fields in the in-flight fields PR.
**Bug groups**: `layout-type` (B431, B525, B527) then `videos-room` (B418, B421, B426, B427, B428, B432, B529). Overlap for the overseer: B527 resizes the Videos tab's headers (`VideosRoom.tsx`, `web/src/components/videos/`), B427 restyles the same group headers to look collapsible and B529 removes the "Videos" header. Run the groups serially (not in parallel) and tell the videos-room worker to keep B527's heading size and to drop only the header B529 names, keeping B527's tests green. B431's fence (`web/src/components/`, `web/src/pages/`) covers both groups' files.

## (d) S213 added
Read whole; sound (above). Parity for its Source was handled (skip at 20261124T212937Z).

## Check 1 coverage / bugs
Open bugs with no fields block: B543 (fields PR), **B508** (stage-deploy test timeout; the last review asked ~61) and **B506** (storage lint gap; ~72.3), both still unaccepted: for the coordinator. #533, #538 enhancements: no latent bug found. Newest parity review (20261124T201319Z): "For the next backlog review: None".

## Check 3 order
S216 (72.22) before S215 (72.25) holds: independent, but both fences include functions/src/, repository-contract.ts and functions/vitest.config.ts, so in parallel they conflict on files, not on correctness. S213 (72.44) before B430 (72.45) holds. B543 should come early (purges do nothing on staging/production until it ships); its priority is the fields PR's.
Current baseline: S212's row (01 Current baseline.md:26) and its `**Baseline:**` line exist.

## Duplication sweep (S212's code)
`ingest.ts:207-212` and `:233-238` hand-write parts of `isPastFinishedDay`/`isPastFinishedGame` (date < MLB's today, settled) as read-avoiding pre-filters: folded into S216 AC 3 (judged from held data, so the shortcuts go). Searched `< mlbToday(` across functions/src, packages/domain/src, web/src: only past-finished.ts:64 otherwise.

## Personal-data sweep
S212: `game_rechecks`, `owed_edge_purges` labelled (data-classification.ts:147,151); its new `console.warn`s carry URLs, gamePks and HTTP status only (Cloudflare adapter error text: status only). S215 amended above. S216, S213: no new store.
