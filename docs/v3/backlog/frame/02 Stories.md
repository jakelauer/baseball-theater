## Stories

> **Route paths and ADR-015.** Stories authored before [ADR-015](./ARCHITECTURE.md#adr-015--api-versioning--compatibility-accepted) name unversioned routes (`/api/schedule`, `/api/games/:gamePk`, …). Once **S26** lands the `/api/v1` prefix, every such literal means its **`/api/v1/…`** equivalent — in the story text, in each `scripts/verify-<ID>.sh`, and in any new route a later story adds. A story that introduces a route on an unversioned path after S26 is wrong, not a permitted exception.
