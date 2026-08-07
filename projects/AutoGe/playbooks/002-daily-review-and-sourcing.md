# 002 - Auto.ge daily review and sourcing

**Cadence:** On demand. Read-only unless the user separately approves exact
messages.

Review seller conversations, recalculate the shortlist, propose translated replies
and discover additional Auto.ge candidates. Write the report entirely in English.

## Inputs

- `PROJECT-BRIEF.md` and `CRITERIA.md`;
- latest `SHORTLIST-*.md` and operator report;
- ignored SQLite/event artifacts when present;
- authenticated Chrome session for Auto.ge;
- `REPORT-TEMPLATE.md` for the output contract.

## Steps

1. Open `https://www.auto.ge/en/my-messages.html` and load all relevant
   conversations using the messaging skill. Do not send.
2. Compare the visible history with previously archived events. Identify genuinely
   new inbound messages and preserve the original source text.
3. Translate new seller replies into English. Mark uncertainty instead of guessing
   slang, measurements or mechanical terminology.
4. Extract facts, contradictions and missing information. Keep observation,
   interpretation and decision separate.
5. Re-evaluate affected vehicles against `CRITERIA.md` and update the shortlist
   only when evidence supports the change.
6. Detect the seller's language, then draft the next useful reply only in that
   language (normally Georgian). Put the original-language draft, exact English
   translation, listing URL and discussion URL in the same report row. Default
   status is `Awaiting approval`.
7. Source live offers from `https://www.auto.ge/en/`. Prioritize:
   - vans with a plausible 2 m sleeping length and preferably 1.9 m standing
     height;
   - Mitsubishi Delica or similarly capable AWD sleepable vehicles;
   - spacious road minivans such as Toyota Voxy, Nissan Elgrand, Nissan Quest or
     Honda Odyssey;
   - reliable, liquid small cars when larger vehicles are poor value.
8. Open every proposed listing directly and verify that it is active. Record price,
   year, mileage, customs status, drivetrain, location, publicly displayed seller
   phone numbers and critical unknowns. Phone collection is required for every
   discovery event: record `observed`, `not_available`, or `not_checked`, preserve
   each exact display value, deduplicate by digits, and infer `+995` E.164 only for
   an unambiguous Georgian mobile pattern. Store actual phone values only in the
   event/projection store or ignored artifacts, never in Git-tracked reports.
9. Follow `playbooks/003-vin-and-accident-history-enrichment.md` before recording a
   VIN or accident history as missing or drafting a seller request. Inspect the
   complete original-resolution gallery, record gallery coverage, validate and
   cross-check visible VIN candidates, then search exact-VIN and auction sources.
   Ask the seller only for information that remains unresolved.
10. Reject vehicles physically abroad, in transit or awaiting shipment. For a
    vehicle already in Georgia but not customs-cleared, use current official
    Georgian rates to estimate excise, import duty and known administrative fees;
    show both the estimate assumptions and customs-inclusive total price.
11. Deduplicate across platforms by validated VIN first, then canonical listing ID
    and normalized public phone evidence. Never infer dimensions from model name
    or roof appearance alone.
12. Draft the timestamped report from `REPORT-TEMPLATE.md`, then archive sanitized
    append-only structured events for every analyzed listing, including retained,
    rejected and incomplete vehicles. Include enough structured evidence to
    project its listing ID, URL where known, disposition, contact state and source
    evidence. Do not include cookies, session data, user identity or private
    contact details.
13. Run `npm run registry:generate`. This rebuilds the canonical
    `OFFER-REGISTRY.md` projection from all local structured event batches.
14. Run `npm run registry:check`. If a narrative listing is absent, an audit field
    is incomplete, or the generated projection is stale, fix the event batch and
    repeat steps 13–14. Do not deliver the report while this check fails.
15. Deliver the report only after the registry check passes.

## Message approval boundary

This playbook proposes messages but does not send them. A later instruction must
approve the exact original-language text and destination rows. When approved,
execute the messaging playbook once per destination and verify through fresh
history reads.

## Done when

- all relevant conversations have been checked for new replies;
- the report is entirely in English except for verbatim source text and
  original-language seller-message drafts;
- every proposed reply includes its exact English translation and both required
  links side by side;
- affected rankings are explained;
- new candidates are live, deduplicated and evidence-qualified;
- every VIN/history question is preceded by documented full-gallery and
  exact-VIN enrichment, with unresolved facts clearly separated;
- every analyzed listing has an append-only structured event and appears in the
  generated `OFFER-REGISTRY.md` with its audit fields;
- `npm run registry:check` passes after the final report draft;
- the report clearly lists the decisions awaiting the user.
