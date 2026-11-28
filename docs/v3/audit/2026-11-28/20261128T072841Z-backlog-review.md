## 2026-11-28 — backlog review (`amended`)

| | |
|---|---|
| Entry | backlog review pass |
| Captured (UTC) | `2026-11-28T07:28:41Z` |
| HEAD at review | `879138cb` (tree dirty) |
| Trigger | design intake: game-rooms A8 (ratified 2026-11-28) and new design pairs S231/S232, S235/S236, S252/S253, S258/S259 |
| Stories `done` since last review | S104 |
| In flight | none |
| Turn-cap hits read | none |
| Verdict | `amended` |

**Findings / amendments**

Design intake for game-rooms A8 (ratified 2026-11-28, text only) and the new design pairs S231/S232, S235/S236, S252/S253, S258/S259. Two independent design-intake-reviewer reports (both read origin/stage a3a606e0; no Figma tools) merged and applied by the merger at origin/stage 879138cb (a3a606e0 plus the parity review's FEATURES/INTENT edits only). Nothing in flight (`.run/claims/` empty; `claims.ts review-edits` exit 0). The end-of-run backlog review (#723, unmerged) owns S108, S234, S254, S256, S258, S259 and frame note 00; this intake edits none of them.

query: issues --since 2026-11-28T01:03:28.000Z → #721, #720, #719, #716, #715, #714, #713, #712, #711, #710, #709, #707, #706, #705, #704, #703, #702, #701, #700, #699, #696, #694, #690, #689, #688, #687, #686, #685, #684, #616, #614, #613, #577, #551, #506, #373, #371, #366, #365, #283, #240, #236 (as of 2026-11-28T07:02:49Z, reviewer 1's seed, the earliest of the three; the merger's seed was as of 07:17:37Z)
query: seed intake --since d5c4ada3 → S2, S3, S5, S10, S19, S40, S41, S59, S60, S64, S66, S68, S69, S70, S71, S73, S74, S75, S83, S91, S97, S106, S109, S142, S153, S154, S201, S202, S203, S204, S210, S211, S232, S236, S176, S178, S179, S180, S190, S257, S259, S233, S234, S177, S230, S231, S235, S237, S250, S251, S252, S253, S254, S256, S258, S108, S181, S182, S184, S104, B614, S81, B613, S229, B616, S93, S67, S161, S171, #721, #720, #719, #696, S228, S227, S226, S225, S224, S223, S222, B577, B551, B506, S151, docs/v3/visual/game-rooms/amendments/A8.md
query (reviewer 1): seed intake --since d5c4ada3 → S108, S250, S251, S93, S106, S67, S68, S161, S171, S81, S253, S256, S252, S257, #721, #720, #719, S237, S236, S235, S234, S233, S232, S231, S230, S259, S258, S254, #696, S229, S228, S227, S226, S225, S224, S223, S222, B616, B614, B613, B577, B551, B506, S184, S182, S177, S176, S151, S104 (its seed missed A8, read anyway; the merger's seed names it)

## Inventory

- **game-rooms A8** (text only, no frames): Box room, Hide Scores on, masks each pitcher's R, ER, ERA and the values of the RBI, 2-out RBI, Team RISP and Inherited runners-scored lines with `HiddenValue` "–"; linescore, batting table and Game info as A3/A4 draw them (`box-hidden-mobile.png`, `box-hidden-nonotice-mobile.png`, which draw no pitching table or detail group). No frontend ADR changed in the window (ADR-007, a B577 note under ADR-022 and ADR-028's inventory changed; none frontend).
- **New design pairs (drafts to come, gated on Design lines):** S231 → S232 (pitch-type callout; Live matchup / Plays opened play / Box; with and without callout, Hide Scores, three widths), S235 → S236 (batter in the zone; sides, no data; Live, Plays, top view), S252 → S253 (footer line in shared `site-footer`; clip credit component set with and without link), S258 → S259 (Settings Account Patreon block). Cited features exist (FEATURES 100, 102, 105, 93, 296, 59).

## Ownership

