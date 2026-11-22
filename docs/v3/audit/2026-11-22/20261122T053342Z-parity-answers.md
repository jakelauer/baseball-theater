## 2026-11-21 — doc parity review answers (2026-11-21)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-21 doc parity review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-22T05:33:42Z` |
| HEAD at capture | `fbdf3985` (tree dirty) |
| Applied in | the commit that adds this entry |

**Answers and what was applied**

The review's one question, asked through /pending on 2026-11-22: "Should the calendar mark the All-Star Game's day as an off day for favorite teams not playing in it?" The owner chose *"No mark on the All-Star day (Recommended)"*; the option read: *"keep your "Only during the regular season" answer literal; the All-Star day looks like spring training and postseason-only days. A8 gets a small amendment for you to ratify, since its frame draws that day with a red ✕."*

Applied:
- **S159** (#291): AC 1's July case now says the All-Star Game's day is `null`, never `red`, quoting the question and the option; the note "The All-Star Game's day now carries no mark" records the confirmation and names the draft amendment.
- **S125** (#257): a note says A8's red ✕ on the All-Star day is superseded by the pending draft amendment `docs/v3/visual/shell-scoreboard/amendments/A15.md`; no design story owns it, so the **Design:** line is unchanged and the note says S125's design match (AC 6) waits on A15's ratification. The 2026-11-22 review note's open-question sentence now records the answer.
- **A15** (`docs/v3/visual/shell-scoreboard/amendments/A15.md`): drafted, marked "**Draft, not ratified.**" with no `Ratified by:` line (so `scripts/review-debt.sh`'s `is_draft` skips it and no intake is due). It overrides A8's off-day rule for the All-Star Game's day and adds one frame, `scoreboard-calendar-allstar-mobile`, to be drawn in Figma before ratification; Figma was not edited. A8's sealed frames draw September 2026, so none of them changes (A15's Interpretation notes that the option's "its frame draws that day" is A8's written rule as it reaches that day).
