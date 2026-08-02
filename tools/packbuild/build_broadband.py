"""Ofcom Connected Nations fixed broadband → packs/broadband/<AREA>.json.

Ofcom ships a zip of zips: the outer archive holds a residential and an
all-premises bundle, each already split one CSV per postcode area — which is
the same key this repo shards on, so the whole thing streams through without
ever holding 2.6 million rows in memory.
"""
from __future__ import annotations

import csv
import io
import zipfile

from .shard import normalise, write_pack

FIELDS = ["gigabit", "ufbb", "sfbb", "uso"]

# Ofcom renames these columns between releases; match on the concept.
COLUMNS = {
    "gigabit": r"gigabit availability",
    "ufbb": r"^ufbb availability",
    "sfbb": r"^sfbb availability",
    "uso": r"below the uso",
}

INNER = "res"  # residential premises, not business parks


def _pick(header: list[str]) -> dict[str, int]:
    import re
    out = {}
    for field, pattern in COLUMNS.items():
        for i, name in enumerate(header):
            if re.search(pattern, name.strip(), re.I):
                out[field] = i
                break
    missing = [f for f in COLUMNS if f not in out]
    if missing:
        raise KeyError(f"Ofcom CSV is missing columns for {missing}; header was {header}")
    return out


def _pct(value: str) -> int | None:
    try:
        return round(float(value))
    except (TypeError, ValueError):
        return None


def build(source_path, packs_dir, generated, log=print) -> dict:
    outer = zipfile.ZipFile(source_path)
    inner_name = next((n for n in outer.namelist()
                       if n.endswith(".zip") and INNER in n.lower()), None)
    if inner_name is None:
        inner_name = next(n for n in outer.namelist() if n.endswith(".zip"))
        log(f"  residential bundle not found; using {inner_name}")

    inner = zipfile.ZipFile(io.BytesIO(outer.read(inner_name)))
    csvs = [n for n in inner.namelist() if n.lower().endswith(".csv")]
    log(f"  {len(csvs)} area files inside {inner_name}")

    rows: dict[str, list] = {}
    skipped = 0
    for name in csvs:
        with inner.open(name) as fh:
            reader = csv.reader(io.TextIOWrapper(fh, "utf-8-sig"))
            index = _pick(next(reader))
            for row in reader:
                postcode = normalise(row[0])
                if not postcode:
                    skipped += 1
                    continue
                rows[postcode] = [_pct(row[index[f]]) for f in FIELDS]

    if skipped:
        log(f"  skipped {skipped:,} rows with an unparseable postcode")
    return write_pack("broadband", FIELDS, rows, packs_dir=packs_dir,
                      generated=generated, log=log)
