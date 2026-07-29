# Game API infrastructure — agent cooperation guide

This document is the single source of truth for any agent working on the game.
Read it before touching the stack, writing policies, or querying the database.

## Mission

Win a timed external game (2-hour window) by:

1. Routing **all** API traffic through a local gateway that audits every call.
2. Persisting calls, state snapshots, and policy events in PostgreSQL.
3. Running one or more policies in parallel (A/B on map zones).
4. Recording what each policy tried, what worked, and what failed.

**Goal:** winning. **Constraint:** full auditability.

---

## Game connection

| Field | Value |
|---|---|
| **Player ID** | `remotematthieu999` |
| **Game ID** | `jbs9` |
| **API URL (OpenAPI spec)** | `http://172.16.1.190:8000/openapi.json` |
| **Upstream base** (`GAME_API_URL`) | `http://172.16.1.190:8000` |

Fetch the OpenAPI spec to discover endpoints, auth, and state paths before playing.
The gateway proxies to the **upstream base**; game paths are appended (e.g. `/state` →
`http://172.16.1.190:8000/state`).

---

## Golden rules (non-negotiable)

| Rule | Detail |
|---|---|
| **Gateway only** | Never call `GAME_API_URL` directly. Always use `http://127.0.0.1:3100` (or `GATEWAY_HOST`:`GATEWAY_PORT`). |
| **Log everything** | Every proxied request is stored in `api_calls`. If it is not in the DB, it did not happen. |
| **Document policies** | Each attempt needs `policies/NNN-name.md` (narrative) **and** `policies/NNN-name.ts` (code). Update `policies/README.md`. |
| **Dry-run first** | Use `npm run policy test <key>` or `DRY_RUN=true` before mutating moves. |
| **Prefer cached state** | Read `game_states` (via `ctx.getLatestState()`) before issuing duplicate GETs. |
| **No secrets in git** | Credentials live in `.env` only (gitignored). Gateway redacts auth headers in logs. |
| **Shared Postgres** | DB is on `localhost:5432` — other agents on this machine can connect with the same `DATABASE_URL`. |

---

## Repository layout

```
projects/AgentWars/             # this project (not team startup context)
├── MEMORY.md                   # project learnings
├── .env.example                # copy to .env here
├── playbooks/002-new-game.md
├── scripts/new-game.sh
├── policies/                   # policy docs + executable modules
│   ├── README.md               # rolling recap table — keep updated
│   ├── 001-init.md
│   └── 001-init.ts
└── game/                       # runnable infrastructure (this package)
    ├── docker-compose.yml      # postgres:1.15 container
    ├── config/
    │   ├── game.json           # gameId + playerId (UI reads this)
    │   ├── api.endpoints.json  # upstream URL, auth, state endpoints to poll
    │   └── ab-test.json        # active policies + map zones
    ├── src/
    │   ├── cli.ts              # start / gateway / pollers / policy / status
    │   ├── config.ts           # env + config loading (Zod)
    │   ├── client/gameClient.ts
    │   ├── gateway/server.ts   # reverse proxy + audit logging
    │   ├── pollers/runner.ts   # background state fetchers
    │   ├── policies/           # framework: types, loader, supervisor, zone
    │   └── db/                 # schema, migrations, migrate script
    ├── ui/                     # interactive map (Vite + TypeScript)
    │   └── src/main.ts         # click / drag-to-claim UI
    └── README.md               # this file
```

---

## Prerequisites

- **Node.js** 20+
- **npm** or **pnpm** (`npm install` works; scripts use `npm run <script>`)
- **Docker** with a local `postgres:1.15` image

### PostgreSQL image note

`postgres:1.15` is **not** on Docker Hub. On this host the image is provided by
tagging the local `postgres:15.5`:

```bash
docker tag postgres:15.5 postgres:1.15
```

`docker-compose.yml` sets `pull_policy: never` so compose never tries to pull from
the network. If the container fails to start, check the tag exists:

```bash
docker images | grep postgres
```

---

## Environment variables

