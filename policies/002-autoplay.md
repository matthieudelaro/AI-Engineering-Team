# Policy 002 — autoplay

> **OUTDATED (2026-07-14):** Retired. Competed with `tileClaimer` for the shared
> `place-tile` rate limit and produced many `REJECTION_REASON_INVALID_TARGET`
> responses. Live claiming is UI queue + jobs — do not run this policy.

## Hypothesis

Once the game session is live, claim tiles in an expanding spiral from the map
center. Skip cells already owned by us (`is_self` display name from leaderboard).

## Behaviour

1. Poll `GET /api/v1/leaderboard` until HTTP 200 (game is active).
2. Identify self via `is_self` on leaderboard row.
3. `GET /api/v1/map`, build set of owned coordinates.
4. `POST /api/v1/place-tile` on the next unowned spiral cell.
5. One claim per tick; respect `retry_after` on rejection.

## Results

| Run | Outcome | Notes |
|---|---|---|
| — | running | Game `7zav` — spiral claim loop via gateway |

## Decision

- **Status:** outdated / retired (2026-07-14)
- **Next:** use UI claim queue + `npm run jobs` instead
