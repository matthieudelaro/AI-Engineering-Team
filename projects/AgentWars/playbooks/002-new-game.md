# 002 - New game

**Cadence:** On demand (when a new game ID / player ID arrives).
**Project:** AgentWars (`projects/AgentWars/`).

Switch the local stack onto a new game without wiping prior DB history.

## Steps
1. Run from `projects/AgentWars/`:
   ```bash
   ./scripts/new-game.sh <gameId> <playerId>
   ```
2. Hard-refresh the UI at http://localhost:5173/ if it still shows the previous game.
3. Confirm the script printed `[new-game] ready` and did not exit with an error.

## Done when
Gateway serves `map?game_id=<newId>`, pollers wrote a fresh map row, and jobs are running: tile claimer (`place-tile` or a WARN if still seeding/rate-limited) plus the owned-flag nuke loop (`nuke_loop_start` / `nuke_ok` in `policy_events`, capped at 100 pts / 3 min).
