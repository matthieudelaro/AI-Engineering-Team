# Policies recap

Rolling audit of strategies tried against the game API. Each policy has a markdown
write-up (`NNN-name.md`) and an executable module (`NNN-name.ts`).

## Active policies

| ID | Name | Zone | Status | Result | Notes |
|---|---|---|---|---|---|
| 001 | init | left half | ready | pending | API discovery baseline |
| 002 | autoplay | right half | **running** | active | spiral claim loop via gateway |

## How to run

```bash
cd game
pnpm policy test 001-init    # single dry-run tick (safe)
pnpm policy run 001-init     # continuous loop
pnpm policy restart 001-init # stop + spawn new run
pnpm start                   # gateway + pollers + all policies in ab-test.json
```

## A/B testing

Edit [`game/config/ab-test.json`](../game/config/ab-test.json) to assign policies to
non-overlapping map zones. Example for two horizontal halves:

```json
{
  "board": { "width": 100, "height": 100 },
  "policies": [
    { "key": "001-init", "zone": { "x": 0, "y": 0, "w": 50, "h": 100 } },
    { "key": "002-greedy", "zone": { "x": 50, "y": 0, "w": 50, "h": 100 } }
  ]
}
```

## Retired / failed policies

_None yet._

## Learnings

- All traffic must go through the local gateway (`http://127.0.0.1:3100`) so every
  call is persisted in `api_calls`.
- State pollers write to `game_states`; policies should prefer cached snapshots to
  reduce duplicate reads.
- Use `DRY_RUN=true` or `pnpm policy test` before issuing mutating moves.
