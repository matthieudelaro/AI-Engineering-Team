# 003 - PDF surgical date edit

**Cadence:** On demand (when a PDF needs a targeted date/text change that must
still look natively produced by the same toolchain).

Edit a PDF in place so a normal reader — and a light forensic check — sees a
plausible original export, not an overlay/redaction patch. Works across different
layouts and producers; the script covers the common JasperReports/iText +
Identity-H path, the playbook covers discovery and QA when the PDF differs.

## Inputs (ask before running)

1. **Source PDF** path (never commit personal PDFs; keep them outside git or in
   ignored `tmp/`).
2. **Keep unchanged** — exact string(s) that must stay byte-identical in content.
3. **Replace** — exact old string → new string (usually a place+date line). Prefer
   same character count when possible.
4. **Pages** — keep all pages, or keep page 1 only (and drop the rest). To be checked with the user.
5. **Info dates** — target `CreationDate` / `ModDate` (`D:YYYYMMDDHHmmss±HH'mm'`).
   Must pass the script’s **business-datetime** check (see below) unless the user
   explicitly waives it.
6. **Office location timezone + country** — IANA tz and ISO country of **where
   the office sits**, not the parent state of a mission. Example: a Carrefour Main Office
   in Georgia → `Asia/Tbilisi` + `GE` (not `Europe/Paris` / `FR`). Required for
   holiday/offset checks.
7. **Output path** — new file; never overwrite the source.

### Business-datetime failing mode (script, ON by default)

`--creation-date` is rejected unless, in `--issuer-location-tz` local time:

- weekday is **Tuesday, Wednesday, or Thursday**
- the day is **not** a public holiday in `--issuer-location-country`
- clock is **10:00–11:59** or **15:00–16:59**
- the PDF UTC offset matches that timezone on that day (e.g. Tbilisi → `+04'00'`)

Waive only with `--allow-non-business-datetime`, and **only when the user
explicitly asks** to skip this check. The playbook must not pass that flag on its
own initiative.

Depends on Python package `holidays` (`pip install holidays`).

## Method (order matters)

### A. Discover (every new document)

1. Open with PyMuPDF (`fitz`): page count, metadata, fonts, content stream count.
2. Locate **every** occurrence of the old date/text (extracted text + raw/CID
   search). Confirm which hits to change and which to keep.
3. Inspect encoding of the target span:
   - **Identity-H / Type0 (e.g. subsetted ArialMT):** text is CID pairs in a `Tj`
     string, not ASCII. Digits often map as `CID = 0x13 + digit`, `/` as `0x12`
     — **verify on that file**, do not assume. Cross-check against ToUnicode /
     `/W` if present.
   - **WinAnsi / simple fonts:** may be literal PDF strings — different patch.
4. **Glyph coverage before editing:** every CID introduced by `--new` must already
   exist as a real outline in the embedded font (not only a `/W` or ToUnicode
   entry). Prefer proving the digit already appears elsewhere in the page text,
   or inspecting `loca`/`glyf` lengths. Missing outlines → blank/notdef glyphs.
5. Note Flate headers on sibling streams. iText 2.1.x content streams typically
   use zlib default level 6 (`78 9c`). **Baseline the original:** confirm
   `raw == zlib.compress(decoded, 6)` bit-exactly on the source content stream
   before editing. If it matches, a level-6 rewrite leaves no compressor
   fingerprint; if it does not, probe parameters instead of assuming.
6. Record `/ID`, `/Creator`, `/Producer`, catalog quirks (`ViewerPreferences`,
   `/ITXT`, resource names like `/img0`, `/F1`). Note whether `/Metadata` (XMP)
   exists — if yes, Info dates alone are not enough.
7. **Calendar / story plausibility (before touching bytes):** pick a
   `--creation-date` that will pass the script’s business-datetime check (Tue–Thu,
   non-holiday in `--issuer-location-country`, 10:00–11:59 or 15:00–16:59 in
   `--issuer-location-tz`). Also check consistency with every date the brief says
   to *keep*.

### B. Edit (prefer surgical, avoid MuPDF rewrite)

**Default path (same page count, Identity-H date line):** run the helper script:

```bash
./scripts/pdf-surgical-date-edit.py \
  --src /path/to/source.pdf \
  --dst /path/to/output.pdf \
  --old "A Example, le 01/01/2020" \
  --new "A Example, le 02/02/2021" \
  --keep "Some other line with 01/01/2020 that must stay" \
  --creation-date "D:20210202103412+04'00'" \
  --issuer-location-tz Asia/Tbilisi \
  --issuer-location-country GE
```

(Only if the user explicitly waived business hours / weekday / holiday rules,
add `--allow-non-business-datetime`.)

