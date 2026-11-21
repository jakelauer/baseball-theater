## 2026-11-21 — backlog review answers (2026-11-21)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-21 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-21T19:14:20Z` |
| HEAD at capture | `411fb00b` (tree clean) |
| Applied in | `411fb00b` — Backlog: owner answers to review 2026-11-21, pre-PR review fixes |

**Answers and what was applied**

Follow-up to the 2026-11-21 backlog review's question "Off days", asked by the coordinator through the plan review of this branch's fixes (2026-11-21): "Once a favorite team's season is over (eliminated, or no postseason), should later days in that same month stop being marked as its off days?" Options "Only within its season" and "Per month, as written"; the owner answered in Other: "Only during the regular season".

Applied in 411fb00b: S159 AC 1 marks only a day with a regular-season game (red, yellow and tooltip), keeping the month rule from the first answer ("Only teams with games that month (Recommended)") for favorites with no game in the shown month; a note says the All-Star Game's day now gets no mark, a literal reading of the owner's words; S167 created (priority 72.5) to serve each day's regularSeason from each stored game's gameType, and S159 and S125 depend on it; S125 AC 2 passes it.
