# Official AgentWars server notes

Captured from `http://aw.oakzone.eu:51245`.

## Current game
- Game id: `qd4w`
- Player id (us): `remotematthieu999`
- Prior ids this session: `gccg`, `xkh5`

## Artifacts
- `openapi.json` — live OpenAPI from the official gateway (`GET /openapi.json`)
- `method-limits-qd4w.json` — `GET /api/v1/method-limits?game_id=qd4w`
- `method-limits-gccg.json` — prior game `gccg`
- `method-limits-xkh5.json` — prior game `xkh5`

## MethodLimitsResponse shape (from OpenAPI)
Keys beyond our local mock: `launch_nuke`, `request_scan`, `set_emotion`, `fog_of_war_padding_tiles`, plus the usual `place_tile` / `get_map` / `get_flags` / `get_stats` / `get_leaderboard`.
