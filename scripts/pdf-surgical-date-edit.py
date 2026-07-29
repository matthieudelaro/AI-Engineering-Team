#!/usr/bin/env python3
"""Surgical PDF text/date edit that preserves native tooling fingerprints.

Designed for Identity-H (Type0) subset fonts where digits are CID-encoded, as
commonly emitted by JasperReports + iText. Falls back to literal PDF-string
replacement when the old/new texts appear as plain bytes in the stream.

Does NOT:
  - overwrite the source file
  - use MuPDF page rewrite / redaction overlays
  - change Creator/Producer

Usage:
  ./scripts/pdf-surgical-date-edit.py \\
    --src in.pdf --dst out.pdf \\
    --old 'A Example, le 01/01/2020' \\
    --new 'A Example, le 02/02/2021' \\
    --keep 'Other line containing 01/01/2020' \\
    --creation-date \"D:20210202103412+02'00'\" \\
    --issuer-location-tz Asia/Tbilisi --issuer-location-country GE

Business-datetime check (ON by default): CreationDate must be Tue–Thu,
not a public holiday in --issuer-location-country, at 10:00–11:59 or 15:00–16:59 in
--issuer-location-tz, with a PDF offset matching that zone. Waive only with
--allow-non-business-datetime when the user explicitly asks.
"""

from __future__ import annotations

import argparse
import re
import secrets
import sys
import zlib
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


# Observed on several JasperReports / ArialMT Identity-H exports. Always
# verified against the file before patching; override with --digit-base if needed.
DEFAULT_DIGIT_BASE = 0x13
DEFAULT_SLASH_CID = 0x12

# Plausible issuing-office wall clock (local to --issuer-location-tz).
BUSINESS_WEEKDAYS = {1, 2, 3}  # Tue, Wed, Thu (Monday=0)
MORNING = (time(10, 0, 0), time(11, 59, 59))
AFTERNOON = (time(15, 0, 0), time(16, 59, 59))

PDF_DATE_RE = re.compile(
    r"^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})"
    r"(?:([Zz])|([+\-])(\d{2})'?(\d{2})'?)?$"
)


def parse_pdf_date(s: str) -> tuple[datetime, timedelta | None]:
    """Parse a PDF date string into a naive local datetime + optional UTC offset."""
    m = PDF_DATE_RE.match(s.strip())
    if not m:
        raise ValueError(f"invalid PDF date: {s!r}")
    y, mo, d, h, mi, se = (int(m.group(i)) for i in range(1, 7))
    local = datetime(y, mo, d, h, mi, se)
    if m.group(7):  # Z
        return local, timedelta(0)
    if m.group(8):
        sign = 1 if m.group(8) == "+" else -1
        off = timedelta(hours=int(m.group(9)), minutes=int(m.group(10)))
        return local, sign * off
    return local, None


def _in_business_hours(t: time) -> bool:
    return (MORNING[0] <= t <= MORNING[1]) or (AFTERNOON[0] <= t <= AFTERNOON[1])


