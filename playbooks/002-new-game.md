# 002 - New game

**Cadence:** On demand (when a new game ID / player ID arrives).

Switch the local stack onto a new game without wiping prior DB history.

## Steps
1. Run from the repo root:
   ```bash
   ./scripts/new-game.sh <gameId> <playerId>
   ```
2. Hard-refresh the UI at http://localhost:5173/ if it still shows the previous game.
3. Confirm the script printed `[new-game] ready` and did not exit with an error.

## Done when
Gateway serves `map?game_id=<newId>`, pollers wrote a fresh map row, and the claimer is running (`place-tile` or a WARN if still seeding/rate-limited).
