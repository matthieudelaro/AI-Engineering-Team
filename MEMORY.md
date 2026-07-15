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
- Nothing yet. This fills in as we work.

## Learned
- Game UI map “jumps” on API sync were from bounds `min_x`/`min_y` shifting world pixels without camera compensation, plus `fitToView` on every expansion. Fix: compensate translate; refit only on initial load.
