# Team instructions

The startup routine. Read this first, on every session.

## Load on every session
1. `context/GOLDEN-RULES.md`: the constitution. Read it first; it overrides everything here.
2. `PERMISSIONS.md`: who may do what, the grants matrix. Binding on every action.
3. `MEMORY.md`: the team's shared memory.
4. `context/INDEX.md`: the map of context. Load context files on demand, not everything every time.
5. When acting as a role, load `roles/<role>/ROLE.md` and `roles/<role>/MEMORY.md`.

## The team
- **Architect (front door):** triages and delegates every build request. See `roles/architect/ROLE.md`.
- **Staff Backend engineer:** APIs, data, and server-side logic. See `roles/backend/ROLE.md`.
- **Staff Frontend engineer:** UI and client-side work. See `roles/frontend/ROLE.md`.
- **QA:** checks a build against its brief. See `roles/qa/ROLE.md`.
- **Security engineer:** hardens security-relevant work after QA. See `roles/security/ROLE.md`.

## Effort
Tool-specific agent adapters set each subagent's reasoning effort. Claude adapters
live in `.claude/agents/*.md`; Codex adapters live in `.codex/agents/*.toml`.
Use heavier reasoning for security and judgement and lighter reasoning for routine
build work. The Architect runs in the main session, so its effort is a session
setting rather than a subagent adapter.

## How work flows
The Architect delegates implementation to the Backend and Frontend engineers. For
non-trivial work, QA checks the build against the brief. Defects return to the
engineer for revision and QA checks again, up to three rounds. Only a PASS, or an
escalation after three unsuccessful rounds, reaches the user.

Security is a second gate, after QA and never before. Run it only for
security-relevant work such as authentication, data handling, permissions,
connectors, or configuration. Security fixes return through QA before delivery.

## Engineering standards
Load standards on demand using `context/INDEX.md`. Backend and Frontend engineers
follow their respective standards and `standards/TESTING-STRATEGY.md`. Everyone
follows `standards/GIT-WORKFLOW.md` for branches, commits, and pull requests.

## Connectors and permissions
Configure tools in each product's native adapter. Permissions remain
deny-by-default: a capability must be granted in `PERMISSIONS.md` and in the
applicable tool configuration or agent allow-list. Start external connectors as
read-only and grant writes deliberately in both places.

## Playbooks
Playbooks are saved procedures listed in `playbooks/README.md`. The daily scheduled
playbook is `playbooks/001-pr-digest.md`, a read-only digest of open pull requests.
Use the governed Git flow in `README.md`; there are no save/reload shortcuts.

## Memory layers
- **Shared:** `MEMORY.md`.
- **Role:** `roles/<role>/MEMORY.md`.
- **Project:** `projects/<Name>/MEMORY.md`, loaded only for that project.

Keep memory current by replacing outdated information rather than only appending.
Put knowledge in the most specific applicable layer; the more specific layer wins
on conflict.
