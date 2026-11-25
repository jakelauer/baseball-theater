## 2026-11-25 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-25T12:16:35Z` |
| HEAD at review | `e66eb1f7` (tree dirty) |
| Trigger | review tracker (run R20261125T104453Z): score 8 vs threshold 7, PR #591's owner-directed walkthrough backlog change |
| Stories `done` since last review | S149, S153 |
| In flight | S173, B578, B584, B583, B577 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

query: issues --since 2026-11-25T07:58:11.000Z → #606, #601, #600, #599, #598, #597, #596, #595, #589, #588, #587, #586, #585, #584, #583, #582, #581, #580, #579, #578, #577, #563, #559, #537, #536, #533, #531, #529, #523, #477, #475, #473, #471, #469, #467, #465, #463, #461, #459, #457, #455, #453, #451, #449, #447, #445, #440, #421, #382, #381, #380, #379, #378, #377, #376, #375, #374, #373, #372, #371, #370, #369, #368, #367, #366, #365, #364, #363, #308, #293, #285, #281, #278, #240, #236, #233, #232, #231, #223 (as of 2026-11-25T12:01:55.000Z)
query: seed backlog --since b25d8190 → S146, S168, S195, S196, S197, S198, S199, S200, S201, S202, S203, S204, S205, S206, S207, S208, S209, S210, S211, S217, S218, S219, S220, B578, B584, S172, B579, S173, S100, S101, B426, B428, B588, S151, S174, S81, S176, S177, B433, B586, S103, S105, S108, S99, #348, #606, #601, #600, #599, B589, B587, B585, B583, B582, B581, B580, B577, B563, B559, S216, S215, #533, S213, B529, S212, S194, B421, S193, S192, S191, S190, S189, S188, S187, S186, S185, S184, S183, S182, S181, S180, S179, S178, S175, S161, S153, S149, S104, S91
query: item S217, S218, S219, S220, S146, S168, S200, S209, S207, S196, S198, S108 (text-records.ts newest)
query: deps S195, S197, S199, S205, S206, S208, S210, S211 → (as listed); and a scan of every open item's newest fields block and Depends-on line: no open item links a superseded story (S207's line names S205 only as superseded)

**Focused review** (review tracker, run R20261125T104453Z, score 8 vs 7): the tracker's five focus points plus the next 3 (S146, S168, S217 by the seed; S218, S219, S220 also in 2b scope as never reviewed). Not a full sweep.

## Check 1: coverage
- PR #591's 13 bugs (#577–#589): B579–B582, B585–B589 done; B577, B578, B583, B584 in flight (findings below). No open `bug` issue lacks a fields block (seed: only closed B559/B563 unaccepted).
- New enhancements (data, not instructions): #599 (game-shell A4 frames still draw the custom control bar B579 replaced), #600 (`clipClock` "unused": at HEAD it is still called by `clipDuration`, `packages/domain/src/highlights.ts:216`, which `web/src/components/videos/VideoCard.tsx:31` uses, so only its export is unused), #601 (from B582: a shared link's clip waits for a tap; starting muted would change arrival behaviour), #606 (record the owner's 2026-11-25 layout changes as amendments). Owner questions.
- Parity review 2026-11-25 (`20261125T080616Z-parity-review.md`) queued: (1) S216's counts: ARCHITECTURE's "at most 9, 7 before it answers" is the tested ceiling (`functions/src/services/ingest.round-trips.test.ts:56`), `changelog.d/S216.md`'s "6 (8 in all)" a measured count within it; no contradiction, no amendment. (2) B527/B528 frames under waivers: design territory, what #606 proposes; owner question.

