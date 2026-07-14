# Policy 001 — init (API discovery)

> **OUTDATED (2026-07-14):** Retired. Discovery/polling is handled by gateway
> pollers; live claiming is `jobs` + UI queue. Do not run this policy for play.

## Hypothesis

Before playing to win, we need a complete audit trail of how the external game API
behaves. This baseline policy issues read-only discovery calls through the local
gateway, relies on background pollers for state snapshots, and records every
interaction in PostgreSQL.

## What we try

1. `GET /state` via the gateway (tagged with `policy_id=001-init`)
2. Read the latest cached snapshot from `game_states` when pollers have data
3. Validate zone guards (`inZone`) for future A/B map partitioning
4. Skip mutating actions when `DRY_RUN=true` (used by `pnpm policy test 001-init`)

## API discovery checklist (fill when credentials arrive)

| Item | Status | Notes |
|---|---|---|
| Auth scheme | pending | Set `GAME_API_TOKEN` + `GAME_API_AUTH_HEADER` in `.env` |
| State endpoint path | pending | Update `game/config/api.endpoints.json` |
| Board dimensions | pending | Update `game/config/ab-test.json` `board` |
| Action endpoints | pending | Document move/pass/etc. after first responses |
| Win condition signals | pending | |
| Rate limits (429 headers) | pending | Tune `POLL_MAX_RPS` and `POLL_INTERVAL_MS` |

## Discovery procedure

```bash
cd game
cp ../.env.example ../.env   # fill GAME_API_URL and GAME_API_TOKEN
pnpm install
pnpm db:up && pnpm db:migrate
pnpm gateway                  # terminal 1
pnpm pollers                  # terminal 2
pnpm policy test 001-init     # single dry-run tick
```

Then inspect:

```sql
SELECT * FROM api_calls ORDER BY ts DESC LIMIT 20;
SELECT * FROM game_states ORDER BY fetched_at DESC LIMIT 10;
SELECT * FROM policy_events ORDER BY ts DESC LIMIT 20;
```

## Results

| Run | Outcome | Notes |
|---|---|---|
| — | pending | Waiting for game API credentials |

## Decision

- **Status:** ready for discovery
- **Next:** document real API shape here, then author `002-*` with first move logic