What the script does:

- Copies the file and patches **only** the chosen CID (or literal) occurrence(s).
- Recompresses the touched Flate stream at **zlib level 6** (`789c`).
- Updates `/Length` and shifts xref / `startxref` when compressed size changes.
- Sets `/CreationDate` and `/ModDate` (same length as the originals when
  possible).
- Regenerates **both** trailer `/ID` values.
- Leaves `/Creator` and `/Producer` untouched.

**If the PDF is different** (other font encoding, multiple content streams,
encrypted, object streams, incremental updates): stop the script, extend
discovery, and patch with the same principles — or regenerate from source
software if surgical edit is impossible.

**If dropping pages:** do not use a full MuPDF `select()` rewrite as the primary
path (it adds overlay-style artifacts and tooling fingerprints). Prefer:

1. Surgical content edit on a copy of the full file first, then
2. A careful page-tree trim that preserves the edited page’s content stream
   bytes, **or**
3. A known-good rebuild that still keeps single content stream, original font
   for the edited line, no white-rectangle overlays, no `/helv` date redraw.

Hard rules (any path):

- **No** white rectangle + text overlay.
- **No** changing the date line’s font (keep the original face, e.g. ArialMT).
- **No** leftover `MuPDF` / `Written by MuPDF` / `pikepdf` / `qpdf` strings.
- **No** multi-stream redaction sandwich for the date.
- Touch **only** the intended occurrence(s); verify keep-strings still present.
- Prefer decompressed content differing from the source page by as few bytes as
  possible (ideally only the changed glyphs).

### C. Self-check before QA

- Extracted text: new string present, old target absent, keep-strings present.
- Span font + bbox for the edited line match the original (digit-advance fonts
  often keep an identical bbox).
- Single content stream on the edited page (unless the original already had
  several).
- Metadata Creator/Producer unchanged; dates and `/ID` updated. If XMP
  `/Metadata` exists, its Create/Modify dates must match Info.
- Flate on the edited stream: header `789c` **and**
  `raw == zlib.compress(decoded, 6)` when the original baselined that way.
- Binary header still looks like the source family (e.g. `%PDF-1.4` + high-bit
  comment), not a MuPDF banner.
- **Anti-overlay (operators, not strings):** decompressed stream `re` / fill
  counts unchanged vs original. Do **not** treat “Helvetica present” as a defect
  if the original already used `/F2` — compare usage counts instead.
- **Object isolation:** only the touched content stream and Info dict differ;
  other objects byte-identical aside from a constant xref offset shift. Each xref
  entry resolves to the matching `N 0 obj` header; `/Length` matches real stream
  bytes; `FontFile2` `/Length1` (if present) still equals decompressed font length.
- Optional but strong: render original vs edit at ~200 dpi; differing pixels’
  bbox must fall inside the edited span only.

## QA loop (mandatory)

Run as the **QA** role. Up to 3 rounds; escalate if still failing.

### Round 1

Spawn QA with the brief (keep / replace / dates / IDs / anti-redaction checks).
Require **PASS** or a numbered defect list with severity.

LLM Model to use:  Composer (if running in Cursor) (or default QA model)

### Round 2 — second LLM (after Round 1 PASS)

Re-audit with a **different** model : prefer latest Claude available, otherwise Grok (if running in Cursor). Independent, ruthless, read-only.

### FAIL criteria (examples)

- Keep-string was altered.
- Wrong replacement string or year.
- White-box / added Helvetica-on-date overlay / multi-stream patch / MuPDF
  fingerprints (Helvetica elsewhere that already existed in the source is OK).
- Font or bbox of the edited line drifted without justification.
- Flate level on the edited stream disagrees with sibling iText streams
  (`78da` vs `789c`), or fails `zlib.compress(dec, 6)` bit-match when the
  original baselined that way.
- `/ID[0]` still equal to the source document’s `/ID[0]` when a fresh document
  was requested.

### Residual risks ≠ defects

QA may note risks that are **out of brief** (e.g. “with the original in hand, a
binary diff still shows a 2-byte content patch”). Document them; do not FAIL
solely for that if the brief asked for surgical edit rather than full
regeneration. Calendar/story inconsistency caused by an explicit keep-string is
also out of brief unless the user asked for narrative coherence.

### Hygiene

- Keep personal PDFs out of git (e.g. ignored `tmp/`).
- Offer to delete rejected intermediate outputs once a version is accepted.
- Remember filesystem mtimes travel with the file if sent as an attachment.

## Done when

- Output PDF exists; source untouched.
- Self-check passed.
- QA Round 1 **PASS** and Round 2 **PASS** (or user accepted escalation).
- No personal source filenames or PII committed to the repo.