def validate_business_datetime(
    creation_date: str,
    issuer_location_tz: str,
    issuer_location_country: str,
) -> None:
    """Fail hard unless CreationDate is a plausible issuer-office timestamp.

    Rules (local wall clock in --issuer-location-tz):
      - Tuesday–Thursday only
      - not a public holiday in --issuer-location-country (ISO 3166-1 alpha-2)
      - time in 10:00–11:59 or 15:00–16:59
      - PDF offset (if present) must match the issuer timezone offset that day
    """
    try:
        from holidays import country_holidays
    except ImportError as e:
        raise SystemExit(
            "business-datetime check requires the 'holidays' package "
            "(pip install holidays). Or pass --allow-non-business-datetime "
            "only if the user explicitly waived the check."
        ) from e

    try:
        tz = ZoneInfo(issuer_location_tz)
    except Exception as e:
        raise SystemExit(f"invalid --issuer-location-tz {issuer_location_tz!r}: {e}") from e

    try:
        local_naive, pdf_offset = parse_pdf_date(creation_date)
    except ValueError as e:
        raise SystemExit(str(e)) from e

    # Interpret the PDF timestamp as wall clock in the issuer timezone.
    local = local_naive.replace(tzinfo=tz)
    reasons: list[str] = []

    if local.weekday() not in BUSINESS_WEEKDAYS:
        reasons.append(
            f"weekday is {local.strftime('%A')} (need Tuesday–Thursday) "
            f"in {issuer_location_tz}"
        )

    try:
        hol = country_holidays(issuer_location_country.upper())
    except Exception as e:
        raise SystemExit(
            f"invalid --issuer-location-country {issuer_location_country!r}: {e}"
        ) from e
    day: date = local.date()
    if day in hol:
        reasons.append(
            f"{day.isoformat()} is a public holiday in {issuer_location_country.upper()} "
            f"({hol.get(day)})"
        )

    if not _in_business_hours(local.time()):
        reasons.append(
            f"time {local.strftime('%H:%M:%S')} not in business hours "
            f"10:00–11:59 or 15:00–16:59 ({issuer_location_tz})"
        )

    # Offset in the PDF date must agree with issuer TZ at that local instant.
    expected_offset = local.utcoffset()
    if expected_offset is None:
        reasons.append(f"could not resolve UTC offset for {issuer_location_tz}")
    elif pdf_offset is None:
        reasons.append(
            "PDF date has no UTC offset; required so it can match --issuer-location-tz"
        )
    elif pdf_offset != expected_offset:
        def fmt(td: timedelta) -> str:
            total = int(td.total_seconds())
            sign = "+" if total >= 0 else "-"
            total = abs(total)
            return f"{sign}{total // 3600:02d}'{(total % 3600) // 60:02d}'"

        reasons.append(
            f"PDF offset {fmt(pdf_offset)} does not match {issuer_location_tz} "
            f"offset {fmt(expected_offset)} on {day.isoformat()}"
        )

    if reasons:
        joined = "\n  - ".join(reasons)
        raise SystemExit(
            "FAIL business-datetime check for --creation-date "
            f"{creation_date!r}:\n  - {joined}\n"
            "Pick a Tue–Thu non-holiday at 10:00–11:59 or 15:00–16:59 in "
            f"{issuer_location_tz}, with a matching PDF offset. "
            "To waive (only if the user explicitly asked): "
            "--allow-non-business-datetime"
        )


def encode_identity_h_ascii(text: str, digit_base: int, slash_cid: int) -> bytes:
    """Encode a narrow ASCII subset as big-endian CIDs (digits, slash, and
    letters/punctuation only if the caller already knows the CID map).

    For full arbitrary text, pass --old-cids / use discovery; this helper encodes
    *date fragments* (digits + '/') which are stable across the exports we saw.
    """
    out = bytearray()
    for ch in text:
        if ch == "/":
            cid = slash_cid
        elif ch.isdigit():
            cid = digit_base + int(ch)
        else:
            raise ValueError(
                f"cannot auto-encode {ch!r}; use a full-line CID patch via discovery"
            )
        out += cid.to_bytes(2, "big")
    return bytes(out)


def find_content_streams(data: bytes) -> list[tuple[int, int, int, bytes, int, int]]:
    """Return list of (obj_num, dict_start, stream_data_start, marker, length, stream_end).

    Matches iText-style:
      N 0 obj\\n<</Filter/FlateDecode/Length L>>stream\\n...\\nendstream
    and Length/Filter swapped order.
    """
    found = []
    patterns = [
        re.compile(
            rb"(\d+) 0 obj\n<<(/Filter/FlateDecode/Length (\d+)|/Length (\d+)/Filter/FlateDecode)>>stream\n"
        ),
    ]
    for pat in patterns:
        for m in pat.finditer(data):
            obj_num = int(m.group(1))
            length = int(m.group(3) or m.group(4))
            data_start = m.end()
            end = data.find(b"\nendstream", data_start)
            if end < 0:
                continue
            body = data[data_start:end]
            if len(body) != length:
                continue
            found.append((obj_num, m.start(), data_start, m.group(0), length, end))
    return found


def try_decompress(body: bytes) -> bytes | None:
    try:
        return zlib.decompress(body)
    except zlib.error:
        return None


