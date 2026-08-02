"""Turn a postcode → values mapping into per-postcode-area JSON shards.

The browser fetches exactly one shard per pack, so the unit of sharding is the
postcode area (the leading letters: SW, M, B). Rows are integer-quantised
arrays rather than objects, and any postcode whose row equals the area's modal
row is left out and resolved client-side from `_default` — which elides a large
share of dense urban postcodes, where neighbours genuinely share a value.
"""
from __future__ import annotations

import collections
import json
import pathlib
import re

AREA_RE = re.compile(r"^([A-Z]{1,2})")
POSTCODE_RE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$")

SCHEMA_VERSION = 1


def normalise(postcode: str) -> str | None:
    """Compact, upper-cased, or None if it is not a postcode at all."""
    pc = re.sub(r"\s+", "", str(postcode or "")).upper()
    return pc if POSTCODE_RE.match(pc) else None


def area_of(postcode: str) -> str:
    m = AREA_RE.match(postcode)
    return m.group(1) if m else "ZZ"


def write_pack(name: str, fields: list[str], rows: dict[str, list], *,
               packs_dir: pathlib.Path, generated: str, log=print) -> dict:
    """rows: compact postcode → list of values in `fields` order."""
    by_area: dict[str, dict[str, list]] = collections.defaultdict(dict)
    for postcode, values in rows.items():
        by_area[area_of(postcode)][postcode] = values

    out_dir = packs_dir / name
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    total, files, bytes_written = 0, 0, 0
    for area, entries in sorted(by_area.items()):
        counts = collections.Counter(tuple(v) for v in entries.values())
        default, default_n = counts.most_common(1)[0]
        # Only worth eliding when the modal row actually repeats.
        use_default = default_n > 1

        # _n counts every postcode the shard covers, including the ones elided
        # into _default — without it a consumer cannot weight the modal row.
        shard: dict = {"_v": SCHEMA_VERSION, "_fields": fields, "_generated": generated,
                       "_n": len(entries)}
        if use_default:
            shard["_default"] = list(default)
        for postcode, values in sorted(entries.items()):
            if use_default and tuple(values) == default:
                continue
            shard[postcode] = values

        text = json.dumps(shard, separators=(",", ":"))
        (out_dir / f"{area}.json").write_text(text)
        total += len(entries)
        files += 1
        bytes_written += len(text)

    log(f"  {name}: {total:,} postcodes across {files} shards, {bytes_written / 1e6:.1f} MB")
    return {"generated": generated, "fields": fields, "shards": "postcode-area",
            "files": files, "postcodes": total, "bytes": bytes_written}


def write_single(name: str, payload: dict, *, packs_dir: pathlib.Path,
                 generated: str, log=print) -> dict:
    """A pack small enough not to shard (one file, keyed however it likes)."""
    out_dir = packs_dir / name
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {"_v": SCHEMA_VERSION, "_generated": generated, **payload}
    text = json.dumps(payload, separators=(",", ":"))
    (out_dir / "all.json").write_text(text)
    log(f"  {name}: single file, {len(text) / 1e6:.2f} MB")
    return {"generated": generated, "shards": "none", "files": 1, "bytes": len(text)}
