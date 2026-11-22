## 2026-11-21 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-22T04:39:15Z` |
| HEAD at review | `cf9a6805` (tree dirty) |
| Trigger | 6 stories done since last review |
| Stories `done` since last review | S158, S166, S131, S167, S160, S132 |
| In flight | none |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

query: seed backlog --since 434a3f62 → S125, S131, S158, S159, S166, S167, S168, S130, S124, S136, S81, S138, S132, S135, S146, S151, S145, S155, S128, S139, S140, S160, S134, S142, #315, #299, S165, S164, S163, S162, S161, S157, S156, S154, S153, S152, S150, S149, S148, S147, S144, S143, S141, S137, S133, S129, S127, S126, S123, S122, S121, S120, S119, S118, S117, S116, S115, S114, S113, S112, S111, S110, S109, S108, S107, S106, S105, S104, S103, S102, S101, S100, S99, S98, S97, S96, S95, S94, S93, S92, S91, S90, S89, S88, S87, S86, S85, S84, S83, S82, S80, S79, S78, S77, S76, S75, S74, S73, S72, S71, S70, S69, S68, S67, S66, S65, S64, S63, S62, S61, S60, S59, S58, S57, S56, S55, S54, S53, S52, S51, S50, S49, S48, S47, S46, S45, S44, S43, S42, S41, S40, S39, S38, S37, S36, S35, S34, S33, S32, S31, S30, S29, S28, S27, S26, S25, S24, S23, S22, S21, S20, S19, S18, S17, S16, S15, S14, S13, S12, S11, S10, S9, S8, S7, S6, S5, S4, S3, S2, S1
query: issues --since 2026-11-21T15:49:29Z → #315, #308, #305, #304, #299, #297, #296, #295, #294, #293, #292, #291, #290, #289, #288, #287, #286, #285, #284, #283, #282, #281, #280, #279, #278, #277, #276, #275, #274, #273, #272, #271, #270, #269, #268, #267, #266, #265, #264, #263, #262, #261, #260, #259, #258, #257, #256, #255, #254, #253, #252, #251, #250, #249, #248, #247, #246, #245, #244, #243, #242, #241, #240, #239, #238, #237, #236, #235, #234, #233, #232, #231, #230, #229, #228, #227, #226, #225, #224, #223, #222, #221, #220, #219, #218, #217, #216, #215, #214, #213, #212, #211, #210, #209, #208, #207, #206, #205, #204, #203, #202, #201, #200, #199, #198, #197, #196, #195, #194, #193, #192, #191, #190, #189, #188, #187, #186, #185, #184, #183, #182, #181, #180, #179, #178, #177, #176, #175, #174, #173, #172, #171, #170, #169, #168, #167, #166, #165, #164, #163, #162, #161, #160, #159, #158, #157, #156, #155, #154, #153, #152, #151, #150, #149, #148, #147, #146, #145, #144, #143, #142, #141, #140, #139, #138, #137, #136, #135, #134, #133 (as of 2026-11-22T04:27:23.000Z)
query: item S159 → S159
query: item S125 → S125

Read through `text-records.ts newest`: S159, S125, S130 (next 3), S168 (inserted), S167 (inserted, done), S138, S134, S135 (dependents/neighbors), S166 (Source line). Debt: `{"due":true,"base":"1915dea8","done":[S158,S166,S131,S167,S160,S132],"inFlight":[],"events":[count]}`; no turn-cap hits.

