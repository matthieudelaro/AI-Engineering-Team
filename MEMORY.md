# MEMORY.md

The team's shared memory: what the whole engineering team has learned. Read on
every session. Role-specific learnings live in `roles/<role>/MEMORY.md`; this file
is for what everyone shares. Who you are lives in `context/PROFILE.md`. Keep it
current: replace outdated lines in place, do not just append.

## The team
- The Architect (front door) breaks work down and delegates to the Backend and
  Frontend engineers; QA gates non-trivial builds; the Security engineer runs
  after QA on security-relevant work. Roles live in `roles/`.

## In flight
- Game `w8pp` / player `remotematthieu999` — stack connected; empty board, waiting for place-tile accepts.

## Learned
- Place-tile ~12 RPS plateau (API cap 20) was client limiter duty cycle, not RTT: `noteRemaining(≤3)` collapsed the wall-second cap mid-second; soft-resume was 8/400. Fix: only pause on `remaining≤0` when near cap (ignore stale 0s); pace `placeRps-1` with soft-resume 16/200. Do not locally expand fog bounds beyond the snapshot (causes 100% `OUT_OF_BOUNDS`); on OOB tighten local bounds via `excludeOutOfBoundsCell`.
- Map ownership `"nuked"` is permanently unclaimable (not `flags[].nuked`). Skip in auto-claim / UI enqueue / queue consumers. Never scan all occupied tiles for nuked — keep a small `nuked` Set from `buildOwnershipMap`; pass precomputed `{occupied,nuked}` into `pickClaimTarget` (rebuilding ownership every pick on a 27k-tile map killed RPS). Workers at 28.
- Game UI map “jumps” on API sync were from bounds `min_x`/`min_y` shifting world pixels without camera compensation, plus `fitToView` on every expansion. Fix: compensate translate; refit only on initial load.
- New games with empty `tiles: []` broke map-stream bootstrap/persist (`tiles.length === 0` treated as failure), so claim jobs kept reading multi‑MB prior-game map rows from `game_states` and froze. Fix: allow empty usable maps; read cache one row at a time. Keep old `game_states` rows for learning — do not delete across games.
- Fast switch onto a new game: `./scripts/new-game.sh <gameId> <playerId>` (playbook `002-new-game`). Re-apply CLI args after sourcing `.env` so `GAME_ID` is not clobbered; start stack with `setsid` so agent shell exit does not kill processes.
- Map player colors must stay sticky by `display_name` (not `tile_count`/rank). Ignore tile `ownership.color`; resolve via `buildPlayerColors` / `mapColorForPlayer`.
- Fog hides map `has_flag`; show flags from gateway-cached GetFlags (`fetchFlags` → `game_states` `flags`) merged into paint coords via `flagOverlay`.
- Owned-flag nuke job (`game/src/jobs/nukeOwnedFlags.ts`) starts with `npm run jobs` / `npm start`: nukes flags on our tiles using cached map+flags; spend cap **100 pts / rolling 3 min** (`NUKE_RATE_LIMIT` / `NUKE_RATE_WINDOW_MS`). GetFlags has `nuked` but not owner — join with map `ownership.owned`.
