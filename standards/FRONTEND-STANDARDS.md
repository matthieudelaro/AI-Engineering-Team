# Frontend standards (TypeScript)

UI, client-side logic, and agent-facing surfaces — all in TypeScript.

## Language
- TypeScript with `strict` enabled. No `any`, no unsafe casts — model the types.
- Modern ES modules; `const` / `let`, never `var`.
- Small components and pure functions; keep state local until it must be shared.

## Style
- Format with Prettier, lint with ESLint (`@typescript-eslint/no-explicit-any` on).
  CI fails on lint errors.
- Names say what they are; no abbreviations that need a decoder.

## LLM and prompting
- Prompts shown in the UI are still code — type their inputs, outputs, and states.
- Surface model errors clearly to the user; never expose raw API responses or keys.
- Streaming responses need typed event shapes and clean cancellation.

## Testing (TDD — see `TESTING-STRATEGY.md`)
- Component and unit tests with Vitest or Jest + Testing Library.
- Test what the user sees and does, not internal wiring.
- Accessibility is part of done: semantic HTML, keyboard reachable, labelled controls.

## Done
- Typed, linted, tested, accessible, and reviewed through the QA loop.