Copy and edit from `projects/AgentWars/`:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|---|---|---|
| `GAME_API_URL` | `http://172.16.1.190:8000` | Upstream base URL (gateway proxy target) |
| `OPENAPI_URL` | `http://172.16.1.190:8000/openapi.json` | OpenAPI spec for endpoint discovery |
| `PLAYER_ID` | `remotematthieu999` | Our player identifier (`X-Player-Id` in event mode) |
| `GAME_ID` | `jbs9` | Active game session — pass as `game_id` on all API calls |
| `AUTH_MODE` | `event` | `event` = `X-Player-Id` header; `token` = Bearer auth |
| `GAME_API_TOKEN` | — | Bearer token injected by gateway |
| `GAME_API_AUTH_HEADER` | `Authorization` | Header name for auth |
| `GATEWAY_PORT` | `3100` | Local proxy listen port |
| `GATEWAY_HOST` | `127.0.0.1` | Local proxy bind address |
| `DATABASE_URL` | `postgresql://game:game@localhost:5432/game` | Postgres connection |
| `POLL_INTERVAL_MS` | `2000` | Default poller interval per endpoint |
| `POLL_MAX_RPS` | `2` | Global rate limit for pollers |
| `GATEWAY_MAX_BODY_BYTES` | `65536` | Max stored request/response body size |
| `POLICY_TICK_INTERVAL_MS` | `1000` | Delay between policy ticks (continuous mode) |
| `DRY_RUN` | `false` | Skip mutating actions when `true` |

`.env` is loaded from **`projects/AgentWars/`** (not `game/`), by `game/src/config.ts`.

---

## Quickstart

```bash
# 1. Credentials (projects/AgentWars/)
cp .env.example .env
# edit GAME_API_URL, GAME_API_TOKEN

# 2. Dependencies
cd game
npm install

# 3. Database
docker tag postgres:15.5 postgres:1.15   # if not already tagged
npm run db:up
npm run db:migrate

# 4. Full stack (gateway + pollers + jobs [tile claimer + owned-flag nuker] + policies in ab-test.json)
npm start
```

### Run the game UI

Interactive 2D map — click or click-drag to claim tiles (skips tiles you already own):

```bash
npm run gateway    # terminal 1 — proxy with X-Player-Id auth
npm run ui         # terminal 2 — http://localhost:5173
```

**Light mode** (`VITE_UI_LIGHT=1` or `?light=1`) disables the live map SSE stream and heavy diagnostic panels (rate stats, claim queue, API console); the map still refreshes on the 5s poll interval.

Brush modifiers (hold while painting):

| Key | Effect |
|---|---|
| Shift / A / S / D | Filled Manhattan diamond brushes (larger as listed) |
| **F** | **Edge lasso**: enqueue the hollow 5×5 square ring (16 edge tiles) around the cell; interior is not queued (game fill). Works on click/drag and on hover while F is held. |

The UI proxies API calls through the gateway (`/api` → `localhost:3100`) so claims are audited in `api_calls`.

Manual UI claims take priority via a shared gateway queue: the UI enqueues desired tiles on `POST /_gateway/ui-claim-queue` (deduped while pending or in-flight). Whenever that queue is non-empty (pending or in-flight), `tileClaimer` drains it **only** (FIFO among currently claimable tiles). While auto-claim is running, it yields as soon as UI activity or queue work is seen (probed each acquire, cached ~50ms) so the next tick drains the UI queue. The drain leases a local batch and does not refill until that batch is exhausted (avoids stacking stuck in-flight leases). Place-tile starts are paced slightly under the API cap (~18/s) with a continuous pipeline (up to ~24 in flight). Claims must be orthogonally adjacent to owned land — the drain prefers adjacent queued tiles, bridges toward the rest when needed, and updates the local map on accept so we do not burn the budget on `INVALID_TARGET`. On `REJECTION_REASON_RATE_LIMITED` / HTTP 429, the job **stops starting new claims**, waits until `X-RateLimit-Reset` (falling back to `retry_after`), puts the rate-limited tile back at the **front**, and retries it before continuing. Soft rejects (except `INVALID_TARGET`) get one retry within a second. When the queue is empty, the claimer falls back to the automatic mix (5% random · 40% grow · 55% bridge) with the same pacing. Enqueue also calls `touchUiClaimActivity()` so the flag spawner backs off while the user paints (`UI_CLAIM_PRIORITY_MS`, default `1000`).