- A8: owned and built by **S207** (done). Checked at HEAD: `BoxRoom.tsx:68` `pitchingColumns(scoresHidden)`, `:124` `InfoLine`, `:205`; `format.ts:90-101` `RUNS_BEARING_LINES` / `isRunsBearingLine` (a presentation predicate, ADR-025 fine). Unowned: 0.
- Ratified but unbuilt: A3's Patreon rows ("Connect Patreon", "Manage on Patreon", "Unlink Patreon"; `SettingsPage.tsx` defers them "with the Patreon link"): now decided by design S258 (AC 2(a), AC 3) and built by S259 (gap map rows updated).
- Re-scoped: 7 (S230, S231, S232, S235, S236, S252, S253). Inserted: 0. Owned unchanged: S258, S259 (#723's), S233, S234, S237.
- Shared layers: `SiteFooter` (S142) the one footer; clip credit one component inside `VideoPlayer` (the one player `PlayerProvider.tsx:359` renders, moved between dialog, stage and corner, S198; `compact` corner drawing has no disclaimer, `VideoPlayer.tsx:140-143`, `CornerPlayer.tsx:73-74`), S253; pitch-type callout one component under `web/src/components/pitch/`, S232; batter inside `StrikeZoneChart`, S236; Patreon block one Settings component, S259. Derivation in `packages/domain`: `mlbVideoPageUrl` (S253 AC 1), callout-due function and constants (S232 AC 1), the `.xxx` formatter shared with `winningPercentage` (`team-record.ts:13-18`, S232 AC 2), stance placement extending `catcherViewBatter` (S236), benefit-from-level (S259).

## Re-scoped stories (text records, `--review`)

- **S231** AC 1: the season as-of question (queued in `.pending`, 2026-11-28) is asked here unless already answered; waits on the owner's answer. AC 2: cites game-rooms A3 and A8; says what Hide Scores does to a season figure that includes the game shown; if Box is chosen, its frames draw the Box room as S207 built it (the pitching table's first ratified drawing, A8 "appears in no drawn frame"), without redesigning it. Note: through which date; a "before the game" answer needs S230's route to take a date first. Evidence: S230 AC 5 serves `servedSeason` totals with no as-of date; A8 masks ERA for moving with this game.
- **S232** AC 1: the 823823 replay asserted only "at most the repeat limit", which passes with zero callouts, since S230 totals stored pitches and the fixtures hold a handful of games, all below the 25 PA floor; now hand-written S230 rows above the floor (said so in the test), at least 1 and at most the limit. AC 2: the `.xxx` writer shared with `winningPercentage` (reuse or extract). AC 3: every callout is one component under `web/src/components/pitch/`, one `(const|function) <Name>\b` definition, imported by each chosen room; tests answer S230's route with those rows. AC 5: `e2e/design/S232.spec.ts` stubs the route with them through `stubApi` (`e2e/design/helpers.ts:83`).
- **S235** prefer after **S201**, priority 121.097 → **121.105** (just after S201's 121.1, before S202's 121.2): both draw the Plays room's zone and S201 AC 4 makes the pitch view one Figma component; the end-of-run review named this the one inversion and left it to the intake. AC 4 draws on the current ratified pitch view (S201's amendment if ratified, else the `live-*`/`plays-*` frames, saying which); AC 5 nests the batter component inside the pitch-view component. Trade-off: the prototypes (most of its 14 turns) don't need S201, but the amendment does, and S236 (121.46) is unaffected.
- **S236** note: AC 5 leaves the stance chunk unbudgeted (`.size-limit.json` budgets only `web/dist/assets/index-*.js`, 200 KB gz); waits on the owner's answer to the queued "Stance size" question, which, if an own budget, adds an AC and `.size-limit.json` to its fence (not in it today).
- **S230** note: waits on the owner's answer to the queued "Season as-of" question; "before the game" rewrites ACs 3 and 5 (a once-a-day season total can't answer an as-of date alone), cheapest before S230 is built.
- **S252** AC 2 names both `site-footer` axes, `Live=On|Off` and `Width=Mobile|Wide` (`A14.md:32`). AC 3: no ratified frame draws the player's tool row (`video-player-dialog-playmeta-mobile.png` shows clip, title, disclaimer; no "tool row/palette/Download/copy link" in game-shell's DESIGN or amendments), so the amendment draws it as S251 leaves it and says it is its first ratified drawing; if AC 1(c) chooses the corner player, the game-shell amendment draws it as S198 built it (design-exempt, owner 2026-11-25), its first ratified drawing. AC 4: the credit set nests in `video-player` `448:4176` (game-shell A4:13). Turn cap 8 → 9 (Goal condition, `/goal`, fields) for the added drawing.
- **S253** AC 4: the credit is one component, one `(const|function) <Name>\b` definition, rendered inside `VideoPlayer`, and on the corner through the same component if S252 draws it there; per-player RTL tests kept.

## Disagreements and resolutions