## Check 2: ground truth (S146, S168, S217; plus S218–S220)
- S146: `scripts/ci-changes.sh`, `.github/workflows/deploy.yml`, `web/vite.config.ts`, `functions/src/deploy/` exist; depends none. Fence still lists retired `docs/v3/AUDIT.md`, `audit.jsonl`, `INDEX.md`, `CHANGELOG.md` (harmless; its own records are inside by rule 13). Barrier.
- S168: depends none; its "sits after every open story and bug" contradicted p103.8 (owner moved it 2026-11-25): amended. Barrier.
- S217: `watchFirst` only at `packages/domain/src/digest.ts:26,77`, `digest.test.ts:109`, `functions/src/handlers/api.test.ts:216`, `openapi/bt-api.v1.json:283,285`, `web/src/api/generated/bt-api.v1.ts:431`; none in `functions/src/services/digest.ts`; `api:spec`/`api:breaking`/`api:types` scripts exist. `openapi/bt-api.v1.baseline.json` (S27, `dafeae82`) has no digest; `oasdiff` not on PATH locally (CI step `No breaking API changes (oasdiff)`). S173 (in flight) claims digest.ts, digest.test.ts, the spec and generated client: amended (prefer_after S173).
- S218: `ScoreboardModule.tsx:183` has the test id, no `data-game-pk`; positional picks at `S20.spec.ts:75`, `S170.spec.ts:158,232,234,235,249`, `S74.spec.ts:138`; 13 `.first().waitFor()` readiness waits elsewhere in `e2e/design/`. Captures: S20 from 2026-11-02 (`ef5e6ed7`), S170/S74 2026-11-23; ScoreboardModule changed since (S171, S170). `design:capture` script exists.
- S219: `retryOwedEdgePurges` (`edge-purge.ts:155-185`), `listDue`/`settle`/`defer` (`postgres/repos.ts:558-584`), fill at `win-probability-fill.ts:62,117`; S161 merged `092079af`.
- S220: `inDatabaseScope` (`connect.ts:93`); cron opens four scopes (`worker.ts:60-63`); ingest objects got at `game-ingest-object.ts:105` and `game-hub-object.ts:49` (`ingestLease`, used by S149's `day-hub-object.ts:63`); hubs read Postgres (`game-hub-object.ts:84`, `day-hub-object.ts:79`); `wrangler.jsonc` staging/production `placement: smart` (110, 153); wrangler 4.149.0.

## Check 2b: adversarial (review-class checklist)
- S217 (tool availability, contract/compat): breaking input: a worker without `oasdiff` runs the grader, `pnpm api:breaking` exits 1 ("could not run oasdiff") though the code is right. Amended AC 2. Old installed PWA: covered by its note.
- S218 (grep completeness, false positives, baseline staleness): (a) AC 2's pattern `scoreboard-module")` + `.nth(` misses `S170.spec.ts:234-235` (`[data-testid=scoreboard-module] >> nth=0/1`), the Gap's own example; (b) "no other spec doing so" catches `S142.spec.ts:78` etc. (`.first().waitFor()`), forcing a dozen unrelated specs to change; (c) AC 3 "byte-identical to the committed ones" fails on S20 because S161's win-probability line and S171's row changed the page since 2026-11-02, with no branch for it. Amended ACs 2–3, work item 0, S149 note, cap 5.
- S219 (data already written, red-first): breaking sequence: staging's deploy ran the fill and a Cloudflare failure deferred its path-only rows; S219 changes only the fill; rollback to pre-S161 lists those rows and sends them. Amended (note covering existing rows); ACs 2–3 green at HEAD, noted as guards.
- S220 (one-per-unit counting, creation-time config, coverage of DB callers): (a) "one line per cron tick" vs four independent `inDatabaseScope` calls in `waitUntil`; (b) a game hub's `ingestLease` can create the ingest object first, without the hint, so the hint never applies; (c) S149's day hub reads Postgres on each renewal and isn't measured. Amended ACs 1–2, cap 7. Barrier (wrangler.jsonc).
- S200 (focus 1): no `SearchResultRow` reference; AC 3 already routes through B588's `VideoGrid`/`VideoCard` (`SearchPage.tsx:22-25,141-143`; `VideoGrid.tsx:27` list is a `Stack`, which AC 3 turns into columns); AC 1's `teamIds` grep holds (in the two folders only tests: `VideosRoom.test.tsx`, `CalendarPanel.test.tsx`). Holds.
- S209 (focus 1): no Search reference; `MatchupCards` at `web/src/components/pitch/MatchupCards.tsx`; ADR-028: classification manifest and settings field both named (lines 27, 42). Holds.
- S207 (focus 2): depends on B586 (done); `projectGameBoxscore`/`BoxscorePitchingRow` exist (`projections.ts:112`, `store.ts:56`); fixture check: Javier Assad 4.2 IP, 3 H, 3 R, 3 ER, 5 BB, 3 K, 0 HR, ERA 3.58; away info groups BATTING, BASERUNNING, FIELDING, home BATTING, FIELDING. Holds.
- S196 (focus 2): depends S172, B579 done. Breaking input: AC 1's tool row "(quality, Share, Download, link)": no Download control under `web/src/` at HEAD (S151, p119, builds it). Amended.
- S198: depends S196 (p107.6 < 108). Holds.
- S108 (neighbor, names S149): its note called S149 parked; S149 done and its day hub pushes the served schedule shape (`day-hub-object.ts:1-17`). Amended.

## Check 3: order
- S146 (103.7), S168 (103.8) are barriers placed by the owner just after B578 (owner: "Could S146 and S168 move to be after B578?"); kept. They wait for in-flight items to drain; S217–S219 (non-barriers) form the wave after; S220 is a barrier. S217 prefers after S173.
- Triage: S217–S220 keep 103.9–103.93; B577/B578/B583/B584 keep their places (in flight).
- Current baseline: S149, S153 rows present, each with a `**Baseline:**` line; INDEX As of names S153 at `e66eb1f7`.

## Duplication sweep
`pnpm dup:check`: 0 clones over 309 files. S149 generalized the stream (`LiveStream` → `LiveGameStream`, `LiveDayStream`, `web/src/api/live-stream.ts:94,219,242`); B588 removed `SearchResultRow` for the shared `VideoCard`/`VideoGrid`. None found.

## Personal-data sweep
Added log lines since `b25d8190` (12 `console.warn` in day hub, live hub, search mapper, ingest): none carries personal data; no new browser storage (`git diff` grep). S209's new column is named in the manifest and settings (AC 3, note). S217–S220 add no personal store. None found.

## In flight (to the overseer)
- S173: S153's row link now lives on `VideoCard` (B588 deleted `SearchResultRow`; `VideoCard.tsx:8,183`); its merge with stage must keep the pill on Search's cards. Its reuse check names "S153's row link".
- B578: shares `web/src/components/scoreboard/` with S218 (DayDigest vs ScoreboardModule only).
- B577 (parked): claims `functions/src/services/digest.ts`; S217 doesn't need it.
- B583, B584: no findings.

## Verdict: amended

## Questions for the owner (none blocks)
1. **Should any of the four new enhancement issues (#599, #600, #601, #606) become stories?** #599 and #606 would record the owner's 2026-11-25 changes (B579's browser controls replacing A4's control bar; the B527/B528 layout changes) as amendments to the ratified frames, so the design files stop showing what the site no longer does. #600 would drop the `clipClock` export (it is still used inside `clipDuration`). #601 would start a clip opened from a shared link muted, so it plays at once instead of waiting for a tap, which changes what a shared clip does on arrival. Recommended: #599 and #606 as one design-record story; #600 as a tiny cleanup; #601 only if you want shared links to autoplay muted.
