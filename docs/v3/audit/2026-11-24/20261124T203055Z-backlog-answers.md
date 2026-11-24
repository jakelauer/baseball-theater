## 2026-11-24 — backlog review answers (2026-11-24)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-24 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-24T20:30:55Z` |
| HEAD at capture | `97bcfa51` (tree clean) |
| Applied in | `97bcfa51` — Backlog review 2026-11-24 (third): owner's answers, B408 accepted, S213 grep |

**Answers and what was applied**

Answers to the 2026-11-24 (third) backlog review's questions (owner, 2026-11-24, verbatim):
1. Late clips ("Should BT fetch each finished game once more, about a day later, to pick up late clips?"): "Cron re-checks recent games (Recommended)" — "The cron also re-ingests each game's full detail for recently finished days (e.g. the last 7 days, when corrections actually happen), and purges the edge copy only when something changed". Applied by S212's new AC on its own branch; nothing edited here.
2. shell-scoreboard A15 (draw and ratify, or withdraw): "It doesn't need a design, it's very straightforward." Applied as the owner's decision, not a ratification: no open item waits on A15 (only S125 and S159, both done, name it); recorded in frame note 00's scheduling notes. A15's draft file and FEATURES' wording are outside this review's write scope, left for their owners.
3. #403: "Close it as done (Recommended)" — the coordinator closes it; recorded only.
Also in 97bcfa51, beyond the answers but within the review: B408 accepted at 72.1 (issue by the owner), as the review's finding F7 asked; S213 AC 2's grep excludes isFavoriteGame's own body (pre-PR review nit).
