# AutoGe durable operating memory

This file records stable project knowledge for future agents. Time-sensitive
listing and conversation state belongs in dated reports and the local event store.

## Durable facts

- The target marketplace is `https://www.auto.ge/en/`.
- The user is disabled and may need assistance completing Auto.ge sign-in. When
  Chrome offers remembered credentials, the agent may use the browser's normal
  autofill/password-manager UI to help sign in after the user requests the task,
  without reading, copying, logging, or exposing credential values. If Chrome
  requires fresh credentials, an OTP, CAPTCHA, or account-recovery decision,
  pause for the user's input.
- The authenticated Chrome session owns all credentials. Never copy cookies,
  session IDs, CAPTCHA state or browser storage into code, logs or prompts.
- Auto.ge conversation history is the authoritative delivery check. A listing page
  may show a generic error or stale form even after accepting a message.
- Sending is a one-click operation. After the click, reload/read the relevant
  conversation and compare the message history. Never retry when delivery is
  uncertain, because the endpoint has no observed idempotency key.
- Seller claims are observations, not verified facts. Keep the original language,
  translation, provenance and confidence separate from evaluations.
- Reports are written entirely in English. Seller messages use only the seller's
  detected language, normally Georgian. Every proposal shows that original-language
  text, its exact English translation, the listing URL and the discussion URL in
  adjacent columns.
- Read-only inbox checks, reports and listing research need no sending approval.
  Each outbound message needs approval of its exact original-language text and
  destination in the active task.
- Before asking a seller for a VIN or accident-history detail, inspect the complete
  original-resolution listing gallery, validate and cross-check any visible VIN,
  and perform available exact-VIN and auction-history research. Record gallery
  coverage and ask only for facts that remain unresolved.

## Storage

- Versioned specifications, playbooks, skills and synthesized reports live in this
  directory.
- Raw pages, responses, media and the SQLite event store live under ignored
  `data/`. They may be absent in a fresh checkout and must never contain secrets.
- Derived ranks and statuses can be recomputed; archived observations and events
  are the evidence base.

## Operator entry point

Start with `START-AGENT.md`, then follow `skills/auto-ge-operator/SKILL.md` and
`playbooks/002-daily-review-and-sourcing.md`. Messaging details are isolated in
`skills/auto-ge-messaging/SKILL.md` and its Playwright playbook.
