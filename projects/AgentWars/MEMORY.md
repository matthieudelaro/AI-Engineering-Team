# MEMORY — AgentWars

Project-local memory for the AgentWars game stack. Load only when working on
this project (`projects/AgentWars/`). Do not put these notes in the team root
`MEMORY.md`.

## In flight
- Local game server at `projects/AgentWars/server/` — OpenAPI-compatible engine + spectator + harness. Point `GAME_API_URL=http://127.0.0.1:8000`.

## Learned (server)
- Sustained ~19.5 place-tile/s per player × 8 on a large seeded map (p95 ~3ms). Starter 11×11 OOB-rejects look like rate problems — expand/seed first when load-testing.
- Lasso = 4-connected mono-victim capture; nuked tiles seal and are never flipped inside.
- **V2 flags:** spawn only on map expand into the new ring (0 flags at size 11). Target count `round(size² / 480)`; spawn `max(0, target − current)` on empty non-nuked ring cells. Flag id `"x,y"`. Pot +1 every 5s while live (lazy via `frozenPot` / `createdAtMs`; inject `now` in tests). Ownership follows tile owner on claim/lasso. Nuke freezes pot and sets `lockedOwnerId` permanently.
- **V2 nukes:** any in-bounds target; player must own ≥1 tile. Radius `clamp(floor(5 − distance×0.15), 1, 4)` where distance is Chebyshev to nearest owned tile (0 when target is on owned land). Cost = newly nuked cells × 1; clears ownership on new hits. 30s per-player cooldown (`COOLDOWN` → 409 + `retry_after`). HTTP `launch_nuke` max 1/s. Leaderboard: `score = territory + flags + nuke_cost` (`nuke_cost` negative spend).

## Learned
- Place-tile ~12 RPS plateau (API cap 20) was client limiter duty cycle, not RTT: `noteRemaining(≤3)` collapsed the wall-second cap mid-second; soft-resume was 8/400. Fix: only pause on `remaining≤0` when near cap (ignore stale 0s); pace `placeRps-1` with soft-resume 16/200. Do not locally expand fog bounds beyond the snapshot (causes 100% `OUT_OF_BOUNDS`); on OOB tighten local bounds via `excludeOutOfBoundsCell`.
- Map ownership `"nuked"` is permanently unclaimable (not `flags[].nuked`). Skip in auto-claim / UI enqueue / queue consumers. Never scan all occupied tiles for nuked — keep a small `nuked` Set from `buildOwnershipMap`; pass precomputed `{occupied,nuked}` into `pickClaimTarget` (rebuilding ownership every pick on a 27k-tile map killed RPS). Workers at 28.
- Game UI map “jumps” on API sync were from bounds `min_x`/`min_y` shifting world pixels without camera compensation, plus `fitToView` on every expansion. Fix: compensate translate; refit only on initial load.
- New games with empty `tiles: []` broke map-stream bootstrap/persist (`tiles.length === 0` treated as failure), so claim jobs kept reading multi‑MB prior-game map rows from `game_states` and froze. Fix: allow empty usable maps; read cache one row at a time. Keep old `game_states` rows for learning — do not delete across games.
- Fast switch onto a new game: `./scripts/new-game.sh <gameId> <playerId>` (playbook `playbooks/002-new-game.md`). Re-apply CLI args after sourcing `.env` so `GAME_ID` is not clobbered; start stack with `setsid` so agent shell exit does not kill processes.
- Map player colors must stay sticky by `display_name` (not `tile_count`/rank). Ignore tile `ownership.color`; resolve via `buildPlayerColors` / `mapColorForPlayer`.
- Fog hides map `has_flag`; show flags from gateway-cached GetFlags (`fetchFlags` → `game_states` `flags`) merged into paint coords via `flagOverlay`.
- Owned-flag nuke job (`game/src/jobs/nukeOwnedFlags.ts`) starts with `npm run jobs` / `npm start`: nukes flags on our tiles using cached map+flags; spend cap **100 pts / rolling 3 min** (`NUKE_RATE_LIMIT` / `NUKE_RATE_WINDOW_MS`). GetFlags has `nuked` but not owner — join with map `ownership.owned`.
- Gateway UI claim queue (`game/src/gateway/uiClaimQueue.ts`): `GET /_gateway/ui-claim-queue` returns `getUiClaimQueueStats()` (pending/inFlight/total/pendingRetries + fifo `head` preview, max 10). `DELETE /_gateway/ui-claim-queue` calls `clearUiClaimQueue()` (204). Tests use `resetUiClaimQueue()` — same implementation as clear.
