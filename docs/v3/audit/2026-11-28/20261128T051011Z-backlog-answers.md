## 2026-11-28 — backlog review answers (2026-11-28)

| | |
|---|---|
| Entry | owner's answers to the 2026-11-28 backlog review — part of finishing that review, not new drift |
| Captured (UTC) | `2026-11-28T05:10:11Z` |
| HEAD at capture | `02fa2c5f` (tree dirty) |
| Applied in | the commit that adds this entry |

**Answers and what was applied**

The owner answered, 2026-11-28 through `/pending`, three of the questions the 2026-11-28 backlog review left open:

- **S229** (#694): asked "S229 credit: approve this sentence for the About page, under 'Where the data comes from'? "Player ids that link to other stats sites come from the Chadwick Bureau Register, used under the Open Data Commons Attribution License." It links the register and the licence.", chose "Approve as drafted (Recommended)". Applied: S229's text gains the `**Approved:**` line quoting the answer and the approved sentence, with its two links (`audit.sh edit S229`).
- **S225** (#687), the L16/L17 ruling the review listed as still open: asked "may the law tests that read the product tree move into their own workspace unit, with inputs narrowed to the files they read, so the backlog tool's own tests stop rerunning on every app change? It amends ADR-030 rule 4 and rewords laws L16, L17 and every law row naming @bt/scripts#test. Every push to stage and main still runs everything fresh.", chose "Yes, their own unit (Recommended)". Applied: S225's text gains the `**Owner ruling:**` line quoting it (`audit.sh edit S225`).
- **B616** (#616), **B613** (#613), **B614** (#614), which the review proposed accepting: asked "Accept bugs B616, B613 and B614 into the backlog, with B616 at priority 121.056 and B613/B614 at 121.095?", chose "Accept as proposed (Recommended)". Applied: each bug's fields block recorded (`audit.sh create B<N> --issue <N>`), B616 at 121.056 (`packages/ports/src/edge-cache.ts`), B613 at 121.095 (`e2e/design/`) and B614 at 121.095 (`e2e/design/`, `web/src/components/game/`, `web/src/test/gameTopBar.ts`), each with `changelog.d/`.

Not part of these answers: the owner's same-day answers to S184's chat questions (who may chat: "Ditch the chat feature entirely"; chat near the AI cap: "No more chat") are an owner-directed change applied in the next commit (S176, S177, S182 and FEATURES), so its drift stays countable from this entry.
