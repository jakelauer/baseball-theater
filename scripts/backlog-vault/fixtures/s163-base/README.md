# S163 base fixtures

Byte-for-byte copies of three files at commit `9bebb01f` (S163's base, `git merge-base origin/stage` when the story started):

| Fixture              | Copy of                            |
| -------------------- | ---------------------------------- |
| `review-debt.sh.txt` | `scripts/review-debt.sh`           |
| `parity-debt.sh.txt` | `scripts/parity-debt.sh`           |
| `source.ts.txt`      | `scripts/backlog-vault/source.ts`  |

`review-debt.test.ts` checks that both debt scripts still print exactly the text these did, and `search.test.ts` checks that the rebuilt `featureNames` / `pillarNames` read the real FEATURES.md and INTENT.md as this `source.ts` did. The tests read these files rather than `git show 9bebb01f:…`, because CI checks out one commit with no history. The `.txt` extension keeps them out of ESLint, `tsc`, shellcheck and coverage; each test copies a fixture under its real name in a temporary directory before running it. Never edit them: they are the baseline.
