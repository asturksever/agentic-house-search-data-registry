"""National reference values, derived from the packs once they are built.

Without these, "94% gigabit availability" is a number with nothing to lean on.
They are computed from the same extracts the report reads, so a benchmark can
never describe a different vintage from the value it sits next to.
"""
from __future__ import annotations

import json
import pathlib
import statistics


def _distribution(packs_dir: pathlib.Path, pack: str, field: str) -> dict | None:
    directory = packs_dir / pack
    values: list[float] = []
    for path in sorted(directory.glob("*.json")):
        data = json.loads(path.read_text())
        fields = data.get("_fields")
        if not fields or field not in fields:
            continue
        index = fields.index(field)
        rows = [v for k, v in data.items() if not k.startswith("_")]
        for row in rows:
            if row[index] is not None:
                values.append(row[index])

        # Listed rows are the ones that differ from the modal row, so they skew
        # low. The elided postcodes have to be counted back in at their real
        # weight or the median describes the exceptions, not the country.
        default = data.get("_default")
        elided = (data.get("_n") or len(rows)) - len(rows)
        if default and default[index] is not None and elided > 0:
            values.extend([default[index]] * elided)
    if not values:
        return None
    # Coverage percentages pile up at 100, so the median is often exactly 100
    # and useless as a comparison. The mean is what makes "94%" mean something.
    return {"mean": round(statistics.fmean(values), 1),
            "median": statistics.median(values),
            "postcodes": len(values)}


def build(packs_dir: pathlib.Path, generated: str, log=print, *, with_crime: bool = True) -> dict:
    out: dict = {"generated": generated}

    # Live-sampled, so it is opt-out for fast local rebuilds and for any run
    # where police.uk is unreachable. Whenever a fresh sample is not produced the
    # previous one is carried forward: a stale benchmark, clearly dated, is far
    # better than silently removing the only thing that makes a crime count
    # readable.
    existing = packs_dir / "baselines.json"
    previous_crime = None
    if existing.exists():
        try:
            previous_crime = json.loads(existing.read_text()).get("crime")
        except json.JSONDecodeError:
            pass

    if with_crime:
        try:
            from . import build_crime_baseline
            out["crime"] = build_crime_baseline.build(packs_dir, log=log)
        except Exception as err:  # noqa: BLE001 — any failure here is non-fatal
            log(f"  crime baseline failed: {err}")
            if previous_crime:
                out["crime"] = previous_crime
                log(f"  kept the previous crime baseline ({previous_crime.get('period')})")
    elif previous_crime:
        out["crime"] = previous_crime
        log(f"  crime baseline: kept the existing one ({previous_crime.get('period')})")

    if (packs_dir / "broadband").is_dir():
        out["broadband"] = {
            field: _distribution(packs_dir, "broadband", field)
            for field in ("gigabit", "ufbb", "sfbb")
        }

    mobile_path = packs_dir / "mobile" / "all.json"
    if mobile_path.exists():
        mobile = json.loads(mobile_path.read_text())
        fields, areas = mobile.get("_fields", []), mobile.get("areas", {})
        if fields and areas:
            columns = list(zip(*areas.values()))
            out["mobile"] = {
                f"uk_median_{name}": statistics.median([v for v in column if v is not None])
                for name, column in zip(fields, columns)
                if any(v is not None for v in column)
            }

    (packs_dir / "baselines.json").write_text(json.dumps(out, separators=(",", ":")))
    log(f"  baselines: {', '.join(k for k in out if k != 'generated') or 'nothing to compute'}")
    return out
