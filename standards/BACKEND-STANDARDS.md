# Backend standards (TypeScript)

Server-side logic, agent orchestration, APIs, and data — all in TypeScript.

## Language
- TypeScript with `strict` enabled. No `any`, no unsafe casts — model the types.
- Node.js 20+ LTS; modern ES modules; `const` / `let`, never `var`.
- Format with Prettier, lint with ESLint (`@typescript-eslint/no-explicit-any` on).
  CI fails on lint errors.
- Small, single-purpose functions; explicit over clever.

## APIs and data
- Validate input at the edge (e.g. Zod schemas); never trust the caller.
- Keep business logic out of the framework layer so it stays testable.
- A migration for every schema change; never edit a migration that has shipped.

## LLM and prompting
- Prompts are code: version them, test them, and type their inputs and outputs.
- Separate prompt templates from orchestration logic; make prompts readable and
  reviewable.
- Handle model failures explicitly — timeouts, rate limits, malformed responses.
- Never log secrets, API keys, or full user payloads.

## Testing (TDD — see `TESTING-STRATEGY.md`)
- Vitest or Jest; write the failing test first.
- Unit-test logic in isolation; mock LLM calls at the boundary.
- A few integration tests across the API and persistence layer.
- Tests pass in any order; no shared mutable state.

## Done
- Typed, formatted, linted, tested, and reviewed through the QA loop.