def patch_decoded(
    decoded: bytes,
    old: str,
    new: str,
    keep: list[str],
    digit_base: int,
    slash_cid: int,
) -> bytes:
    if len(old) != len(new):
        # Still allow if only CID date tails differ in lengthless way — require equal
        # for surgical same-length stream edits.
        pass

    # Strategy 1: literal UTF-8 / Latin-1 occurrence of the full old string
    old_b = old.encode("latin-1")
    new_b = new.encode("latin-1")
    if old_b in decoded:
        if len(old_b) != len(new_b):
            raise SystemExit(
                f"literal patch length mismatch: {len(old_b)} vs {len(new_b)}"
            )
        count = decoded.count(old_b)
        if count != 1:
            raise SystemExit(
                f"literal old string occurs {count} times; refine --old or pre-split"
            )
        out = decoded.replace(old_b, new_b, 1)
        for k in keep:
            kb = k.encode("latin-1")
            if kb not in out:
                raise SystemExit(f"keep-string missing after literal patch: {k!r}")
        return out

    # Strategy 2: Identity-H — replace DD/MM/YYYY CIDs when --old/--new share a
    # common textual prefix and only the trailing date differs.
    date_re = re.compile(r"(\d{2}/\d{2}/\d{4})(?=\.|$)")
    mo, mn = date_re.search(old), date_re.search(new)
    if mo and mn and old[: mo.start()] == new[: mn.start()]:
        old_date = encode_identity_h_ascii(mo.group(1), digit_base, slash_cid)
        new_date = encode_identity_h_ascii(mn.group(1), digit_base, slash_cid)
        if decoded.count(old_date) == 0:
            raise SystemExit("Identity-H date CIDs for --old not found in stream")

        # Dates that appear in --keep must not be patched. If a keep-string ends
        # with that date followed by '.', the CID run is date + period (0x11).
        protected = set()
        period = (0x11).to_bytes(2, "big")
        for k in keep:
            for mk in date_re.finditer(k):
                kd = encode_identity_h_ascii(mk.group(1), digit_base, slash_cid)
                if k.endswith(".") and mk.group(1) == k[mk.start() : mk.end()] and k[
                    mk.end() :
                ].startswith("."):
                    protected.add(("tail", kd + period))
                protected.add(("date", kd))

        # Prefer matching the full --old line as CIDs when we can derive a unique
        # context: require old_date NOT followed by period if --keep uses date+'.'
        offsets = []
        start = 0
        while True:
            i = decoded.find(old_date, start)
            if i < 0:
                break
            skip = False
            nxt = decoded[i + len(old_date) : i + len(old_date) + 2]
            for kind, blob in protected:
                if kind == "tail" and decoded[i : i + len(blob)] == blob:
                    skip = True
                    break
            # If any keep ends with old_date+'.', skip date runs followed by period
            if not skip and any(
                k.rstrip().endswith(mo.group(1) + ".") or k.endswith(mo.group(1) + ".")
                for k in keep
            ):
                if nxt == period:
                    skip = True
            if not skip:
                offsets.append(i)
            start = i + 1

        if len(offsets) != 1:
            raise SystemExit(
                f"Identity-H: expected exactly 1 replaceable date CID run, found {len(offsets)}. "
                "Make --old more specific or adjust --keep."
            )
        i = offsets[0]
        out = decoded[:i] + new_date + decoded[i + len(old_date) :]
        for k in keep:
            mk = date_re.search(k)
            if mk and (k.endswith(mk.group(1) + ".") or k.rstrip().endswith(mk.group(1) + ".")):
                tail = encode_identity_h_ascii(mk.group(1), digit_base, slash_cid) + period
                if tail not in out:
                    raise SystemExit(f"keep date+period CIDs missing after patch: {k!r}")
        return out

    raise SystemExit(
        "Could not locate --old in any Flate content stream as literal or "
        "Identity-H date CIDs. Run discovery (playbook 003) for this PDF."
    )


