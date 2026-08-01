# Policies recap

Rolling audit of strategies tried against the game API. Each policy has a markdown
write-up (`NNN-name.md`) and an executable module (`NNN-name.ts`).

> **OUTDATED (2026-07-14):** Standalone policy workers (`001-init`, `002-autoplay`)
> are **retired**. Claiming is owned by `npm run jobs` (tileClaimer + owned-flag nuker)
> plus the UI claim queue. Do not run `npm run policy` / `npm run play` for live
> play — they compete for the shared `place-tile` rate limit. `ab-test.json`
> policies list is empty so `npm start` will not spawn them.

## Active policies

| ID | Name | Status | Runner | Notes |
|---|---|---|---|---|
| 003 | cartographer | **ready** | `npm run agent cartographer` | Map belief + scout + band lasso + flag hunter; **not** in ab-test.json by default |

Legacy claiming is still owned by `npm run jobs` (tileClaimer + owned-flag nuker) plus the UI
claim queue. **Do not** run cartographer alongside `npm run jobs` — shared ~20 place-tile RPS.

## How to run cartographer (003)

```bash
cd game
npm run gateway          # terminal 1
npm run pollers          # terminal 2
npm run agent cartographer

# 10s sanity check
AGENT_DURATION_MS=10000 npm run agent cartographer

# Dry-run one planning tick
npm run policy test 003-cartographer
```

To enable in ab-test (not recommended with jobs): add
`{ "key": "003-cartographer", "zone": { "x": 0, "y": 0, "w": 100, "h": 100 } }` to
`game/config/ab-test.json`.

## How to run (historical — outdated)

```bash
cd game
pnpm policy test 001-init    # single dry-run tick (safe)
pnpm policy run 001-init     # continuous loop — DO NOT use for live claiming
pnpm policy restart 001-init # stop + spawn new run
pnpm start                   # gateway + pollers (+ policies only if listed in ab-test.json)
```

## A/B testing

Edit [`game/config/ab-test.json`](../game/config/ab-test.json) to assign policies to
non-overlapping map zones. Currently `"policies": []` (none active). Project root
is `projects/AgentWars/`.

## Retired / outdated policies

| ID | Name | Status | Result | Notes |
|---|---|---|---|---|
| 001 | init | **outdated** | retired | API discovery baseline — superseded by pollers + jobs |
| 002 | autoplay | **outdated** | retired | Spiral claim loop burned rate limit + many `INVALID_TARGET`; replaced by UI queue + tileClaimer |
| 003 | cartographer | **ready** | — | Standalone agent via `npm run agent cartographer`; do not run with jobs |

## Learnings

- All traffic must go through the local gateway (`http://127.0.0.1:3100`) so every
  call is persisted in `api_calls`.
- State pollers write to `game_states`; jobs should prefer cached snapshots to
  reduce duplicate reads.
- Multiple place-tile clients (policy + jobs + UI) share one ~20 rps budget —
  competing workers mostly produce 429s instead of tiles.
- Use `DRY_RUN=true` or `pnpm policy test` before issuing mutating moves if
  reviving a policy for experiments.
