# 003 — VIN and accident-history enrichment

**Trigger:** Before asking a seller for a VIN, and whenever candidate media may
identify the vehicle or reveal its pre-repair condition.

**Purpose:** Exhaust listing evidence and lawful free sources before contacting a
seller or buying a paid report. The useful question is not merely whether a car
was damaged, but what its pre-repair condition was, which risks remain, what
evidence can resolve them, and whether the current price compensates for them.

## Required sequence

1. Extract listing text and structured fields: identity, variant, odometer, price,
   location, customs status and seller claims.
2. Enumerate and inspect **every original-resolution gallery image**, not only the
   hero image or thumbnails. Preserve original URLs or content-addressed artifacts
   under ignored `data/` storage. Record gallery coverage as complete, partial or
   unavailable.
3. Search structured HTML, description, images and photographed documents for a
   VIN. Useful locations include the lower windshield, door-jamb/manufacturer
   labels, diagnostic or infotainment vehicle-information screens, auction
   stickers and titles/registration documents.
4. Treat OCR or visual readings as candidate observations. A VIN candidate must
   contain exactly 17 characters and exclude `I`, `O` and `Q`. Compare repeated
   appearances character by character.
5. Validate the candidate against decoded manufacturer, model family and model
   year. Use NHTSA vPIC for a first-pass identity decode where applicable, while
   keeping empty fields unknown. A material mismatch requires human review or
   rejection.
6. Deduplicate by validated VIN as well as marketplace ID and normalized phone.
7. Only if no valid VIN remains after the full text-and-gallery pass may a seller
   draft request it. Say the media was checked and ask only for missing or
   ambiguous evidence. Never reflexively request an already visible validated VIN.

## In-vehicle evidence

Capture facts visible on dashboards or vehicle-information screens, including
odometer, variant, drivetrain, software/hardware, warnings and enabled packages.
Store direct observations separately from interpretations. For example, `Full
Self-Driving Computer 3` supports an HW3 interpretation, but displayed Autosteer
does not by itself prove purchased, active or transferable Full Self-Driving
Capability.

## Exact-VIN and auction research

Search the VIN in quotes, then focused variants such as:

- `"VIN" auction`, `"VIN" IAAI`, `"VIN" Copart`
- `"VIN" salvage`, `"VIN" accident`, `"VIN" damage`, `"VIN" photos`

When a lot number is found, search it alone and with the VIN, make and model.
Prefer auction houses and official title sources over aggregators. Several sites
copying one auction record are one provenance chain, not independent confirmation.

Try to establish auction house, lot, date, location, seller/insurer, primary and
secondary damage, title status, odometer, sale price and historic photos. Keep
unavailable fields unknown.

## Historic/current photo comparison

Compare pre-repair auction photos with current media for replaced panels and
glass, paint mismatch, panel gaps, missing components, visible welds/cuts/pulls,
suspension mounting damage, airbag deployment, underbody damage and—on EVs—the
high-voltage battery enclosure. Visual analysis cannot prove that repaired
structure is dimensionally correct; state the implication and required test.

Classify original damage provisionally:

- **A — Cosmetic:** paint, bumper cover or minor bolt-on trim.
- **B — Body:** door, fender, hood, hatch or replaceable body panel.
- **C — Potential structural involvement:** apron, crossmember, floor or mounting
  points may be affected.
- **D — Heavy structural/safety involvement:** rail, pillar, passenger cell, torn
  suspension, high-voltage battery enclosure or extensive restraints.

Class C or D requires human review and a model-specific inspection plan. Do not
downgrade damage merely because the current exterior looks repaired.

For accident-repaired EVs include battery enclosure and health, underbody,
suspension/alignment, high-voltage wiring, pyrofuse, airbags/pretensioners, ADAS
calibration, AC/DC charging and diagnostic faults. For combustion vehicles use
the relevant engine, transmission, cooling, emissions and fuel-system checks.

Explain title terms precisely: `clean` does not mean never damaged; `salvage`
indicates total-loss or statutory damage status; `rebuilt/reconstructed` indicates
a repaired former salvage vehicle returned to road use under local rules.

## Free before paid

Use exact-VIN web results, official auction pages and lawful archives first. Do
not purchase CARFAX, AutoCheck, ClearVin or another report by default. Recommend a
specific paid report only after documenting which unresolved questions it is
likely to answer and why free evidence is insufficient.

## Reporting contract

Separate findings into **Certain**, **Probable**, and **Not determinable
remotely**. End with an actionable pre-purchase checklist. Structural-risk cars
normally require a lift inspection, body/chassis measurement, four-wheel
alignment, diagnostic scan, non-factory weld search, restraint-system and
water-leak checks, and a road test. EVs also require battery, charging and ADAS
checks.

Archive observation, interpretation and disposition as separate append-only
events. Seller drafts must omit questions already answered by adequate evidence.

## Done when

- gallery inspection coverage and VIN-candidate provenance are explicit;
- validated identity is compared with listing claims and deduplicated;
- exact-VIN/auction enrichment was attempted or explicitly blocked;
- historic/current comparison and damage class are recorded when available;
- certainty tiers and physical checks are explicit;
- no redundant seller question or unapproved paid report remains.
