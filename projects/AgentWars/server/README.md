# AgentWars Server

Authoritative game engine and HTTP API for AgentWars. Implements tile claiming, fog-of-war, leaderboard, flags, nukes, SSE map stream, and a harness for deterministic tests.

## Quick start

```bash
cd projects/AgentWars/server
npm install
npm run dev
```

The server listens on `PORT` (default `8000`).

### Spectator (bird's-eye view)

Open the omniscient spectator UI in a browser (no fog, read-only):

```
http://127.0.0.1:8000/spectator?game_id=default
```

`/` also serves the same page. Omit `game_id` to watch the `default` game.

Point the game client gateway at this server:

```bash
# in projects/AgentWars/game/.env
GAME_API_URL=http://127.0.0.1:8000
OPENAPI_URL=http://127.0.0.1:8000/openapi.json
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload (`tsx watch`) |
| `npm start` | Start server (`tsx src/index.ts`) |
| `npm test` | Run unit + integration tests |
| `npm run build` | Typecheck and emit `dist/` |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | HTTP listen port |
| `GAME_ID` | `default` | Default game created on boot |
| `PLAYER_IDS` | — | Pre-register players: `id:DisplayName:color,...` |
| `RATE_LIMIT_DISABLED` | — | Set to `1` to disable rate limiting |
| `HARNESS_TOKEN` | — | Required for harness routes in non-test environments |
| `NODE_ENV` | — | `test` enables harness without token |

## API overview

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /spectator` | Omniscient spectator UI (static) |
| `GET /openapi.json` | OpenAPI spec |
| `GET /api/v1/spectator/map?game_id=` | Full map (no fog, no auth) |
| `GET /api/v1/spectator/leaderboard?game_id=` | Leaderboard (no `is_self`) |
| `POST /api/v1/place-tile` | Claim a tile (`X-Player-Id` required) |
| `GET /api/v1/map?game_id=` | Fogged map for player |
| `GET /api/v1/games/:gameId/map/stream` | SSE `tile_captured` events |
| `GET /api/v1/leaderboard?game_id=` | Leaderboard with `is_self` |
| `GET /api/v1/flags?game_id=` | Active flags |
| `GET /api/v1/method-limits?game_id=` | Advertised rate limits |
| `POST /api/v1/launch-nuke` | Launch nuke on owned tile |
| `GET /api/v1/players/:name/stats` | Player stats |

Rate limits (per player, per second): `place_tile` 20, `get_map` 30, `get_flags` 20, `get_leaderboard` 20.

Unknown `X-Player-Id` values are auto-registered when fewer than 8 players are in the game.

## Harness (testing / fixtures)

When `HARNESS_TOKEN` is set (or `NODE_ENV=test`), admin routes are available:

| Route | Description |
|-------|-------------|
| `POST /_harness/games` | Create or reset a game |
| `POST /_harness/games/:id/players` | Register a player |
| `POST /_harness/games/:id/seed` | Seed from snapshot JSON |
| `GET /_harness/games/:id/state` | Omniscient game state |
| `POST /_harness/games/:id/step` | Apply place-tile or nuke step |

Sample fixture: `fixtures/enclosure-mono-q.json`.

```bash
curl -X POST http://127.0.0.1:8000/_harness/games -H 'Content-Type: application/json' -d '{"id":"mono-q"}'
curl -X POST http://127.0.0.1:8000/_harness/games/mono-q/seed -H 'Content-Type: application/json' --data-binary @fixtures/enclosure-mono-q.json
```

## Tests

```bash
npm test
```

Engine unit tests live under `src/engine/`. HTTP integration tests use `fastify.inject` in `src/http/http.test.ts`.
