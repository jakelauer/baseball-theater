## 2026-11-23 — backlog review answers (2026-11-23)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-23 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-23T08:53:51Z` |
| HEAD at capture | `e7adeb6f` (tree clean) |
| Applied in | `e7adeb6f` — S184: the /goal line names AC 1's two remaining owner answers |

**Answers and what was applied**

Two questions from the 2026-11-23 backlog review, answered by the owner on 2026-11-23.

1. S192. Asked: "On a phone or tablet, after you update while on a game page, should the "Update complete" notice be something you tap that opens the changelog in a window over the game page, without leaving it? That's the reading of your "Open the changelog in a modal on click" answer; S192 (its design) needs it confirmed before drawing." The owner chose "Yes, that reading", the option reading "On game pages (phone/tablet) the notice is tappable and opens the changelog in a modal over the game; elsewhere the pointer stays as built." Applied (bde178c2): S192 gains an **Owner answer:** line quoting it, its waiting question and parking gate go (AC 1, the /goal line), and AC 2 names game pages at mobile and medium as where the amendment applies; S193 notes the reading is confirmed.

2. S184 and ADR-028. Asked: "Should the personal-data list (ADR-028) gain two rows for game chat (S184): Baseball Theater's store of a fan's questions and answers (deleted with the account), and the outside AI provider that receives each question (what it keeps and for how long)? Only you can add rows to that list; S184 and the Privacy page (S154) follow it." The owner chose "Yes, add both rows (Recommended)", the option reading "Both rows go in; the provider row's retention is filled from the chosen provider's terms when S177 picks it." Applied (bde178c2, e7adeb6f): ADR-028's inventory in docs/v3/ARCHITECTURE.md gains "BT database: game chat (S184)" (deleted by deleteFor) and "AI provider: game chat (S184)" (retention from the provider S177 picks), with the owner quoted; S184 drops waiting question 3 and AC 1's gate on it, notes the rows exist, and its /goal line names AC 1's two remaining answers (who may chat, chat near the cap).
