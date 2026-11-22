## 2026-11-22 — backlog review answers (2026-11-22)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-22 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-22T20:57:55Z` |
| HEAD at capture | `bce05622` (tree clean) |
| Applied in | `bce05622` — Apply the owner's answers to the 2026-11-22 design intake, and pre-PR fixes |

**Answers and what was applied**

Owner's answers, 2026-11-22, to the design intake's three questions (game-shell A7, shell-scoreboard A16, standings-search-settings A10), asked by the coordinator in session with images shown for the two visual ones:
1. Asked whether a scoreboard row's inning reads "Bot 7" (every ratified frame) or "Bot 7th" (built today), the owner chose ""Bot 7", as drawn (Recommended)" (the option read: "Half plus number, no ordinal: "Bot 7", "Mid 3", "End 9"."). Applied: S170 AC 2.
2. Asked whether a suspended, delayed or delayed-start game folded into the slim bar should say so, the owner chose "Leave the bar as it is (Recommended)" (the option read: "The full row and the game page show the marker; the folded bar stays a compact summary."). Applied: S170's collapsed-bar note.
3. Asked whether the two player pills' spoken names should start with the words on screen (WCAG 2.5.3), the owner chose "Start with the visible words (Recommended)" (the option read: ""More from game: NYY @ BOS, Sep 21" and "Top 6: open play, top of 6th inning"; changes S145's shipped pill too."). Applied: S172 AC 5 renames the inning pill in `playInningLink` (cap 5 -> 6); S173 AC 2 names the game pill and depends on S172; S153 AC 2 and AC 5 follow the rename and depend on S172. The answer supersedes the names recorded in sealed A10 and game-shell A6, which are not edited.
The same commit carries the pre-PR review's fixes to this intake's text (S170 AC 2's jsdom-safe text-transform check and one half-name resolver; S171's regeneration command, optional `pitchHand`, earlier tests; S173's `playInningLink` attribution to S145). Those are part of this review, not new drift.