Auto-claim expands by **hollow lassos around our owned territory** rather than one random adjacent tile at a time. An `ExpansionLassoPlanner` (`src/jobs/expansionLasso.ts`) plans a large hollow square ring (half-extent ~8–20) just outside the frontier, claims its perimeter cells — preferring ones already orthogonally adjacent to owned land, bridging one step toward the ring otherwise — and lets the game fill the enclosed interior, so expansion is much faster. When a plan is exhausted or stuck it replans; if planning fails it falls back to the grow/random/bridge mix. Adjacency rules are unchanged, and the manual UI claim queue still takes priority (auto-claim is never routed through it). Note: interior fill depends on the server's enclosure rules — an incomplete or overlapping ring may not fill.

### Run components separately

Use separate terminals when debugging:

```bash
npm run gateway    # API proxy → http://127.0.0.1:3100
npm run pollers    # background state fetchers
npm run jobs       # tile claimer + owned-flag nuke loop
npm run nuke-flags # owned-flag nuke loop only (already included in jobs/start)
npm run status     # DB summary (call counts, recent states, policy runs)
```

### Owned-flag nuke job

Started automatically by `npm run jobs` and `npm start` (`src/jobs/nukeOwnedFlags.ts`).

- **Targets:** active (`nuked: false`) flags whose tile is owned by us — join GetFlags cache with map ownership from `game_states` (no extra map/flags API GETs for selection).
- **Action:** `POST /api/v1/launch-nuke` via the gateway only.
- **Spend cap:** `NUKE_RATE_LIMIT` points (default **100**) per rolling `NUKE_RATE_WINDOW_MS` (default **3 minutes**). Waits when the window is full; survives gateway errors / game-ended / cooldowns.
- **Standalone:** `npm run nuke-flags` if you need the loop without the tile claimer (do not run both standalone and `jobs` at once).

### Policy commands

```bash
npm run policy test 001-init      # single dry-run tick (safe)
npm run policy run 001-init       # continuous loop in foreground
npm run policy restart 001-init   # stop + spawn new child process
```

### Tests

```bash
npm test
```

### Stop

- `Ctrl+C` — stops gateway / pollers / `npm start` gracefully
- `npm run db:down` — stops Postgres container (data persists in volume `game_game_pg_data`)

---

## Architecture

```
┌─────────────┐   ┌─────────────┐
│  Policy A   │   │  Policy B   │   (child processes, one per policy key)
└──────┬──────┘   └──────┬──────┘
       │                 │
       └────────┬────────┘
                ▼
┌───────────────────────────┐     ┌──────────────────┐
│  Gateway :3100            │────▶│  External Game   │
│  (audit log every call)   │     │  API             │
└───────────┬───────────────┘     └──────────────────┘
            │
┌───────────┴───────────────┐
│  State pollers (1/endpoint)│
└───────────┬───────────────┘
            ▼
┌───────────────────────────┐
│  PostgreSQL (postgres:1.15)│
│  localhost:5432            │
└───────────────────────────┘
```

### Component responsibilities

| Component | Who runs it | What it does |
|---|---|---|
| **Gateway** | one process | Reverse-proxies to `GAME_API_URL`, injects auth, writes `api_calls` |
| **Pollers** | one process | Polls each entry in `config/api.endpoints.json`, writes `game_states` |
| **Jobs** | one process (`npm run jobs` / inside `npm start`) | Tile claimer + owned-flag nuke loop |
| **Owned-flag nuker** | inside jobs | Nukes flags on our tiles; ≤100 pts / 3 min (env-tunable) |
| **Policy supervisor** | inside `npm start` | Spawns one child process per policy in `config/ab-test.json` |
| **Policy worker** | child process | Loads `policies/<key>.ts`, runs `tick()` loop, writes `policy_events` |

