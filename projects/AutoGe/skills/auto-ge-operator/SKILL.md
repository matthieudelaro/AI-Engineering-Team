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
8. Deliver the report and request explicit decisions.

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

## Approval and authentication

Inbox review, reporting and sourcing are read-only. Do not send drafts. Require a
later user instruction approving the exact original-language text and destination,
then use the messaging skill. Keep sessions in Chrome and never inspect or persist
secrets. Pause on login expiry or CAPTCHA.
