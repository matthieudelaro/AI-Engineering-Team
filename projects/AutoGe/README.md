# AutoGe Car Finder

Research and qualification tooling for used vehicles listed at
<https://www.auto.ge/en/>.

## Current MVP

- versioned initial criteria derived from the user's brief;
- strict domain-event validation;
- content-addressed local artifact storage under ignored `data/`;
- defensive parsing of auto.ge listing text;
- default seller-phone capture with explicit collection status and conservative
  Georgian mobile normalization;
- Supabase schema for immutable events, artifacts, facts, criteria, evaluations,
  and rebuildable listing projections;
- server-side Supabase event importer;
- initial live-market research without seller contact.

## Auto.ge messaging

- Skill: [`skills/auto-ge-messaging/SKILL.md`](skills/auto-ge-messaging/SKILL.md)
- Playbook:
  [`playbooks/001-auto-ge-messaging-playwright.md`](playbooks/001-auto-ge-messaging-playwright.md)

Both require a fresh read of `my-messages.html` after one send attempt. Never
retry from the unchanged form or from Auto.ge's generic system-error banner.

## Start a recurring operator task

Use [`START-AGENT.md`](START-AGENT.md) as the copy-paste prompt for a new agent.
The project-local [`AGENTS.md`](AGENTS.md) loads the operating rules automatically.

- Full operator skill:
  [`skills/auto-ge-operator/SKILL.md`](skills/auto-ge-operator/SKILL.md)
- Daily review and sourcing playbook:
  [`playbooks/002-daily-review-and-sourcing.md`](playbooks/002-daily-review-and-sourcing.md)
- Stable report layout: [`REPORT-TEMPLATE.md`](REPORT-TEMPLATE.md)

The recurring run is read-only: it checks messages, translates replies, refreshes
the shortlist, produces an English report, proposes seller-language follow-ups
with English translations and sources live candidates. Sending requires a separate
approval of the exact original-language text and destination.

## Canonical offer registry

[`OFFER-REGISTRY.md`](OFFER-REGISTRY.md) is the canonical human-readable source
that consolidates every analyzed offer. It is a committed projection, not an
independently edited evidence store: ignored append-only event batches under
`data/` own the structured observations and decisions.

Before delivering any shortlist, sourcing or operator report:

1. archive structured append-only event records for every analyzed listing,
   including rejected and incomplete offers;
2. run `npm run registry:generate`;
3. run `npm run registry:check` and resolve every omission or stale projection.

The check compares direct Auto.ge listing links in narrative reports with the
registry, so an offer cannot silently remain report-only. In a clean checkout,
ignored local event batches are intentionally absent; `registry:check` then
validates narrative coverage against the committed registry. Generation requires
the local event evidence. When event batches are present, the check also replays
them and requires the committed registry to match exactly.

## Local commands

```bash
npm install
npm run verify
```

To import an event batch after the Supabase migration has been applied:

```bash
cp .env.example .env
# Populate the two AUTOGE_SUPABASE_* values locally; never commit .env.
set -a
source .env
set +a
npm run import:events -- data/research/events.json
```

`AUTOGE_SUPABASE_SECRET_KEY` is server-side only. Never expose it in browser code,
logs, prompts, committed files, or Google Sheets.

While the Supabase connector is unavailable in the current task, use the local
SQLite fallback:

```bash
npm run import:events:sqlite -- data/research/events.json data/autoge.sqlite
```

The SQLite file is ignored by Git and enforces append-only events with database
triggers. Importing the same event batch again is idempotent. Supabase remains the
target structured store; the domain events use the same identifiers and payloads
for later migration.

## Storage boundary

- Supabase: structured events, metadata, facts, criteria, evaluations, and
  projections.
- `data/`: raw or sanitized HTML, JSON, media, PDFs, and local event batches.
- Git: code, migrations, tests, criteria documentation, and synthesized research
  reports without credentials or copied personal data.

## Listing discovery phone contract

New `listing_discovered` events use schema version 2 and always include
`phoneCollectionStatus` plus `sellerPhoneNumbers` in their payload. The status is
`observed`, `not_available`, or `not_checked`; the phone-number array is present
even when empty. Each observed item preserves `displayText`, stores a digits-only
comparison key, and includes `e164` only when the displayed digits clearly match a
Georgian mobile number. Discovery deduplicates items by the digits-only key.

Store public listing phone observations in the append-only event payload and the
Supabase listing projection. Do not copy actual seller phone values into
Git-tracked reports, fixtures, docs, logs, prompts, or Google Sheets.