### Gateway introspection (local only, not forwarded)

| Endpoint | Returns |
|---|---|
| `GET /_gateway/health` | `{ ok, upstream }` |
| `GET /_gateway/stats` | in-memory + persisted call counts |

---

## How agents call the game API

**Always** go through the gateway:

```
http://127.0.0.1:3100/<game-path>
```

Policies use `GameClient` (see `src/client/gameClient.ts`), which sets attribution headers:

| Header | Set by | Purpose |
|---|---|---|
| `x-policy-id` | policy client | Links call to a policy in `api_calls.policy_id` |
| `x-run-id` | policy client | Links call to `policy_runs.id` |
| `x-source` | client | `policy`, `poller`, or `gateway` |

Pollers and policies tag themselves automatically. If you hand-craft requests (e.g.
with `curl`), add `x-source: manual` for traceability.

Auth is injected by the gateway — callers do **not** send the real token.

---

## PostgreSQL

### Connection (for any local agent)

```
postgresql://game:game@localhost:5432/game
```

Container: `game-postgres` · Image: `postgres:1.15` · Port: `5432` · Volume: `game_game_pg_data`

### Tables

#### `api_calls` — every proxied request/response

| Column | Type | Notes |
|---|---|---|
| `id` | serial | |
| `ts` | timestamptz | |
| `method` | varchar(16) | GET, POST, … |
| `path` | text | game path (no host) |
| `query` | text | query string |
| `request_headers_redacted` | jsonb | auth headers redacted |
| `request_body` | text | truncated at `GATEWAY_MAX_BODY_BYTES` |
| `response_status` | int | |
| `response_body` | text | truncated |
| `latency_ms` | int | |
| `policy_id` | varchar(64) | nullable |
| `run_id` | int | nullable, FK-ish to `policy_runs.id` |
| `error` | text | set on upstream failure |
| `source` | varchar(32) | `gateway`, `policy`, `poller`, … |

#### `game_states` — polled snapshots

| Column | Type | Notes |
|---|---|---|
| `endpoint_key` | varchar(64) | matches `stateEndpoints[].key` in config |
| `fetched_at` | timestamptz | |
| `payload_json` | jsonb | parsed response body |
| `etag_or_hash` | varchar(128) | SHA-256 of payload; duplicates skipped |

#### `policy_runs` — policy lifecycle

| Column | Type | Notes |
|---|---|---|
| `policy_key` | varchar(64) | e.g. `001-init` |
| `zone_json` | jsonb | `{ x, y, w, h }` assigned zone |
| `status` | varchar(32) | `running`, `completed`, `failed`, `stopped` |
| `pid` | int | OS process id of worker |
| `config_json` | jsonb | `{ dryRun, maxTicks }` |

#### `policy_events` — structured logs

| Column | Type | Notes |
|---|---|---|
| `run_id` | int | nullable (pollers log with `run_id = null`) |
| `level` | varchar(16) | `info`, `warn`, `error` |
| `event_type` | varchar(64) | e.g. `discovery_fetch`, `poll_backoff` |
| `message` | text | |
| `data_json` | jsonb | optional payload |
| `source` | varchar(32) | `policy` or `poller` |

### Useful queries

```sql
-- Recent API traffic
SELECT id, ts, method, path, response_status, latency_ms, policy_id, source
FROM api_calls ORDER BY ts DESC LIMIT 20;

-- Latest state per endpoint
SELECT DISTINCT ON (endpoint_key) endpoint_key, fetched_at, payload_json
FROM game_states ORDER BY endpoint_key, fetched_at DESC;

-- Active / recent policy runs
SELECT id, policy_key, status, pid, started_at, stopped_at
FROM policy_runs ORDER BY started_at DESC LIMIT 10;

-- Policy log for a run
SELECT ts, level, event_type, message, data_json
FROM policy_events WHERE run_id = $1 ORDER BY ts;

-- Compare policies (call volume)
SELECT policy_id, count(*) AS calls, avg(latency_ms) AS avg_ms
FROM api_calls WHERE policy_id IS NOT NULL
GROUP BY policy_id;
```

