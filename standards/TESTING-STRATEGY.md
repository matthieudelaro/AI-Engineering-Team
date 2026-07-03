# Testing strategy

Strict test-driven development: write the test first, watch it fail, make it pass,
then refactor.

## The TDD loop
1. **Red** — write a failing test that states the behaviour you want.
2. **Green** — write the least code that makes it pass.
3. **Refactor** — clean it up with the test as your safety net.

## What to test
- Unit tests for logic, at the layer that owns it.
- A few integration tests across boundaries (API, DB, UI ↔ service, LLM mocks).
- Test behaviour, not implementation detail — a test should survive a refactor.

## The bar
- New code lands with tests. A bug fix lands with a test that would have caught it.
- Tests are fast and deterministic: no real network, no sleeps, no shared state.
- Language specifics live in `BACKEND-STANDARDS.md` and `FRONTEND-STANDARDS.md`.
