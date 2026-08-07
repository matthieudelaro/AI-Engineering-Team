# Autopapa daily review and sourcing — 2026-08-06 21:30 Asia/Tbilisi

No seller was contacted and no message was sent during this run.

## Executive summary

- The signed-in Autopapa session was available. Its visible authenticated navigation exposed profile and seller-ad management, but no buyer conversation inbox, so there was no message history to review.
- Three live, customs-cleared candidates were retained: a full-size Mercedes-Benz Sprinter and two road minivans.
- Autopapa showed 21 Ford Transit, 166 Toyota Sienna and 9 Nissan Quest listings. The targeted Volkswagen Crafter and Mitsubishi Delica searches returned no live offers.
- Public seller phones for the three retained listings were checked against the existing Auto.ge SQLite journal. No normalized-phone match was found. This reduces immediate duplicate-contact risk but does not prove the vehicles are distinct because full VINs were not visible.

## Newly sourced vehicles

| Provisional rank | Vehicle                     | Advertised price | Customs | Why it may fit                                                                                          | Primary risks                                                                                                                          | Evidence confidence                                         | Listing                                                                 |
| ---------------: | --------------------------- | ---------------: | ------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
|                1 | Mercedes-Benz Sprinter 2019 |       67,500 GEL | Cleared | Two-seat XL minibus, automatic 3.0 diesel and RWD; the strongest new full-size sleeping/cargo candidate | Zugdidi rather than Tbilisi; no full VIN, measured cargo length, finished height, history, service evidence or inspection confirmation | Medium for listing facts; low for suitability and condition | [Autopapa 950124](https://autopapa.ge/en/mercedes-benz/sprinter/950124) |
|                2 | Toyota Sienna 2016          |       35,100 GEL | Cleared | Best new value road minivan; in Rustavi, 6–8 seats, left-hand drive, 3.5 petrol and masked VIN evidence | FWD; full VIN, measured sleeping length, auction/accident history and maintenance evidence remain missing                              | Medium                                                      | [Autopapa 877100](https://autopapa.ge/en/toyota/sienna/877100)          |
|                3 | Nissan Quest 2013           |       24,300 GEL | Cleared | Low-cost road minivan in Rustavi with masked VIN evidence                                               | LPI system provenance/condition and CVT history are major risks; only 4–5 seats are stated; sleeping geometry and history unknown      | Medium-low                                                  | [Autopapa 904451](https://autopapa.ge/en/nissan/quest/904451)           |

These vehicles remain incomplete rather than qualified. None has verified usable sleeping length of at least 2,000 mm, and the Sprinter does not have verified finished interior height.

## Market coverage and rejected search paths

| Target                 |                              Live result | Treatment                                                                                                                         |
| ---------------------- | ---------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| Mercedes-Benz Sprinter | At least one directly verified candidate | Retained listing 950124                                                                                                           |
| Ford Transit           |                                       21 | Results were dominated by trucks and customs-uncleared minibuses; no listing was retained over the stronger Sprinter in this pass |
| Volkswagen Crafter     |                                        0 | No live candidate                                                                                                                 |
| Mitsubishi Delica      |                                        0 | No live candidate                                                                                                                 |
| Toyota Sienna          |                                      166 | Retained the best-value directly verified customs-cleared example                                                                 |
| Nissan Quest           |                                        9 | Retained one customs-cleared example with masked VIN evidence                                                                     |

## Cross-platform deduplication

The three retained listings' normalized public seller phones were compared with all contact data already stored in `data/autoge.sqlite`. No Auto.ge phone match was found. Actual phone values remain only in the ignored append-only event batch and SQLite store; they are intentionally omitted from this Git-tracked report.

Full-VIN matching was not possible because Autopapa displayed masked VINs for the Sienna and Quest and no VIN for the Sprinter. A future contact proposal must therefore re-run phone and VIN deduplication immediately before any approved message or call.

## Decisions requested from the user

- Decide whether the next contact-drafting pass should prioritize the Sprinter, the Sienna, or both.
- No exact seller-language message has been drafted in this report, so there is currently nothing awaiting send approval.

## Audit notes

- Retrieval time: 2026-08-06 21:18–21:30 Asia/Tbilisi.
- Autopapa listing IDs added: 950124, 877100, 904451.
- Sanitized event batch: `data/research/autopapa-daily-review-2026-08-06-2130.json`.
- Consolidated structured source of truth: append-only `data/autoge.sqlite`, keyed by marketplace-qualified subject IDs such as `autopapa.ge:950124` and `auto.ge:1625913`.
- Supabase was inspected earlier in this task and had no tables in `public`; repository grants keep external connectors read-only, so no Supabase mutation was performed.
- No messages sent during this report run: yes.
