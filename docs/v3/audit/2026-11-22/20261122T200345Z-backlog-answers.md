## 2026-11-22 — backlog review answers (2026-11-22)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-22 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-22T20:03:45Z` |
| HEAD at capture | `88993a85` (tree clean) |
| Applied in | `88993a85` — Backlog review 2026-11-22 (second): pre-PR fixes and the owner's #347 answer |

**Answers and what was applied**

Owner, 2026-11-22, in session, asked "Should enhancement #347 (move MLB's highlight-search types and parser into packages/mlb-api) be folded into S153, which already touches Search's player and holds that package in its scope? The backlog review did this without your word; it grows S153's turn cap from 10 to 11.": chose "Fold it into S153 (Recommended)".

Applied: S153's 2026-11-22 note quotes the answer, says #347's scan-drift entry (and #348's recorder form) stay out as review tooling, that AC 1 otherwise covers #347, and that S153's pull request carries Closes #347. Also in the same commit, a pre-PR fix (not an owner answer): S138 AC 3 imports BACKFILL_EARLIEST_DATE from @bt/domain, or S125's own named function if it shipped one.
