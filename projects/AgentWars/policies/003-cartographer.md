# 003 — Cartographer

## Hypothesis

A map-aware agent that maintains internal belief about every observed cell, scouts
stale/unknown regions (~1 RPS), expands via band-of-5 lasso contours (~19 RPS), and
exploits enemy nuke cooldowns to steal high-value flags.

## Strategy

1. **Gateway only** — all traffic via `GameClient` → `http://127.0.0.1:3100`.
2. **Map belief** — confidence = 1 on fresh observation; exponential decay
   (half-life 60s). Scout prefers low-confidence / never-seen cells; skips owned.
3. **Scout (~1/s)** — one place-tile probe per ~19 claim ticks into oldest fog.
4. **Lasso bands** — 5×5 hollow rings tiled into width-5 contours; hole-fill while
   closing; map edges and nuked tiles count as walls.
5. **Flag hunter** — poll `GET /api/v1/flags`; when an enemy nukes their flag,
   assume ~30s cooldown and feint/steal a nearby valuable flag, then `launch-nuke`
   on capture. **Nuke heuristic (no availability API):** owners of active non-nuked
   flags are assumed able to nuke; once we observe an enemy nuke, exclude them for
   30s (feint skipped → all-in steal).
6. **Fallback** — random in-bounds non-owned claims when no smart plan.

## How to run

**Do not** enable in `ab-test.json` while `npm run jobs` tileClaimer is active — they
share the ~20 place-tile RPS budget.

```bash
cd projects/AgentWars/game
npm install
npm run db:up && npm run db:migrate

# Terminal 1 — gateway (required for audit log)
npm run gateway

# Terminal 2 — pollers (map + flags cache)
npm run pollers

# Terminal 3 — cartographer agent (standalone, ~20 RPS)
npm run agent cartographer

# 10s sanity harness
AGENT_DURATION_MS=10000 npm run agent cartographer

# Dry-run planning (one tick, no mutating POSTs)
npm run policy test 003-cartographer
```

Optional mock upstream when `172.16.1.190` is unreachable:

```bash
tsx scripts/mock-game-api.ts   # terminal A — port 8000
# Point GAME_API_URL at mock in .env, then gateway + agent as above
```

## Status

| Field | Value |
|---|---|
| Key | `003-cartographer` |
| Live runner | `npm run agent cartographer` |
| ab-test.json | **not enabled by default** |
| Competes with | `npm run jobs` tileClaimer, `nukeOwnedFlags` (do not run both) |

## Results

_TBD — record outcomes after live runs._
