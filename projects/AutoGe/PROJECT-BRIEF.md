# Auto.ge Car Finder — Project Brief

## Goal

Build an autonomous research and qualification assistant for used cars listed on
[auto.ge's English site](https://www.auto.ge/en/). It should turn a large,
inconsistent set of
listings into a small, ranked set of vehicles that match the user's needs and
are sufficiently documented to support an inspection or purchase decision.

The user must be able to describe the need in natural language. The system should
convert that description into versioned hard constraints, preferences, and
questions that require further research.

## Primary capabilities

1. Research vehicle models that could satisfy the stated need, including
   specifications, reliability, ownership costs, and parts availability in
   Georgia.
2. Discover and monitor relevant auto.ge listings.
3. Preserve listing observations and source artifacts so later changes remain
   traceable.
4. Identify missing facts and, once outbound messaging is explicitly enabled,
   ask sellers for details such as availability, VIN, customs status, inspection
   and test-drive availability in Tbilisi, and additional media.
5. Decode supplied VINs and compare the decoded identity with the listing and
   seller claims.
6. Enrich candidates with vehicle-history, auction-history, customs, repair,
   parts, and total-cost research where lawful sources are available.
7. Reject, rank, and explain candidates using versioned criteria.
8. Produce a concise comparison that distinguishes qualified, rejected, and
   incomplete vehicles.

## What makes a car a great match

The criteria are not fixed yet. Expected inputs include:

- maximum purchase and total-acquisition budgets;
- drivetrain and transmission requirements;
- minimum cargo capacity and other space constraints;
- maximum fuel consumption;
- reliability and expected maintenance burden;
- availability and price of parts in Georgia;
- customs-cleared status and other import costs;
- availability for inspection and test drive in Tbilisi;
- acceptable accident and repair history;
- confidence and completeness of the available evidence.

Each criterion must be classified as a hard constraint, scored preference, or
information request. Criteria and weights must be versioned so all previously
observed vehicles can be reevaluated when the user's priorities change.

## Search scope and constraints

- Canonical marketplace entry point: <https://www.auto.ge/en/>. References in
  source notes to `myauto.ge` are treated as naming mistakes, not as an
  additional marketplace requirement.
- Initial geography: Georgia, with practical emphasis on vehicles that can be
  inspected in Tbilisi.
- Do not infer missing facts. Preserve unknown values as unknown and retain the
  provenance and confidence of extracted facts.
- Research may run autonomously. Real seller contact must remain disabled until
  message templates, rate limits, duplicate prevention, stop conditions, and the
  required approval policy have been explicitly accepted.
- Never bypass CAPTCHA or other anti-abuse controls. Pause for human intervention.
- Respect auto.ge's terms, robots/rate controls, and applicable privacy and
  communications rules. The observed internal endpoint is not a public API and
  may change without notice.
- Keep WhatsApp, SMS, calls, and other off-site channels disabled unless they are
  separately designed and explicitly enabled.
- Do not store, log, commit, or expose browser credentials, cookies, CSRF tokens,
  or session identifiers. Authentication should remain inside a protected
  browser profile.
- Data published to the shared Google Sheet must concern only auto.ge listings,
  vehicles, and automotive research. It must contain no information about or
  supplied by the user, and no secrets or private account/session data.

## How the workflow should work

```text
User need
  -> versioned search and evaluation criteria
  -> model research and auto.ge discovery
  -> immutable listing observations in Supabase
  -> sanitized artifacts in ignored local storage
  -> completeness checks and optional approved seller conversations
  -> VIN and external-source enrichment
  -> versioned evaluation and projections
  -> ranked shortlist in Supabase
  -> optional Google Sheets publication
  -> human feedback
  -> replay and reevaluation
```

### Replayable data model

The source of truth should be an append-only journal of observations, actions,
and external decisions. Current fields such as score, conversation status,
missing VIN, and shortlist position are derived projections, not primary facts.

Every event should include, at minimum:

- stable event and subject identifiers;
- event type, occurrence time, and recording time;
- causation and correlation identifiers where applicable;
- source and schema version;
- structured payload;
- a reference to the sanitized raw artifact, if one exists.

Observation, interpretation, and decision must be recorded separately. A seller
statement is evidence; a model-produced fact is a versioned interpretation with
confidence and provenance; a rejection or score is a versioned decision.

Large artifacts such as HTML, JSON, photos, videos, and PDFs must use the ignored
project-local directory `projects/AutoGe/data/`. Within it, use content-addressed
storage keyed by SHA-256 so identical artifacts are stored once. Text artifacts
may be compressed, but useful business evidence should not be silently
discarded. Secrets must be scrubbed before immutable storage.

### Supabase structured storage

The connected Supabase project is the primary store for tabular and structured
data, including events, artifact metadata and hashes, observed listings,
normalized facts, criteria versions, extraction runs, evaluations, action state,
and read-model projections. Binary and large text artifacts remain local; their
Supabase records contain hashes, media types, sizes, timestamps, provenance, and
relative local object paths.

Database design requirements:

- preserve the append-only event journal as the source of truth;
- make writes idempotent with stable identifiers and uniqueness constraints;
- keep migrations in version control and make projections fully rebuildable;
- keep secrets and browser session state out of Supabase;
- enable Row Level Security on every table in an exposed schema;
- do not expose tables through the Data API unless the application needs them;
- use narrowly scoped server-side credentials, never a service-role key in a
  browser or committed configuration;
- verify all schema changes with test queries and Supabase security advisors.

The exact connected project, existing schemas, access model, and available
credentials must be inspected before the first schema change. As of August 2026,
new Supabase tables may not be automatically exposed through the Data API; API
exposure and RLS are separate controls and must both be configured deliberately.

### Seller messaging

The observed contact request is a same-origin form POST to
`https://www.auto.ge/request.ajax.php` with `mode=contactOwner`, the message,
listing ID, and observed compatibility fields. The preferred implementation is
Playwright operating inside an authenticated page or context so session cookies
remain browser-managed.

Before enabling any autonomous sends, the implementation must:

1. capture and document the real application-level success response;
2. verify delivery against conversation history;
3. implement deterministic duplicate-send prevention;
4. validate that the listing is active immediately before sending;
5. enforce the observed 250-character UI limit;
6. impose conservative schedules and per-listing/global rate limits;
7. stop on uncertain delivery rather than retrying blindly;
8. provide a global kill switch and a human pause event;
9. pause on expired login or CAPTCHA;
10. archive only sanitized request metadata and responses.

No real seller should be contacted merely to test the integration. Tests should
use read-only inspection, controlled fixtures, or an explicitly designated test
listing/account.

### VIN decoding

Use NHTSA vPIC's public `DecodeVinValuesExtended` JSON endpoint for a first-pass
identity decode. Store the full raw response and a versioned normalized view.
vPIC describes manufacturer-reported vehicle identity; it does not establish
accident, auction, ownership, mileage, customs, maintenance, or mechanical
history. Empty vPIC fields remain unknown.

Compare the supplied VIN, VIN visible in media/documents, decoded make/model/year,
and listing claims. Identity mismatches require rejection or human review; model
aliases and market/generation differences must be normalized before deciding.

### Google Sheets output

The public working sheet is:

<https://docs.google.com/spreadsheets/d/1MyLaB3o98NubhZoNV44RywiWAJMCj_3qAGZdgdMCWJI/edit?usp=sharing>

Use it only as an optional human-readable projection of researched listings.
Supabase is the structured system of record. Sheet writes must be deterministic
and idempotent, keyed by listing ID or another stable identifier. The
implementation should first validate the sheet's tabs, schema, editability, and
safe write method without publishing personal or secret data.

## Outputs and definition of done

The MVP is successful when it can:

- accept and version a natural-language vehicle brief;
- discover and archive auto.ge listings without losing provenance;
- persist structured observations and projections in Supabase;
- store large source artifacts under the ignored `projects/AutoGe/data/` tree;
- replay all projections from stored events and versioned reducers;
- show why every vehicle is qualified, rejected, or incomplete;
- reuse prior model and vehicle research at the correct generation, market,
  drivetrain, engine, transmission, and body configuration;
- decode VINs and flag listing/identity inconsistencies;
- publish an idempotent, privacy-safe comparison to the shared Google Sheet;
- resume safely after interruption without duplicating observations or actions;
- demonstrate seller messaging safely before any autonomous production use.

The eventual target shortlist should contain a configurable number of
**qualified** vehicles, not merely vehicles with calculable scores. The exact
qualification definition and target count remain user decisions. A provisional
definition may require all hard constraints to pass, confirmed availability,
adequate identity/history evidence, an estimable total cost, and a minimum
confidence threshold.

## Notes, examples, and open questions

- What is the user's initial natural-language vehicle brief?
- Which requirements are absolute versus preferences?
- What does “qualified” mean, and how many qualified vehicles should stop new
  discovery/contact work?
- Is a VIN mandatory for qualification?
- Which accident categories are automatic rejection, human review, or penalty?
- Which seller actions require per-message approval versus approval of a bounded
  campaign policy?
- What retention, encryption, and backup policy should protect raw artifacts and
  browser profiles?
- Which Supabase project and schema should contain the AutoGe tables, and which
  application identity should access them?
- Which Google Sheet columns and tabs should receive optional projections?
- Which auto.ge pages and responses can be collected consistently without
  violating site rules or triggering anti-abuse controls?
- The exact auto.ge response schema, stable selectors, conversation-history
  behavior, and minimal required browser state must be verified experimentally.