def update_xref_and_startxref(data: bytearray, threshold: int, delta: int) -> bytearray:
    if delta == 0:
        return data
    xref_m = re.search(rb"xref\n(\d+) (\d+)\n", data)
    if not xref_m:
        raise SystemExit("no classic xref table found (object streams unsupported)")
    count = int(xref_m.group(2))
    entries_start = xref_m.end()
    new_entries = bytearray()
    for i in range(count):
        ent = bytes(data[entries_start + i * 20 : entries_start + (i + 1) * 20])
        if len(ent) < 20:
            raise SystemExit("truncated xref entry")
        if ent[17:18] == b"f":
            new_entries += ent
            continue
        off = int(ent[:10])
        if off >= threshold:
            off2 = off + delta
            new_entries += f"{off2:010d}".encode() + ent[10:]
        else:
            new_entries += ent
    data[entries_start : entries_start + count * 20] = new_entries

    sx = re.search(rb"startxref\n(\d+)\n", data)
    if not sx:
        raise SystemExit("startxref not found")
    xref_pos = data.find(b"xref\n")
    new_sx = str(xref_pos).encode()
    data = bytearray(data[: sx.start(1)] + new_sx + data[sx.end(1) :])
    return data


def patch_info_dates(data: bytearray, creation_date: str) -> bytearray:
    """Replace existing D:... CreationDate/ModDate values with creation_date.

    Requires the new date string to be the same length as each occurrence found.
    """
    new_b = creation_date.encode("ascii")
    dates = re.findall(rb"D:\d{14}[^\)]*", data)
    # Prefer Info dict style (D:YYYYMMDDHHmmss+HH'mm')
    info_dates = [d for d in dates if d.startswith(b"D:") and len(d) == len(new_b)]
    if len(info_dates) < 2:
        # try exact common pattern length
        pass
    # Replace unique ModDate/CreationDate values that look like PDF dates
    pattern = re.compile(rb"(D:\d{14}(?:[+\-]\d{2}'\d{2}'|Z)?)")
    matches = list(pattern.finditer(data))
    # Usually CreationDate and ModDate share the same value in these exports
    values = {m.group(1) for m in matches}
    if not values:
        raise SystemExit("no PDF date strings found to replace")
    for old in values:
        if len(old) != len(new_b):
            raise SystemExit(
                f"date length mismatch: existing {old!r} ({len(old)}) vs "
                f"{new_b!r} ({len(new_b)}). Pick a same-length D: string."
            )
        data = bytearray(data.replace(old, new_b))
    return data


