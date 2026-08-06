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
   year, mileage, customs status, drivetrain, location and critical unknowns.
9. Deduplicate by canonical listing ID. Never infer dimensions from model name or
   roof appearance alone.
10. Produce a timestamped report from `REPORT-TEMPLATE.md` and archive sanitized
    events locally. Do not include cookies, session data, user identity or private
    contact details.

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
- the report clearly lists the decisions awaiting the user.
