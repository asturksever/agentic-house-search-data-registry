"""Ofcom Connected Nations mobile coverage → packs/mobile/all.json.

Ofcom publishes fixed broadband down to the postcode but mobile only at local
authority and constituency level, so this pack is keyed by local-authority code
and the report says which geography the numbers describe. The columns are named
`<tech>_prem_out_<n>` — the share of premises where exactly n of the four
operators provide coverage — so "at least one operator" is 100 minus the _0
column.
"""
from __future__ import annotations

import csv
import io
import zipfile

from .shard import write_single

FIELDS = ["g5_out_all", "g5_out_any", "g4_in_all", "g4_in_any"]

SOURCE_COLUMNS = {
    "g5_out_all": ("5G_high_confidence_prem_out_4", False),
    "g5_out_any": ("5G_high_confidence_prem_out_0", True),   # invert: 100 - none
    "g4_in_all": ("4G_prem_in_4", False),
    "g4_in_any": ("4G_prem_in_0", True),
}


def _pct(value: str, invert: bool) -> int | None:
    try:
        pct = float(value)
    except (TypeError, ValueError):
        # An empty cell means "no premises in this band", i.e. zero.
        pct = 0.0
    return round(100 - pct) if invert else round(pct)


def build(source_path, packs_dir, generated, log=print) -> dict:
    archive = zipfile.ZipFile(source_path)
    name = next((n for n in archive.namelist()
                 if n.lower().endswith(".csv") and "laua" in n.lower()), None)
    if name is None:
        raise KeyError(f"no local-authority CSV inside {source_path.name}: {archive.namelist()}")

    rows: dict[str, list] = {}
    names: dict[str, str] = {}
    with archive.open(name) as fh:
        reader = csv.DictReader(io.TextIOWrapper(fh, "utf-8-sig"))
        for row in reader:
            code = (row.get("laua") or "").strip()
            if not code:
                continue
            names[code] = (row.get("laua_name") or "").strip()
            rows[code] = [_pct(row.get(col, ""), invert)
                          for col, invert in (SOURCE_COLUMNS[f] for f in FIELDS)]

    log(f"  {len(rows)} local authorities from {name}")
    return write_single("mobile", {"_fields": FIELDS, "names": names, "areas": rows},
                        packs_dir=packs_dir, generated=generated, log=log)