---

## Policies

Policies live in [`../policies/`](../policies/) under **AgentWars** (not inside `game/`).

### File naming

| File | Required | Purpose |
|---|---|---|
| `policies/NNN-name.md` | yes | Hypothesis, what was tried, results, decision |
| `policies/NNN-name.ts` | yes | Executable policy (loaded by key `NNN-name`) |
| `policies/README.md` | yes | Rolling recap table — update after every attempt |

### Policy interface

```ts
import type { Policy, PolicyContext } from "../game/src/policies/types.js";

const policy: Policy = {
  key: "002-greedy",          // must match filename
  zone: { x: 0, y: 0, w: 50, h: 100 },  // optional; overridden by ab-test.json

  async onStart(ctx) { /* once per run */ },
  async tick(ctx) {
    const state = await ctx.getLatestState("state");  // from game_states
    const res = await ctx.client.get("/state");       // via gateway
    if (ctx.dryRun) return;                           // skip mutating moves
    await ctx.logEvent("info", "move", "played at 3,4", { x: 3, y: 4 });
  },
  async onStop(ctx) { /* cleanup */ },
};

export default policy;
```

`PolicyContext` provides: `client`, `db`, `zone`, `runId`, `dryRun`, `logEvent()`, `getLatestState()`.

### Adding a new policy

1. Create `policies/00N-name.md` and `policies/00N-name.ts`.
2. Add entry to `config/ab-test.json` with a non-overlapping zone.
3. Add row to `policies/README.md`.
4. Test: `npm run policy test 00N-name`.
5. Run: `npm run policy run 00N-name` or `npm start` for all.

### Current policies

| Key | Zone | Status | Notes |
|---|---|---|---|
| `001-init` | full board 100×100 | ready | API discovery baseline; dry-run safe |

See [`../policies/README.md`](../policies/README.md) for the live recap.

---

## A/B testing (parallel policies on map zones)

Edit `config/ab-test.json`:

```json
{
  "board": { "width": 100, "height": 100 },
  "policies": [
    { "key": "001-init",  "zone": { "x": 0,  "y": 0, "w": 50, "h": 100 } },
    { "key": "002-greedy", "zone": { "x": 50, "y": 0, "w": 50, "h": 100 } }
  ]
}
```

- Zones must **not overlap** (validated by `validateZones()` in `src/policies/zone.ts`).
- Each policy runs in its **own child process** — restarting one does not kill others.
- Use `inZone({ x, y }, zone)` to restrict moves to the assigned region.
- Helpers: `partitionBoardHorizontally()`, `partitionBoardVertically()`.

**Workflow:** run A and B for 15–30 min, compare `api_calls` / `policy_events` / game
outcomes in DB, promote the winner, retire the loser in `policies/README.md`.

---

## State pollers

Configured in `config/api.endpoints.json`:

```json
{
  "upstreamBaseUrl": "${GAME_API_URL}",
  "authHeader": "${GAME_API_AUTH_HEADER}",
  "stateEndpoints": [
    { "key": "state", "method": "GET", "path": "/state", "pollIntervalMs": 2000 }
  ]
}
```

- One background worker per `stateEndpoints` entry.
- Shared token-bucket rate limiter (`POLL_MAX_RPS`).
- Skips DB insert when payload hash unchanged.
- Backoff on 429 / 5xx; logs to `policy_events` with `source = poller`.

When the real API is discovered, add all state endpoints here (board, score, turn, etc.).

---

## API discovery procedure

Run once to discover endpoints from the OpenAPI spec:

