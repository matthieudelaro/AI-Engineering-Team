# AI-Engineering-Team-Demo

> A demo repo — the hands-on engineering team that ships what the org decides.

A public demo repo, illustrative rather than workshop courseware. The implementation
counterpart to the demo ladder: the other demo repos build up to an organisation
whose CTO does decision-support and standards; this is the team that does the actual
building — an Architect front door coordinating specialist engineers, with a quality
gate and a security gate, all written down as plain Markdown in git.

## What is in here
- `CLAUDE.md`: the startup routine, read on every session.
- `MEMORY.md`: the team's shared memory (role-specific memory lives in each role's
  folder).
- `context/`: loaded on demand via `context/INDEX.md`. `PROFILE.md` (who you are:
  what you're building, your stack) is filled in by the first-run setup;
  `PRINCIPLES.md` captures how you like work done.
- `roles/<role>/`: one folder per role, each with `ROLE.md` (what it does) and
  `MEMORY.md` (what it has learned). Roles: `architect` (front door), `backend`,
  `frontend`, `qa`, `security`.
- `standards/`: engineering standards loaded on demand — `BACKEND-STANDARDS.md`
  (Python by default), `FRONTEND-STANDARDS.md` (TypeScript/JavaScript by default),
  a shared `TESTING-STRATEGY.md` (TDD), and `GIT-WORKFLOW.md` (trunk-based,
  conventional commits, rebase-merge). The welcome wizard tunes the language and
  testing standards to your stack on first run.
- `PERMISSIONS.md`: the grants matrix — who may do what (the policy layer).
- `.claude/agents/`: the Backend, Frontend, Security, and QA subagents (the
  Architect is the main session).
- `.claude/settings.json`: the permission floor for connector tools (read allowed,
  write denied).
- `playbooks/`: saved procedures run on a trigger word or a schedule (see
  `playbooks/README.md`).
- `projects/`: side projects (e.g. AgentWars) kept out of every-session startup
  context — load via `projects/README.md` only when that project is the task.

## How to start
1. Fork or clone this repo.
2. Open it in Claude Code.
3. Say **"Hi"** to kick off. On the first run that triggers a quick setup (the
   welcome wizard — it asks who you are, which languages your engineers should
   specialise in, and whether you work test-first, then builds matching standards).
   After that the Architect triages each build request, hands work to the Backend
   and Frontend engineers, and runs anything non-trivial past QA before it reaches
   you.

## Concepts in this repo
- **Written memory and context** (`MEMORY.md`, `context/` via `INDEX.md`) — loaded
  on demand; identity and stack in `PROFILE.md`, working preferences in
  `PRINCIPLES.md`.
- **Layered memory** — a shared team `MEMORY.md`, per-role `roles/<role>/MEMORY.md`,
  and optional `projects/<Name>/MEMORY.md` (load only when that project is the
  task); the more specific layer wins.
- **A front-door router (the Architect)** — every build request enters through the
  Architect, who triages, breaks it down, and delegates. Roles live in
  `roles/<role>/ROLE.md`.
- **Subagents and context isolation** (`.claude/agents/*.md`) — the engineers, QA,
  and Security run in their own fresh context windows, so the Architect stays lean.
  The Backend and Frontend engineers are Staff-level, on Opus.
- **Engineering standards** (`standards/`) — the coding, testing, and git bar
  written down, loaded on demand: backend (Python), frontend (TypeScript/JavaScript),
  test-first (TDD), and a git workflow (trunk-based, conventional commits). The
  welcome wizard tunes the language and testing standards to your chosen stack on
  first run.
- **Tools allow-list** — each subagent lists exactly the tools it may use, and QA
  is read-only by design. Capability is scoped per role.
- **Connectors, read-only first** — real tools are added through Claude Code; the
  engineers get the GitHub connector in read-only mode (reads allowed, writes denied
  in `.claude/settings.json`), escalated to write only deliberately.
- **The QA loop (the Verifier)** — non-trivial builds are checked against the brief;
  on defects it goes back to the engineer, up to 3 rounds, then escalates.
- **A security gate** (`roles/security/ROLE.md`) — a hands-on **second gate** that
  runs *after* QA, on QA-validated work, and only when a change is security-relevant
  (auth, data handling, permissions, connectors, configuration). Its fixes go back
  through QA before they ship.
- **Playbooks** — the first-run welcome wizard, plus a **scheduled** one: the PR
  digest, a read-only morning summary of open pull requests, run by the Architect.
  This repo assumes you know git, so there are no `save` / `reload` shortcuts.
- **Governance** — `context/GOLDEN-RULES.md` (the constitution, loaded first),
  `PERMISSIONS.md` (the action-tier grants matrix), and `context/PRINCIPLES.md`
  (how you like work done). A capability is real only when granted in both
  `PERMISSIONS.md` and the role's allow-list (the two-place model), with a
  `.claude/settings.json` floor denying what should never happen.
- **Git as the store** — versioned, diffable, revertable.

## Changing things: the governed flow
Because everything here is plain Markdown in git, the way to change anything —
memory, context, roles, or the rules themselves — is a real git flow:

1. **Branch** off `main`.
2. **Edit** the files.
3. **Open a pull request** and review it — the QA loop checks the change before it
   lands, the same way it gates any other deliverable.
4. **Merge** once it passes.
5. **Revert** to undo — `git revert` drops a bad change and keeps *both* the mistake
   and its correction in the history, so nothing is silently rewritten.

This is the apex of "git as the store": every change is proposed, reviewed, and
reversible, with a full audit trail. This repo assumes you are comfortable with git
and work this flow directly — there is no `save` / `reload` shortcut. The
conventions (trunk-based branches, conventional commits, rebase-merge) live in
`standards/GIT-WORKFLOW.md`.

## Claude Code files (and Codex equivalents)
Most of this repo is plain Markdown that copies to any agent runner unchanged:
`MEMORY.md`, `context/`, the `roles/<role>/` docs, and `playbooks/` (playbooks are
just SOPs written down, not the Claude "skills" feature). Only a few things are
genuinely Claude Code-specific:

| This repo (Claude Code) | Codex equivalent |
|---|---|
| `CLAUDE.md` (auto-loaded startup file) | `AGENTS.md` |
| `.claude/agents/*.md` (named subagents) | `.codex/agents/*.toml` (custom agents; not auto-delegated, you delegate explicitly) |
| the `tools:` allow-list in a subagent | `approval_policy` + `sandbox_mode` in `config.toml` (an approval/sandbox model, not a literal tool allow-list) |

## The progression
The core workshop is a three-step ladder, from one agent to an organisation:

[`AI-Agent-Demo`](https://github.com/gbergeret/AI-Agent-Demo) (one agent) ->
[`AI-Team-Demo`](https://github.com/gbergeret/AI-Team-Demo) (a team with a router) ->
[`AI-Teams-Demo`](https://github.com/gbergeret/AI-Teams-Demo) (an organisation of
teams).

`AI-Engineering-Team-Demo` sits alongside that ladder rather than on it: it is the
implementation team the organisation's CTO delegates the actual building to — the
hands-on counterpart to the org's decision-support engineering.

## License
[MIT](LICENSE) © 2026 GBergeret Cloud Services
