## 2026-11-26 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-26T04:26:50Z` |
| HEAD at review | `bae7cf9a` (tree dirty) |
| Trigger | run R20261125T180846Z hard ceiling: S146 (PR #658) changed .claude/skills/release/SKILL.md and docs/v3/LOOP.md (focused review: S146's rule changes plus the next 3, S168, S198, S207) |
| Stories `done` since last review | S100, S146 |
| In flight | none |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

# Backlog review 2026-11-26 (focused, run R20261125T180846Z, third) — findings

Focused mid-run review (ceiling: S146 changed `.claude/skills/release/SKILL.md` and `docs/v3/LOOP.md`), not a full sweep. Focus: S146's rule changes vs open stories; next 3: S168, S198, S207. Nothing in flight.

query: seed backlog --since 7550d605 → S146, S168, S198, S207, S196, S209, B586, B433, S210, S103, #619, #643, #654, B652, S221, B642, S200, S100
query: issues --since 2026-11-25T23:23:22.000Z → #654, #652, #647, #642, #469, #455, #451, #308, #278, #232 (as of 2026-11-26T04:13:15.000Z)
query: text deploys staging → S116, S118, S146
query: text deploy staging → S116
query: text staging deploy → S116, S146, S156
query: text every push to stage → S152
query: text merge deploys → S146
query: text prepare step → S146
query: text docs-only → S146, S152, S158, S165
query: text build:inputs → S146
query: text build inputs → S146 (open: S176, S209 only by word match)
query: text stage.baseball.theater → S114, S116, S117, S118, S119, S143, S146, S212, S215 (all done)
query: text deploy.yml → open: S168, S176, S209
query: text staging → open: S176
query: path .github/workflows/deploy.yml → open: S176, S209
query: path package.json → open: S90, S168, S174, S176, S177, S183, S185–S189
query: text served commit → S146
query: text prepare → S31–S38, S84, S117, S146 (all done)
query: text release check → S164, S168
query: text wrangler rollback → S114, S119, S131, S133, S135, S146 (all done)
query: item S168 / item B578 → B578 done

## Focus: do S146's rule changes make an open story untrue?
- Release prepare step (1) now qualifies a later candidate by `pnpm build:inputs check`; LOOP §9 no longer says every merge deploys stage. Searches above: no open story names the prepare step, "served commit", "merge deploys" or "wrangler rollback". S176 and S209 mention deploy.yml/staging only for their own secrets/cron steps (grep of their records: no deploy-gate assumption).
- Release skill's "`releases/` is code to the deploy, so that pull request's merge deploys staging" still holds: `functions/src/generated/release-notes.json` is imported by `functions/src/services/releases.ts` (Worker graph), so a notes PR changes a build input.
- S168 is the one story relying on Deploy's gate: finding 1 below.

## S168 (todo, p103.8) — amended
Check 2: every fence path exists at HEAD (package.json … scripts/claude-review/plan-review.py, verify-chain.ts/.test.ts, ci-law.test.ts, e2e/select-specs.ts, scripts/ci-changes.sh); depends on nothing; B578 done (owner's placement after it); ADR-030 free (ARCHITECTURE ends at ADR-029, line 1403). Gap drift: `test:coverage` now runs the root suites through `concurrently` (c632fdf4), not one after another — corrected; `releases/**` IS in turbo.json globalDependencies now — note updated.
Check 2b (items 9, 14, 20, 24, 26):
1. (item 20) AC 6 named only "the production deploy's gate (deploy.yml's verify step)". deploy.yml's `verify` job runs `pnpm verify` on push to stage, release and workflow_dispatch (S146's force), and `staging-inputs`/`staging` need it. Break: S168 makes `pnpm verify` narrow against merge-base with `stage`; on a push to stage HEAD==stage → nothing affected → staging deploys unchecked, and the grader's "push path" (ci.yml) still passes. Amended AC 6 + grader sentence to all three events.
2. (items 24, 26) S146 added cross-unit reads with no workspace dependency: `web/vite.config.ts:7` imports `../functions/src/deploy/vite-plugin.js`; `functions/src/deploy/vite-plugin.test.ts:17` reads `web/vite.config.ts`. Break: AC 4 lets each be declared as a named input, but AC 8's allowed misses (own unit, root tasks, law-test unit) exclude them, so an edit to `web/vite.config.ts` (web is a leaf) lists functions' test as a miss and AC 8 fails; and `functions/src/deploy/` is outside the fence so the plugin can't be moved. Amended AC 8 to allow a task declaring that file as a cross-unit input, listed in the ADR. Note also: at HEAD the read is undeclared, so a PR touching only vite-plugin.ts replays web's build from cache (low impact: Deploy builds web fresh).
3. Note: S146's `namedInputs` counts every workspace package.json/tsconfig as a staging build input, so units S168 adds make extra (safe) staging deploys; S168's own merge changes package.json/pnpm-workspace.yaml/deploy.yml, all build inputs.
Duplication (ADR-025): workspace dirs computed twice — `e2e/select-specs.ts:42` hard-codes `WORKSPACE_DIRS`; `functions/src/deploy/build-inputs.ts:113` `workspaceDirs` parses pnpm-workspace.yaml. Added to S168's notes (its reuse check already covers select-specs); build-inputs' copy stays outside its fence.

## S198 (todo, p108) — continue
Check 2: depends on S196 (done). Paths exist: VideoPlayer.tsx, PlayerStage.tsx, PlaysPanel.tsx, SearchPage.tsx, DayDigest.tsx, NoticeSlot.tsx, routes.tsx, e2e/flows. Hosts: `git grep -l '<PlayerHost\|<LazyPlayerDialog' web/src` → PlaysPanel, DayDigest, PlayerHost, VideosRoom, SearchPage (four hosts as AC 1 says). PlayerStage key still `${video.id}:${autoPlay}` (line 111), the note's premise holds. Since 7550d605 only S200's VideosRoom/VideoCard/VideoGrid and SearchPage.test changed under web/src (already noted); S146's vite.config.ts change is outside its fence and irrelevant to it. S100's ruleSettings doesn't touch the player. Checklist items 11, 22, 23 rechecked against the notes: unchanged. Turn cap 9 assumption unchanged.

## S207 (todo, p108.03) — amended
Check 2: depends B586 done, prefer-after B433 done. Paths exist: BoxRoom.tsx, projections.ts (projectGameBoxscore:112, BoxscorePitchingRow), functions/src/mappers/live.ts (mapBoxscore:204), packages/mlb-api/src/live.ts, fixtures/raw/live-823823.json; /home/user/baseball-theater-legacy/client/src/Areas/Game/BoxScore.tsx present. S100 snapshot shape: `GameSnapshot.ruleSettings?` optional (types.ts:351), no conflict.
Check 2b:
1. (item 9) `GameBoxscore`, `BoxscoreBatter`, `BoxscoreInfoLine` are schemas in `openapi/bt-api.v1.json` (lines 198–336), generated from domain types; `functions/src/services/openapi.test.ts:48` asserts the committed spec equals the generated one. Break: AC 1 extends GameBoxscore with pitchers → spec must regenerate → `openapi/` outside fence → rule 10 stop. S100 regenerated it in 362122d8. Amended: fence + goal add `openapi/bt-api.v1.json`; AC 1 says new fields optional, regenerate with `pnpm api:spec`, baseline untouched, `pnpm api:breaking` exits 0.
2. (item 26) `functions/src/adapters/fixtures/bundled.test.ts:35` requires every served fixture (`game-\d+`, `plays-\d+`, `players-.+`, raw/playmetrics|potg|uniforms|rulesettings|graphql-content) to be imported in `bundled.ts`. Break: AC 3 records ≥5 games via record-fixtures (raw + normalized) → bundled.test fails → `pnpm verify` red; bundled.ts outside fence. Amended: fence adds bundled.ts; AC 3 says served files go there. Note: ~0.9 MB of served JSON per game (823823's files) joins the Worker.
Personal data: none.

## Personal-data sweep (ADR-028)
S146: build-inputs records (file hashes, commit, origin URL) stored as Actions artifacts — no personal data. S100: ruleSettings (game rules) — none. S200: grouping state, no new store (`git diff 7550d605 HEAD -- web/src functions/src packages` grep for localStorage/sessionStorage/console.*/email: only test git config `user.email=t@t` and a CLI console.log of build-input lines). S168/S198/S207: no new table, field holding personal data, service, browser key or log line. None found.

## Duplication sweep
Above (workspace dirs, two copies). S200 `byTeam` counting is in packages/domain/src/highlights.ts:108 (one place). jscpd not run here; S146's `audit.sh story` ran `pnpm verify` (dup:check included) exit 0 (docs/v3/audit/2026-11-26/20261126T031701Z-S146-completed.md:13); S100's likewise (20261125T233231Z-S100-completed.md).

## Check 1 coverage / bugs / issues
- #654 (enhancement, PGlite per worker, from B652): enters only as a story the owner asks for — no action.
- #642 accepted as B642 (p121.02, after S174) — order fits. S221 (p121.05) — fits after B642; no change.
- #619, #643, #609, #634: carried, no change.
- No open bug without a fields block among the issues seeded.
- Previous review's "for the next review": S100 asked rule settings off the fetch path (ingest.ts keepStoredExtras:372; backfill EXTRA_SOURCES includes ruleSettings, backfill.ts:69); #642 accepted; S146/S168 rule-file changes → this review.

## Check 3 order
S168 (103.8) after S146 (103.7, done) as the owner placed; it's a barrier and nothing is in flight, so it can start now. S198 (108) and S207 (108.03): independent, order fine. No triage question.

## Current baseline
S146, S100, S200 rows present in frame 01; each has its `**Baseline:**` line.