1. **S231's second change.** R1: cite A8 and draw the Box room as S207 built it. R2: the season as-of and Hide Scores rule for a figure that includes the game. Not in conflict: both applied. The as-of choice is the owner's, already queued; S231 and S230 say they wait on it.
2. **S232's callout component.** R1: an AC that the callout is one component used by every surface, plus the replay and stub fixes. R2: one component under `web/src/components/pitch/`, and AC 3 says "through the room's own component". Checked: the room's component renders the shared component, so no conflict; took R2's location (more specific) with R1's grep check, and R1's replay/stub/formatter fixes, which R2 didn't raise.
3. **S235's AC 5.** R1 changed only prefer_after and AC 4; R2 also nests the batter component in the pitch-view component. Took R2 (more specific; S201 AC 4 makes the pitch view one component, checked). Added the priority move neither proposed, on the end-of-run review's hand-off.
4. **S252's corner player.** R1: the game-shell amendment draws it. R2: say which surface's amendment draws it (shell-scoreboard is in the fence). Resolved to game-shell (R1, more specific): the credit nests in `video-player`, which game-shell owns, so one amendment holds every player place. R2's tool-row finding (no ratified frame draws it) checked true and applied; R2's nesting in `448:4176` applied.
5. **S253's render site.** R1 cited `PlayerProvider.tsx:267`, R2 `:359`. Both right: 267 is the doc comment, 359 the JSX. R1's corner clause kept (the corner's `compact` drawing has no disclaimer, so it needs saying).
6. **Frame note wording** (baseline :13, gap map :47). Took R2's fuller baseline line (names every masked value) and R1's gap-map rows; corrected both reports' S207 phrasing (S207 shows them from the live feed BT already stores; the owner dropped S205 and waived S206).
7. **S108's fence** (R2 only): already fixed by #723's S108 edit; not edited here.

## Frame notes

- 01 Current baseline, scoreboard row: "Box unchanged" → unchanged but for S207's masked values (game-rooms A8).
- 05 Gap map: Hide scores adds S207 (A8); "Savant deep links (Pro Backer gate)" → free for every fan (S250); Patreon link → S256/S257 → S258 → S259 (FEATURES carry row, Auth G3, Sign-in rows; A3's Patreon rows now S258/S259); Site footer row adds S252 → S253; Video Download row adds S251's removal; Box pitching row → S207 done, A8; new rows: the Savant data chain (S233 → S230 → S231 → S232; S234 → S235 → S236; S237) and the legal note (S250, S251, S252 → S253, S254).

## Checks 2, 2b, 3

- **Check 2, next three:** S108 (deps S93, S106, S107, S161, S171, S67, S68, S81 all done; `web/src/components/game/WinProbabilityCard.tsx` exists; its fence fixed in #723). S250 (no deps; `packages/domain/src/entitlements.test.ts`, `functions/src/adapters/postgres/schema.ts`, `.../memory/repos.ts`, `.../postgres/repos.ts` exist). S251 (no deps; `web/src/components/videos/PlayerActions.test.tsx`, `web/src/pwa/pwa.test.ts`, `web/src/pwa/sw.ts` exist). No design needed for either: no ratified frame draws Download.
- **Check 2b, every re-scoped AC:** items 10 (S235's Prefer after line names only S201; `backlog:check` consistent), 11 (S236 AC 5 "unchanged" vs. note: the note defers the change to the answer; S232's no-`toFixed` grep is `web/src/` only, so the domain formatter is free), 12/33 (S232's at-least-1 needs a trigger in 823823: the hand-written rows are named as its recording), 14 (one-definition greps changed from `function <Name>\b` to `(const|function) <Name>\b`, the form S230 AC 7 uses, since an arrow component would escape the first; found and fixed in this pass), 18/30 (S252's turn cap updated in all three places; S251 before S252 by priority), 19 (each splice reads as whole sentences), 24 (S252's tool-row list matches `VideoPlayer.tsx:130` and the Mini player button), 34 (quotes copied from S251/S252's text and A8). S230, S236: 11 and 18.
- **Check 3:** S235 moved after S201 (above). S230 (121.0952) is next after S233 and waits on the as-of answer: for the coordinator, the queued question's "Blocks: none" understates it for S230. Nothing else moves; S252 → S253 → S258 → S259 order holds.
- Duplication sweep: S207 is the only done UI story in the window; `isRunsBearingLine` defined once (`format.ts:99`), none found. Personal-data sweep: no re-scoped story adds a store.

## For the parity review

- `FEATURES.md:63`'s "Ratified as S57 (game-rooms A3/A4, game-shell A2/A3)" lacks game-rooms A8.
- (For the coordinator, outside both write scopes:) VISUAL-DESIGN §5a's Hide scores row lists only "Game list", not the rooms' behaviour (game-rooms A3, A4, A8; game-shell A2, A3).

## Owner questions

None new: both reviewers' questions (season as-of for callouts; a size budget for S236's stance chunk) are already queued in `.pending/needs-input.md`, and S230, S231 and S236 now say they wait on them.
