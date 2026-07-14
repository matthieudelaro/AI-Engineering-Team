# Policy 002 — autoplay

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

- **Status:** active autoplayer
- **Next:** compare tile growth vs manual UI claims