```bash
# Connection (already in .env):
#   PLAYER_ID=remotematthieu999
#   GAME_API_URL=http://172.16.1.190:8000
#   OPENAPI_URL=http://172.16.1.190:8000/openapi.json

# 1. Fetch spec and update config/api.endpoints.json with real paths
curl http://172.16.1.190:8000/openapi.json
# 2. Start infra
cd game
npm run db:up && npm run db:migrate
npm run gateway          # terminal 1
npm run pollers          # terminal 2

# 3. Safe discovery tick
npm run policy test 001-init

# 4. Inspect DB (see queries above)

# 5. Document in policies/001-init.md:
#    - auth scheme, state shape, board dimensions, action endpoints,
#      win signals, rate limits (429 headers)
#    Then tune POLL_MAX_RPS / POLL_INTERVAL_MS and author 002-*.
```

### Discovery checklist

| Item | Where to record |
|---|---|
| Auth scheme | `policies/001-init.md` |
| State endpoint paths | `config/api.endpoints.json` |
| Board dimensions | `config/ab-test.json` → `board` |
| Action endpoints | `policies/001-init.md` |
| Win condition | `policies/001-init.md` |
| Rate limits | `.env` + `policies/001-init.md` |

---

## Agent cooperation playbook

### Before you act

1. Read this file and [`../policies/README.md`](../policies/README.md).
2. Check `npm run status` — is gateway running? Is state fresh?
3. Query `api_calls` / `game_states` — what has already been tried?

### While playing

| Task | Agent action |
|---|---|
| Explore API | `npm run policy test 001-init` (dry-run) |
| Run a strategy | Add `policies/00N-*.ts`, update `ab-test.json`, `npm start` |
| Compare strategies | SQL on `api_calls` grouped by `policy_id` |
| Tune rate limits | Edit `.env`, restart pollers |
| Restart one policy | `npm run policy restart <key>` |
| Full restart | `Ctrl+C` then `npm start` |

### After each attempt

1. Update `policies/NNN-name.md` with what worked / failed.
2. Update `policies/README.md` recap table (status, result, notes).
3. Leave gateway running if other agents are still playing.

### What not to do

- Do not `fetch(GAME_API_URL)` directly — bypasses audit log.
- Do not commit `.env` or tokens.
- Do not edit shipped SQL migrations — add `0002_*.sql` instead.
- Do not overlap zones in `ab-test.json`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `manifest for postgres:1.15 not found` | `docker tag postgres:15.5 postgres:1.15` |
| `connection refused :5432` | `npm run db:up` and wait for healthcheck |
| `ZodError` on startup | Fill required vars in `.env` |
| Policy module not found | File must be `policies/<key>.ts` exporting `default` |
| Policy key mismatch | `policy.key` in `.ts` must equal filename stem |
| 502 from gateway | Upstream down or bad `GAME_API_URL` / token |
| Stale `game_states` | Check pollers running; check rate limits / 429 backoff |

---

## npm scripts reference

| Script | Command | Description |
|---|---|---|
| `db:up` | `docker compose up -d` | Start Postgres |
| `db:down` | `docker compose down` | Stop Postgres |
| `db:migrate` | `tsx src/db/migrate.ts` | Apply SQL migrations |
| `gateway` | `tsx src/cli.ts gateway` | Start proxy only |
| `pollers` | `tsx src/cli.ts pollers` | Start pollers only |
| `start` | `tsx src/cli.ts start` | DB + gateway + pollers + all policies |
| `status` | `tsx src/cli.ts status` | Print DB summary |
| `policy` | `tsx src/cli.ts policy <cmd> <key>` | `test`, `run`, or `restart` |
| `test` | `vitest run` | Unit tests |
| `build` | `tsc` | Typecheck + emit to `dist/` |

---

## Current stack status

| Component | Image / version | Status |
|---|---|---|
| PostgreSQL | `postgres:1.15` (local tag of `postgres:15.5`) | configured |
| Migrations | `0001_init.sql` | ready |
| Gateway | Fastify, port 3100 | ready |
| Pollers | token-bucket, per-endpoint | ready |
| Policy framework | supervisor + child processes | ready |
| Policies | `001-init` | ready for API discovery |
| Game API | `http://172.16.1.190:8000` | configured — player `remotematthieu999`, game `jbs9` |
| OpenAPI spec | `/openapi.json` | configured — discover endpoints next |