def patch_ids(data: bytearray) -> bytearray:
    m = re.search(rb"/ID \[<([0-9A-Fa-f]{32})><([0-9A-Fa-f]{32})>\]", data)
    if not m:
        raise SystemExit("trailer /ID hex pair not found")
    new_block = (
        b"/ID [<"
        + secrets.token_hex(16).encode()
        + b"><"
        + secrets.token_hex(16).encode()
        + b">]"
    )
    if len(new_block) != len(m.group(0)):
        raise SystemExit("internal /ID length error")
    data[m.start() : m.end()] = new_block
    return data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--dst", type=Path, required=True)
    ap.add_argument("--old", required=True, help="Exact text line/string to replace")
    ap.add_argument("--new", required=True, help="Replacement text (prefer same length)")
    ap.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Exact string that must remain (repeatable)",
    )
    ap.add_argument(
        "--creation-date",
        required=True,
        help=r"PDF date, e.g. D:20210202103412+02'00' (same length as source dates)",
    )
    ap.add_argument(
        "--issuer-location-tz",
        default=None,
        help="IANA timezone of the office location (required unless "
        "--allow-non-business-datetime), e.g. Asia/Tbilisi",
    )
    ap.add_argument(
        "--issuer-location-country",
        default=None,
        help="ISO 3166-1 alpha-2 country of the office location for public holidays (not the parent state of a foreign mission; required unless "
        "--allow-non-business-datetime), e.g. GE",
    )
    ap.add_argument(
        "--allow-non-business-datetime",
        action="store_true",
        help="Skip the business-datetime failing check. Use ONLY when the user "
        "explicitly waived Tue–Thu / business-hours / holiday constraints.",
    )
    ap.add_argument("--digit-base", type=lambda s: int(s, 0), default=DEFAULT_DIGIT_BASE)
    ap.add_argument("--slash-cid", type=lambda s: int(s, 0), default=DEFAULT_SLASH_CID)
    ap.add_argument(
        "--stream-obj",
        type=int,
        default=None,
        help="Force Flate object number to patch (default: auto-detect)",
    )
    args = ap.parse_args()

    if args.src.resolve() == args.dst.resolve():
        print("refusing to overwrite --src", file=sys.stderr)
        return 2
    if not args.src.is_file():
        print(f"missing source: {args.src}", file=sys.stderr)
        return 2

    if args.allow_non_business_datetime:
        print(
            "WARNING: --allow-non-business-datetime set; skipping issuer "
            "business-hours / weekday / holiday check",
            file=sys.stderr,
        )
    else:
        if not args.issuer_location_tz or not args.issuer_location_country:
            print(
                "business-datetime check is ON by default. Pass --issuer-location-tz and "
                "--issuer-location-country (e.g. --issuer-location-tz Asia/Tbilisi --issuer-location-country GE), "
                "or --allow-non-business-datetime only if the user explicitly waived it.",
                file=sys.stderr,
            )
            return 2
        try:
            validate_business_datetime(
                args.creation_date, args.issuer_location_tz, args.issuer_location_country
            )
        except SystemExit as e:
            print(e, file=sys.stderr)
            return 2
        print(
            f"business-datetime OK for {args.creation_date} "
            f"({args.issuer_location_tz}, {args.issuer_location_country.upper()})"
        )

    data = bytearray(args.src.read_bytes())
    streams = find_content_streams(data)
    if not streams:
        print("no Flate content streams matched", file=sys.stderr)
        return 2

    patched = False
    errors: list[str] = []
    for obj_num, _dict_start, data_start, marker, length, stream_end in streams:
        if args.stream_obj is not None and obj_num != args.stream_obj:
            continue
        body = bytes(data[data_start:stream_end])
        decoded = try_decompress(body)
        if decoded is None:
            continue
        try:
            new_decoded = patch_decoded(
                decoded,
                args.old,
                args.new,
                args.keep,
                args.digit_base,
                args.slash_cid,
            )
        except SystemExit as e:
            errors.append(f"obj {obj_num}: {e}")
            continue

        if new_decoded == decoded:
            continue

        new_comp = zlib.compress(new_decoded, 6)
        if new_comp[:2] != b"\x78\x9c":
            print(
                f"warning: unexpected zlib header {new_comp[:2].hex()} (want 789c)",
                file=sys.stderr,
            )
        new_len = len(new_comp)
        old_len = length
        if len(str(new_len)) != len(str(old_len)):
            print(
                f"Length digit width changed ({old_len} -> {new_len}); unsupported",
                file=sys.stderr,
            )
            return 2

        new_marker = re.sub(
            rb"/Length \d+",
            f"/Length {new_len}".encode(),
            marker,
        )
        if len(new_marker) != len(marker):
            print("stream dictionary marker length changed", file=sys.stderr)
            return 2

        delta = new_len - old_len
        threshold = stream_end
        # Apply marker + body
        marker_start = data_start - len(marker)
        data[marker_start:data_start] = new_marker
        data[data_start:stream_end] = new_comp
        data = update_xref_and_startxref(data, threshold, delta)
        patched = True
        print(f"patched Flate object {obj_num}: Length {old_len} -> {new_len}")
        break
    else:
        for line in errors:
            print(line, file=sys.stderr)
        print("no suitable stream to patch", file=sys.stderr)
        return 2

    if not patched:
        print("nothing patched", file=sys.stderr)
        return 2

    data = patch_info_dates(data, args.creation_date)
    data = patch_ids(data)

    args.dst.parent.mkdir(parents=True, exist_ok=True)
    args.dst.write_bytes(data)
    print(f"wrote {args.dst} ({len(data)} bytes)")

    # Optional verify with PyMuPDF if installed
    try:
        import fitz  # type: ignore

        doc = fitz.open(args.dst)
        text = "\n".join(page.get_text() or "" for page in doc)
        doc.close()
        if args.new not in text:
            print("warning: --new not found in extracted text", file=sys.stderr)
        if args.old in text:
            print("warning: --old still present in extracted text", file=sys.stderr)
        for k in args.keep:
            if k not in text:
                print(f"warning: --keep missing in extracted text: {k!r}", file=sys.stderr)
    except ImportError:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
