## 2026-11-28 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-28T13:45:52Z` |
| HEAD at review | `3c3339dd` (tree dirty) |
| Trigger | inside run R20261128T131047Z: the hard ceiling (rule files changed by #727, #728, #731) and the review tracker's score 8/7; focused mid-run review |
| Stories `done` since last review | none (0 of 6) |
| In flight | S108, S250 |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

**Focused mid-run review** (run R20261128T131047Z; run-backlog step 2, "Reviews inside a run"): the tracker's focus brief plus the next 3 items (S251, S256, S253), check 2b over every story inserted, re-scoped or rewritten since the last review, and check 1b. Not a full sweep. Long evidence: `.run/reports/review-20261128b.md` (git-ignored).

query: seed backlog --since 9f035587 → S224, S230, S231, S232, S233, S234, S236, S250, S251, S253, S254, S256, S258, S259, S260, S261, S227, S222, S223, S225, S226, S104, B614, S237, S201, S235, S202, S203, S81, S204, S176, B613, S177, S108, S252, B334, B616, S257, B720, S181, B730, #726, S229, S228, … (and the done items whose issues were closed since the window)
query: issues --since 2026-11-28T07:03:15.000Z → #733, #732, #730, #726, #720, #716 … #84 (as of 2026-11-28T13:31:13.000Z)
query: item S251 → S251
query: text S227 → S224, S227
query: text S229 → S229, S252, S253
query: text S252 → S251, S252, S253
query: text S257 → S256, S257, S258, S259
query: text S261 → S251, S261
query: text Download → S79, S80, S151, S195, S196, S251, S252, S253, S261
query: group design-checks → B613, B614
query: group port-comments → B334, B616

## Tracker focus, verified

1. **S251 (S261 folded in).** Every S261 AC is S251's AC 6–9 (S261's last record `20261128T131442Z-S261-edit.md`, ACs 1–4, owner answer and fence all carried). HEAD: `web/src/pwa/download.ts`, `sw.ts:73-76` (route + `NAVIGATION_DENYLIST` with the download path), `PlayerActions.tsx`, `video-quality.ts:189` ("…Share and Download (S151"), `VideoPlayer.tsx:130` ("download (S151)") and `:263` ("it stays paused"), `highlights.ts:247` (clipClock names S70's elapsed time) and `:269` (clipDuration calls clipClock) all exist as the story says. `isMlbClipMp4`/`MLB_CLIP_HOSTS` are read only by `video-quality.ts(.test)`, `PlayerActions.tsx`, `download.ts` (grep). Every name AC 2's grader bans is read only by `download.ts`, `sw.ts`, `PlayerActions.tsx` (grep over non-test `web/src`). `Download` buttons in tests only in `PlayerActions.test.tsx` (in fence); no e2e clicks it. `.size-limit.json` has one entry (200 KB); `scripts/verify-S110.sh:66` reads `c[0].limit`; `tools/size-limit/size-limit.test.js:50` pins `["200 KB"]` (in fence). A build's hls.js chunk is `hls.light-<hash>.js` (main checkout's `web/dist/assets/`), so a glob matches it alone without `web/vite.config.ts` (AC 6's stop rule won't fire). Baseline PWA row (frame 01 line 16) names S151's route; gap map line 45 already names S251. Rule/text consistency: S251's note leaves CLAUDE.md's and rule 18's S151 exception and ADR-029's clip-CDN sentence to the owner; the exception text stays historically true until S251 ships and is queued for the next rules pull request (recorded in frame note 00), not edited here (rule files). No finding.
2. **S256 (S257 folded in).** S257's ACs 1–7 are S256's ACs 6–12 (S257 create record `20261128T043849Z`). ADR-004 (ARCHITECTURE.md:580-600: "Payments / membership funding: Remain on Patreon") and ADR-019 (:1145, "payments stay on Patreon"; Patreon linking stays BT code) are what AC 12's proposed amendment changes, and the story never marks it accepted: consistent with CLAUDE.md's "Patreon = linked payments/tier only (ADR-019)", which an accepted amendment would later make stale (the owner's call then). Source "Free vs paid; Payments / pledges; Modern membership": all three FEATURES rows exist (lines 298, 294, 93) and name S256; honest. `scripts/verify-S141.sh` and `docs/v3/AI-RESEARCH-2026-11.md` exist. **Finding (amended):** AC 7 asked for Patreon's fee on "the legacy plan BT's page is on"; nothing in the repository records it (grep of docs for legacy plan / Patreon plan names: none), so a worker would guess. Now every legacy plan is listed and the owner is asked which is BT's.
3. **S253 (S229 folded in).** S229's ACs 1–3 and fence are S253's AC 6 (S229's last record). Design exemption recorded on its own line, naming rule 18's S151 exception as the only written one and the rules PR to name S253; no tooling blocks it (`design: []`; `claims.ts`/`backlog:check` read only **Design:** lines). Waits for the owner's wording: `.pending/needs-input.md` "S253: the MLB credit's words", Blocks: S253, asks AC 3 (a)–(c). HEAD: `SiteFooter.tsx:106` "© {copyrightYear(…)} Baseball Theater", `SiteFooter.test.tsx` exists, `VideoPlayer.tsx:391` "Disclaimer:", `compact` prop (:156-172), `slug` typed in `content.ts:52,118` and `graphql-content.ts:34`, the mapper keeps `id: item.id ?? item.slug ?? item.title` (content.ts:80) and drops the slug; videos come from the content feed only (`graph-content.ts` adds play refs and articles); `fixtures/raw/content-823823.json` has 40 clips, every id equal to its slug and matching `[a-z0-9-]+` (node check); the six other highlight fixtures exist; `about.md:13` "Where the data comes from"; `LegalPage.test.tsx`, `verify-S127.sh`, `pnpm api:breaking` exist; `https://www.mlb.com/video/<that slug>` answers 200 from this sandbox, so AC 1's check can run. **Finding (amended, ADR-025):** `playerProfileUrl` (`packages/domain/src/player-links.ts:42`) is the one existing MLB.com page-URL builder; the reuse check now names it.
4. **Superseded references.** No open item's `depends_on` or `prefer_after` names S227, S229, S252, S257 or S261 (fields of S224, S251, S253, S256, S258, S259 read). Text mentions are history notes only (S224 "from S227, folded in"; S258 "S257's, folded into S256"; S259 "it was the S257 edge"). Frame note 05 line 20 and line 52 already name the absorbers. FEATURES' Modern membership (line 93) and Payments / pledges (line 294) rows still cite S257: the parity review's scope, reported. **S260 vs the next three:** S260 (`functions/src/`, `packages/domain/`, `packages/ports/`) shares no named file with S251 (video files) or S256 (docs); with S253 it shares only hot files (`packages/domain/src/index.ts`), and S260 must not change `openapi/` (its AC 2); S253's `content.ts`/`types.ts` and S260's ingest/repair files are disjoint.
5. **Rule changes vs the three.** #727 (check 1b) changes only this review. #728 (effort trial) alternates worker effort by item in the first run after it; none of S251/S256/S253's ACs or caps depend on effort; S224's AC 13 edits run-backlog step 3's Concurrency paragraph, beside which the trial paragraph now sits (a text neighbour, no conflict in substance). #731 (`/backlog list N`) is read-only. **S108/S250 vs the next three fences** (claims in `.run/claims/`): S251 is a barrier (`.size-limit.json`, `tools/size-limit/`), so it waits for both; S253's fence holds `packages/domain/src/types.ts`, which S250 claims (and S108 claims domain and web files), so it waits for S250, as its prefer-after says; S256's fence meets S250's claim only at `docs/v3/backlog/frame/01 Current baseline.md`, which a research story needn't edit.

## Check 2: ground truth, next three

- **S251** (p121.02): paths above; depends on none; turn cap 7 holds (S251 4 + S261 5, one grader and one fix round shared); fence fits every AC (all edited files under `packages/domain/`, `web/src/components/videos/`, `web/src/pwa/`, `web/vitest.config.ts`, `.size-limit.json`, `tools/size-limit/`); commands `pnpm size` (package.json:54), `pnpm comments:stale` (:31) exist.
- **S256** (p121.025): research; paths `entitlements.ts`, `data-classification.ts`, ARCHITECTURE ADRs, FEATURES rows exist; prefer after S250 (`doing`); cap 12 excludes owner wait; fence fits (docs only plus its grader).
- **S253** (p121.031): paths above; prefer after S250 (`doing`) and S251 (`todo`); cap 9; fence holds every file AC 1–8 names (`fixtures/`, `openapi/`, `web/src/`, `functions/src/`, `packages/`).

## Check 2b: the checklist (LOOP.md §7), per story in scope

- **S251:** 9 (generated files: none regenerated), 11 (AC 1 Download gone vs AC 1 Direct link unchanged: consistent), 14 (hls glob matches `hls.light-*` only, never `index-*`), 18 (gap map row already names S251, AC 5 excludes it), 25 (limit in KB as the entry chunk's), 30 (removals checked against every reader: grep above), 34 (owner quotes match FEATURES line 59 and gap map line 45). No finding.
- **S256:** 10 (`prefer_after: S250` only), 11 (AC 4 before AC 11, AC 10 waits on AC 4: consistent), 17/33 (fee table rows cite page and date), 28 (AC 4 and AC 11 edit FEATURES in the owner's words), 34 (quotes match FEATURES lines 93, 294, 298). Finding on AC 7 (above).
- **S253:** 3 (stored finals keep no URL, said), 6 (`/api/v1`, additive spec, `api:breaking`), 7 (no new MLB request), 9 (`openapi/`, `web/src/api/generated/` in fence), 13 (n/a), 14 (slug pattern rejects `/`, `?`, uppercase), 28 (AC 3's leave-it-out answer goes to the coordinator for FEATURES), 34 (S229 sentence carried verbatim). Finding on the reuse check (above).
- **S260** (inserted): 1 (stop between ask and clear: at most once more), 2 (cursor row durable), 3 (partly stored extras asked only for what's missing), 5 (only past finals), 7 (4 MLB requests a tick, 5,760 a day ceiling), 21 (mark never touches `version`), 26 (exceptions: a pick named after 7 days left out, said). DB list (`.claude/agents/db-reviewer.md`): nullable column on `games` (no rewrite), partial index on marked rows, scan on `games_official_date` (schema.ts:110-118: `games` has only `game_pk`, `official_date`, `version`, `document`). **Finding (amended):** AC 2 let the late step clear the mark "whether MLB answered or not"; `storeLateAnswers` (ingest.ts:1243) returns without writing when `late` is null, so with every late ask past `LATE_ASK_LIMIT_MS` the step ends with nothing: under the old text the mark is cleared and the game, the very cut-off #719 names, is never re-asked. Now only an answered late step clears it, with a test. AC 4's "never its whole document" was half true: status and extras live only in `document`, so the scan reads each document inside Postgres once per game; now stated, with buffers recorded.
- **S224** (S227 folded in): 10, 11 (AC 12 "unchanged" vs AC 11's new clean rule: `concurrencyFromRuns` reads `summarizeRun`'s clean, consistent), 24, 35 (new agent frontmatter, law L18). HEAD names: `summarizeRun`, `concurrencyFromRuns`, `prePrFindingsByPr`, `runRecordOf`, `underBar`, `MIN_ITEMS` in runs.ts; `RUN_KINDS`, `isBarrierPath`, `PACKAGE_OWN_CONFIG`, `HOT_FILES`, `hotKeys`, `reviewerFlags` in claims.ts; `review-tracker.md` has `tools: Read, Grep, Glob`, `model: haiku`. No finding.
- **S258, S259** (repointed to S256): 10 (`depends_on` S256 (+S258); no S257), 18 (notes say S257's part is S256's). No finding.
- **S236** (owner answer: own stance-chunk budget): 11. **Finding (amended):** AC 5's test asserted "both entries' limits", but S251 (121.02) lands first with the hls.js entry, so there are three; now appends after the existing entries and asserts every entry, matching S251's note.
- **S230, S231, S232, S233** (owner answers: totals stored with the game, earlier-season notice): 4, 5, 6, 12, 21. HEAD names `CACHE_LIFETIME_FLOOR_MS` (cache-control.ts), `inDatabaseScope` (connect.ts), `schedule_days`, `game_states.official_date`; S233's `servedSeason`, `factsBatchDue`, `PLAYER_FACTS_EXTRACTOR_VERSION`, `PLAYER_DAILY_FIGURES_CACHE_CONTROL` are S233's own. S232's route and kinds match S230 AC 6. They went through a change review (f4c8ef47). No finding.
- **S250** (in flight): its text names S256 as the decider, no S257/S252; no finding for the overseer.
- S254, S234: rewritten only by the last review itself (its own edits, 071657Z/071658Z); not re-reviewed.

## Check 1: coverage

- ADR-014 point 3 changed (4968d442): "faster live refresh" no longer a patron perk; S250 (in flight) carries it; no new work.
- The last review's **For the next review** (frame note 00): A8 edits to S231/S232/S253 checked above, S252 superseded; #720 answered (accepted as B720, now superseded by S260, re-placed); the S151 passages: queued for the rules pull request (CLAUDE.md, rule 18) and the owner (ADR-029); Savant links and faster live refresh: answered (4968d442), off `.pending`; the gap map's "Savant deep links (Pro Backer gate)": already fixed at HEAD (frame 05 line 20 names S250); S254's second Source: the parity review's; carried #719, #721, #619 now S260's; #696 (Ideas), #654, #609, #634, #643: not updated since 2026-11-26 (gh), stand.
- No parity entry since queued items for this review.
- **B730** (#730, filed under the owner's account by an agent; no fields block): accept at **121.019** (before S251): a flaky `PlayerDialog.test.tsx` timing test turns any pull request's `ci-passed` red; its file is outside S108's and S250's claims, so it can run now, and S251's fence (`web/src/components/videos/`) would otherwise hold it back.
- Gap map: S260 had no row; added.

## Check 3: order

- **B720** sat at 121.057, before S260 (121.0575), which supersedes it: a run would build B720 first, leaving S260's AC 1 green on HEAD (rule 9). Moved to 121.0576. Better still, the coordinator closes it as superseded now.
- S251 (barrier) before S256: kept. S256 is docs-only and could run beside S108/S250 while S251 waits, so the coordinator may dispatch S256 first by eligibility; the order itself stands.
- Current baseline (frame 01): 0 stories done since the last review, so no row drifted; S251 will rewrite the PWA row (its AC 5).

## Duplication sweep

No story done since the last review; code changed since `9f035587`: none (only `.claude/`, CLAUDE.md, ARCHITECTURE.md, FEATURES.md). `pnpm dup:check`: 341 files, 0 clones. Next stories: `mlbVideoPageUrl` vs `playerProfileUrl` (amended into S253's reuse check); S260 reuses `askedExtraDue`, `recordSourceDay`, `keepStoredExtras` (named in its reuse check).

## Personal-data sweep

S251 removes a route, adds no store or log; S253 adds `mlbPageUrl` (MLB's public clip URL, not personal) and copy; S256 is research whose AC 9 names ADR-028 and the manifest for any provider; S260's column and cursor table are labelled `none` in `data-classification.ts` (no user data); no new `console.*` line in any (their ACs log only S220's round-trip line). None found.

## Issue triage

triage: since 2026-11-28T09:00:00Z → #334, #730, #720, #616, #614, #613 (as of 2026-11-28T13:41:34Z)
#334 group: already accepted as B334 in group port-comments with B616 (text record `20261128T123653Z-B334-create.md`); nothing to change.
group design-checks (decided earlier, unchanged): B613, B614 — `e2e/design/` captures; no changed bug joins it.
group port-comments (decided earlier, unchanged): B334, B616 — port doc comments; no changed bug joins it.
No new group: B730 (`web/src/components/videos/PlayerDialog.test.tsx`) has no partner among the open bugs; B720 is superseded by S260; accept #730 as bug (priority 121.019), alone.

## Questions for the owner

- **Should ADR-029's sentence letting the service worker fetch a clip from MLB's clip CDN for S151's Download be amended once S251 removes Download?** (S251's note; an accepted ADR is the owner's.)

## In flight (for the overseer)

S108, S250: no AC findings. Scheduling only: S251 waits for both (barrier); S253 waits for S250 (`types.ts`).
