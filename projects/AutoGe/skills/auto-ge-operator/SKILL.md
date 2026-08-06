---
name: auto-ge-operator
description: Operate the Auto.ge vehicle-finding workflow by reviewing message history, translating seller replies, updating evidence and rankings, drafting seller-language replies with English translations, producing English action reports, and sourcing new live listings. Use for recurring Auto.ge inbox reviews, shortlist refreshes, seller follow-up proposals, and market scans; outbound sending remains separately approval-gated.
---

# Auto.ge Operator

Work from the AutoGe project directory. Read `PROJECT-BRIEF.md`, `CRITERIA.md`,
the latest shortlist and `playbooks/002-daily-review-and-sourcing.md` before the
run. Use `REPORT-TEMPLATE.md` as the output contract.

## Operating cycle

1. Review Auto.ge conversations read-only using the `auto-ge-messaging` skill.
2. Detect new inbound messages against archived observations.
3. Preserve the seller's original language and translate it into English.
4. Extract evidence, contradictions and missing facts without conflating seller
   claims with verification.
5. Recompute affected evaluations and explain every ranking change.
6. Detect the seller's language and draft only the next useful reply in that
   language (normally Georgian). Place the original-language draft, exact English
   translation, listing link and discussion link in adjacent table columns.
7. Source and verify active Auto.ge listings that improve coverage of the user's
   vehicle strategies.
8. Archive append-only structured events for every analyzed listing, including
   retained, rejected and incomplete offers. A listing must never exist only in a
   narrative report.
9. Run `npm run registry:generate` to rebuild `OFFER-REGISTRY.md` from all local
   structured event batches.
10. Run `npm run registry:check`. Resolve every missing narrative listing, missing
    audit field or stale projection before proceeding.
11. Only after the registry check passes, deliver the report and request explicit
    decisions.

## Reporting requirements

- Timestamp the report in `Asia/Tbilisi`.
- Write the entire report in English, except for verbatim source text and seller
  message drafts in their original language.
- Use clickable direct links, never search-result links.
- Show one proposed message per row with status `Awaiting approval`.
- Put the original-language draft and English translation side by side; preserve
  meaning exactly.
- Include both the listing and `my-messages.html?id=...` discussion links.
- Separate retained, rejected and incomplete vehicles.
- Explain confidence and critical unknowns.
- State explicitly whether any message was sent during the run.

## Sourcing rules

Check each listing live and deduplicate by numeric listing ID. Prioritize functional
fit: sleeping length, standing height, Georgian-road capability, reliability,
parts availability, total cost and resale liquidity. Never infer an unreported
dimension, VIN history or mechanical condition. Archive useful raw artifacts under
ignored `data/` and sanitized structured observations as append-only events.

`OFFER-REGISTRY.md` is the canonical human-readable projection of every analyzed
offer. The append-only events remain the evidence source; do not edit registry
rows by hand. Every analyzed offer must project a listing ID, URL where known,
disposition, contact state and source evidence into the registry before report
delivery.

Treat publicly displayed seller phone numbers as a default discovery field. Every
new listing observation must state whether phone collection was `observed`,
`not_available`, or `not_checked` and include an array even when it is empty.
Preserve exact display text, deduplicate by digits, and infer Georgian `+995` E.164
only for an unambiguous mobile pattern. Actual seller phone values belong only in
the append-only event/projection store or ignored artifacts; never copy them into
Git-tracked reports, docs, fixtures, logs, prompts, or Google Sheets.

Reject a listing when the vehicle is physically abroad, in transit, or awaiting
shipment. For a vehicle already in Georgia but not customs-cleared, calculate a
current customs estimate before ranking it and report the advertised price,
estimated clearance cost, assumptions and customs-inclusive total. Verify current
rates against the Georgian Revenue Service calculator or current Tax Code; do not
reuse a stale rate table.

## Approval and authentication

Inbox review, reporting and sourcing are read-only. Do not send drafts. Require a
later user instruction approving the exact original-language text and destination,
then use the messaging skill. Keep sessions in Chrome and never inspect or persist
secrets. Pause on login expiry or CAPTCHA.
