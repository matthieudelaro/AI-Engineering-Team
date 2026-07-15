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
- Game `jbs9` / player `remotematthieu999` — stack IDs updated; connect via gateway.

## Learned
- Game UI map “jumps” on API sync were from bounds `min_x`/`min_y` shifting world pixels without camera compensation, plus `fitToView` on every expansion. Fix: compensate translate; refit only on initial load.
- New games with empty `tiles: []` broke map-stream bootstrap/persist (`tiles.length === 0` treated as failure), so claim jobs kept reading multi‑MB prior-game map rows from `game_states` and froze. Fix: allow empty usable maps; read cache one row at a time. Keep old `game_states` rows for learning — do not delete across games.
- Fast switch onto a new game: `./scripts/new-game.sh <gameId> <playerId>` (playbook `002-new-game`). Re-apply CLI args after sourcing `.env` so `GAME_ID` is not clobbered; start stack with `setsid` so agent shell exit does not kill processes.
