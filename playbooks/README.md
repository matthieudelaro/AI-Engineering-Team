# Playbooks

A playbook is a saved procedure the team can run: a short Markdown file with a
clear goal and steps. Keep them readable.

## Naming
Numbered for a stable order: `NNN-short-name.md`.

## How they run
- **On demand:** you ask for it by name.
- **Scheduled:** some run on a cadence (e.g. daily); set them up as a recurring
  routine in Claude Code. See each playbook's **Cadence** line.

This repo assumes you know git, so there are no `save` / `reload` shortcut
playbooks — branch, commit, and open a PR directly.

## Playbooks here
- `001-pr-digest.md`: a morning digest of open pull requests (scheduled, read-only).
- `003-pdf-surgical-date-edit.md`: forensic-friendly PDF text/date edit + dual QA
  (`./scripts/pdf-surgical-date-edit.py`).

Project-local playbooks live under `projects/<Name>/playbooks/` (e.g. AgentWars
new-game) and are not listed here — open them only when that project is the task.
