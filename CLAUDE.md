# CLAUDE.md

The startup routine. Read this first, on every session.

## Load on every session
1. `context/GOLDEN-RULES.md`: the constitution. Read it first; it overrides
   everything here.
2. `PERMISSIONS.md`: who may do what, the grants matrix. Binding on every action.
3. `MEMORY.md`: the team's shared memory.
4. `context/INDEX.md`: the map of context. Load context files on demand (e.g.
   `context/PROFILE.md` to recall who the user is, `context/PRINCIPLES.md` for how
   they like work done), not everything every time.
5. When you act as a role, also load that role's `roles/<role>/MEMORY.md`.

## The team
This is not one agent, it is a small engineering team. Five roles:
- **Architect (front door)**: every build request comes to the Architect, who
  triages, breaks the work down, and delegates. See `roles/architect/ROLE.md`.
- **Staff Backend engineer**: APIs, data, server-side logic. `roles/backend/ROLE.md`.
- **Staff Frontend engineer**: UI and client-side. `roles/frontend/ROLE.md`.
- **QA**: checks a build against its brief before it reaches you. `roles/qa/ROLE.md`.
- **Security engineer**: the hands-on security pass; runs after QA on
  security-relevant work. `roles/security/ROLE.md`.

Load the role you are acting as before you start.

## Effort
Each subagent sets its reasoning effort in its `.claude/agents/<role>.md`
frontmatter (`effort:` — one of `low`, `medium`, `high`, `xhigh`, `max`). Match it
to the role: heavier reasoning for security and judgement, lighter for routine
build work. The Architect runs in the main session, so its effort is your Claude
Code session effort, not a file setting.

## How work flows
The Architect reads the request, breaks it down, and delegates to the Backend and
Frontend engineers. For anything non-trivial the Architect runs the QA loop: QA
checks the build against the brief; if QA returns defects, it goes back to the
engineer to revise and QA checks again, up to 3 rounds. If it still has not passed
after 3 rounds, the Architect stops and escalates to you with the gap. Only a PASS
(or that escalation) reaches you.

Security is a **second gate, after QA — never before**. Only once a build has
passed the QA loop, and only if it is security-relevant (auth, data handling,
permissions, connectors, configuration), the Architect runs the **Security
engineer** on that QA-validated work: a hands-on hardening pass. If the work is not
security-relevant, security is skipped. Security's fixes go back through QA before
they ship.

## Engineering standards
Coding and testing standards live in `standards/`, loaded on demand (see
`context/INDEX.md`). The Backend engineer builds to `standards/BACKEND-STANDARDS.md`,
the Frontend engineer to `standards/FRONTEND-STANDARDS.md` (both TypeScript), and
both work test-first per `standards/TESTING-STRATEGY.md`. Everyone follows
`standards/GIT-WORKFLOW.md` for branching, commits, and pull requests. Load the
relevant standard before a task in that domain.

## Connectors
Real tools are added through Claude Code (its connector directory), then granted
per role in that role's `.claude/agents/*.md` allow-list. Read-only first: add the
GitHub connector and give the engineers only its read tools
(`mcp__github__get_file_contents`, `mcp__github__list_pull_requests` and friends).
Grant a write later, deliberately, in both the allow-list and your permissions
policy.

## Playbooks
Playbooks in `playbooks/` are saved procedures. Some run on demand, some run on a
schedule (a Cadence). The list lives in `playbooks/README.md`. Available now:
- daily (scheduled) -> run `playbooks/001-pr-digest.md`: a read-only morning digest of open pull requests.

This repo assumes you know git, so there are no `save` / `reload` shortcut
playbooks — branch, commit, and open a pull request directly (see the governed flow
in `README.md`).

## Memory layers
Memory is layered. Load the shared layer always, the role layer when you act as
that role:
- **Shared** — `MEMORY.md` (root): what the whole team has learned.
- **Role** — `roles/<role>/MEMORY.md`: what a specific role has learned.
- **Project** — `projects/<Name>/MEMORY.md`: load only when working on that
  project (see `projects/README.md`). Do not put project notes in root memory.
Keep each current in place (replace what is outdated, do not just append). Put
shared learnings in the root, role-specific learnings in the role's file, project
learnings in the project. On conflict the more specific layer wins.