**Check 1, coverage.**
- Parity queue (2026-11-21 parity review, `audit/2026-11-22/20261122T025907Z-parity-review.md:44-45`): its one item, S159's literal reading that the All-Star Game's day carries no mark against A8's red, is the open /pending question "All-Star day mark" (blocks S159 and S125). No amendment.
- `releases/**` gap (S131/S132): `functions/src/scripts/release-check.test.ts:172` (`checkReleasesDir(RELEASES_DIR)`) and `release-bundle.test.ts:48,:104` read `releases/`, but `turbo.json`'s `globalDependencies` (lines 7-19) omit it, so a PR that adds only `releases/v4.0.0.json` replays functions' `test:coverage` from the cache (S152's PR cache read) and the drift check first runs on `stage`. This is a shipped defect, hit exactly when v4.0.0's notes land. S168 (p120, not a 4.0.0 target) owns per-task inputs; note added to S168. Finding for the coordinator: file it as a bug (one line in `turbo.json`, a barrier) to land before v4.0.0's notes.
- #315 (enhancement, owner-filed from S166's pre-PR review): still open at HEAD: `e2e/select-specs.ts:192` (`import.meta.filename === process.argv[1]`) and `web/src/api/codegen.ts:51`. No story owns it. Owner question.
- Open bugs: B81 (93, beside S157 "status marker for suspended and delayed games", 93): priority still fits (both about game status). No other bug in the seed.
- No new ADR, no new package since `434a3f62`.

**Check 2, ground truth (next 3 by priority: S159 73, S125 74, S130 77).**
- S159: depends S136 done, S167 done. Paths: `packages/domain/src/schedule-month.ts` exists; `dayHasFavoriteTeam` :134, callers only its own file/tests (grep over packages, web/src, functions/src); `dayRegularSeason` :88; `ScheduleDayCount.teamIds` :56, `regularSeason` :65; the comment the note cites moved from :42 to :51. Fence `packages/domain/` etc. holds AC 1-3. Cap 6: assumption holds (one function, one removal). Waits on the All-Star question.
- S125: depends S124, S136, S167, S81 done; S159 todo (blocked on the same question); design S123 done. `DateControl.tsx`, `routes.tsx`, `layout/variant.ts` (`useLayoutVariant` :17), `api/scoreboardDate.ts` (`useScoreboardDefaultDate` :20), `settings/store.ts`, `LiveIndicator.tsx` (`useReducedMotion` :4) exist and are untouched since `434a3f62`; `latestScheduleMonth` :196; `MLB_TEAMS` `packages/domain/src/teams.ts:23`; `fetchScheduleMonth` `web/src/api/client.ts:77`, generated type carries `regularSeason` (`bt-api.v1.ts:725`); `web/package.json` `@mantine/*` `^7.17.1`, no `@mantine/dates`. `pnpm design:capture S125` and `e2e/design/` exist. Cap 16 unchanged.
- S130: depends S128, S139, S140, S160, S81 done; design S129 done. `StandingsPage.tsx`, `api/standings.ts` (`useStandings(date, phases)` :38), `standings-phase.ts` (`standingsPhase` :59, `standingsPhases` :172, `standingsChampion` :320), `clinchIndicator` `types.ts:417`, `wonOn` `scoreboard-date.ts:23`, `SeasonCalendar.lastGameDate` :35, `includePhases` handled `functions/src/handlers/api.ts:336`, `.mantine-Tabs-tab` `web/src/styles.css:95`, `formatDate` `datetime.ts:42`. Cap 16 holds.

**Check 2b, adversarial (checklist §7 classes applied: named-reuse vs. drawn output, fence vs. rule, stale line refs, cache/input completeness, barrier paths).**
- S130 AC 3 (amended): "one named function in datetime.ts" — the only one that writes a year is `formatDate`, which renders `2027-03-02` as "Mar 2, 2027"; A9 (`A9.md:38,53,80-83`) draws "March 2, 2027" and "December 1, 2026", and AC 4's "October 28, 2026" reuses AC 3's function. Input that breaks it: `/standings?date=2027-03-02` passes RTL as written and fails the design match. AC 3 now names the full month and its tests.
- S130 AC 4: box rule vs. `standingsChampion` (served from `wonOn` on, until the next spring); the box's stricter rule (not on `wonOn`, through Jan 31) narrows it; reuse check now names it so it is not re-derived.
- S130 AC 1 "What the page asks for": `includePhases=regularSeason` still returns every phase's dates (api.test.ts:337-403); holds.
- S159 AC 1: the cases cover empty favorites, null/missing teamIds and regularSeason, duplicates, out-of-month favorites; no breaking input found. AC 2 grep holds at HEAD.
- S125 ACs 1-8: unchanged since the 2026-11-19/20 reviews; nothing they read changed. Fence lists `CHANGELOG.md`, `docs/v3/AUDIT.md`, built `audit.jsonl`/`INDEX.md` — an implementer could read the fence as licence to edit `CHANGELOG.md` against rule 16; S125's new note says none is edited (S130, S138, S134 carry the same stale entries; harmless as "no files outside" allowances).
- S168 (inserted 2026-11-21): AC 4 already generalises inputs; note added for the concrete `releases/**` case.
- Barriers (the brief's ask): computed with `claims.ts`'s `normalizeEntries`/`claimReviewerFlags`/`isBarrierPath` on each fence: S159 `packages/domain/`; S125 `web/package.json`, `web/vitest.config.ts`; S130 `web/vitest.config.ts`, `packages/domain/`; S138 `web/vitest.config.ts`; S134 `web/vitest.config.ts`; S135 also `web/vite.config.ts`. Every one is there for rule 21's ratchet (or AC 4's dependency), so every code story is a barrier and the run serialises; run-backlog step 3.2 meanwhile calls any `vitest.config.ts` a shareable hot file. Notes added to S159, S125, S130; owner question on the rule.

**Check 3, order.** S159/S125 wait on the All-Star question, so S130 (77) is the first buildable; it must land before 2027-02-19. S138 waits on S125 and parked S155. S134 (81) is buildable after S130. No story made obsolete; S126 done (baseline fixed). Process stories S158/S166 shipped without a recorded turn-cap hit (debt events: count only).

**Current baseline** (rule 17): all six done stories are reflected (S158, S166, S131, S167, S160, S132 rows and the As of line, S132); fixed two stale sentences: Scoreboard row's "A collapsed bar still expands in place; … S126" (S126 done, `CollapsedBar.tsx:49` links to `/game/<gamePk>`), PWA row's "S131 … waits for v3.1.0" (S131, S132 done).

**Duplication sweep.** `pnpm dup:check`: 0 clones (249 files). Searched the six stories' additions: `gameType "R"` only in `dayRegularSeason` (`schedule-month.ts:90`; `backfill.ts:94` reuses `storedGameType`); clinch letter mapped once (`functions/src/mappers/standings.ts`). One hit: release version parsing and comparison twice, `scripts/release-order.sh:33-55` (bash regex, accepts `v3.01.0`) and `packages/domain/src/release-notes.ts:101,120` (`parseReleaseVersion` rejects leading zeros, `compareReleaseVersions`). Low risk (`pnpm release:check` rejects any tag the bash accepts and the domain rejects, before a deploy), tooling under `scripts/` and `.github/` (a barrier, a CI change the owner approves); passed to the coordinator for the wave-boundary rules pull request rather than a story.

**Personal-data sweep (ADR-028).** Next 3 add no table, field, outside service, browser key or log line: S125 reads `favoriteTeamIds` from the existing settings store (ADR-028 row "BT database: settings", `personal-data.ts:11`). Added code since `434a3f62`: the new `console.*` lines are `release:bundle`/`release:check` CLI output (paths, validation lines), no personal fields. The release notes' quoted owner approval is the open /pending question. None found.

**In flight:** none. `claims.ts review-edits` exit 0.
