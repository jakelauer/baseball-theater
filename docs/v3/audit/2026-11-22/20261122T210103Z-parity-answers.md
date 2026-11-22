## 2026-11-22 — doc parity review answers (2026-11-22)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-22 doc parity review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-22T21:01:03Z` |
| HEAD at capture | `e8c2a7b7` (tree dirty) |
| Applied in | the commit that adds this entry |

**Answers and what was applied**

The 2026-11-22 doc parity review (e12a688a) cited as open the question whether the two player pills' spoken names should start with their visible words (WCAG 2.5.3), and listed it under "For the next backlog review" because it would change the game pill's spoken name that review's edit 1 recorded. The owner answered it the same day, through the design intake (docs/v3/audit/2026-11-22/20261122T205755Z-backlog-answers.md, item 3): asked "Should the two player pills' spoken names start with the words on screen? Voice-control users say what they see (WCAG 2.5.3). Today "More from game →" is spoken "More videos from NYY @ BOS, Sep 21", and S145's shipped "Top 6 →" is spoken "Open play - Top of 6th inning".", the owner chose "Start with the visible words (Recommended)", the option reading ""More from game: NYY @ BOS, Sep 21" and "Top 6: open play, top of 6th inning"; changes S145's shipped pill too."

Applied: FEATURES' Video play links row records both new spoken names, quoted; marks the game pill's earlier name ("More videos from <game> (Recommended)", which A10 records) and the inning pill's 2026-11-19 name ("Open play - Top of 6th inning") as superseded; and says S172 renames the inning pill everywhere it shows, S145's included, and S173 builds the game pill after S172 and S153 (S172 AC 5, S173 AC 2 and Depends on, from the intake's edit records 20261122T205636Z-S172-edit.md and 20261122T205637Z-S173-edit.md). The review's "For the next backlog review" item on this question is settled; its other item (confirm `cites` lists S171, S172, S173 once their issues exist) stands.
