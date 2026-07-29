# AgentWars

Timed external territory game — local gateway, Postgres audit log, claim jobs, and map UI.

## Load when working here
1. This README
2. [`MEMORY.md`](MEMORY.md) — project learnings (not in the team root memory)
3. [`game/README.md`](game/README.md) — stack SOPs, API rules, architecture

## Layout
```
projects/AgentWars/
├── MEMORY.md                 # project-local memory
├── .env.example              # copy to .env here
├── playbooks/002-new-game.md
├── scripts/new-game.sh
├── policies/                 # strategy audit docs + modules
└── game/                     # runnable package (gateway, pollers, jobs, UI)
```

## Quickstart
```bash
cd projects/AgentWars
cp .env.example .env   # if needed
cd game && npm install && npm start
```

Switch game/player:
```bash
./scripts/new-game.sh <gameId> <playerId>
```
See [`playbooks/002-new-game.md`](playbooks/002-new-game.md).
