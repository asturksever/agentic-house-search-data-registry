"""GIAS register → packs/schools/<AREA>.json.

Sharded by the postcode area of the school itself. That is an approximation: a
school just over an area boundary will not appear for a postcode 500 m away in
the neighbouring area. Neighbouring areas are therefore stitched in too, using
the fact that GIAS gives every school a postcode.

Ofsted grades come from a separate monthly spreadsheet and are not included
yet — see tools/packbuild/README.md.
"""
from __future__ import annotations

import collections
import csv
import json
import pathlib

from .osgb import to_wgs84
from .shard import area_of, normalise

PHASES = {
    "primary": "primary",
    "middle deemed primary": "primary",
    "infant": "primary",
    "junior": "primary",
    "secondary": "secondary",
    "middle deemed secondary": "secondary",
    "all-through": "all-through",
    "16 plus": "post-16",
    "nursery": "nursery",
}

# Schools near an area boundary must appear in both areas' shards, so each is
# also written into the shards of the areas whose centroid is close by.
NEIGHBOUR_RADIUS_DEG = 0.045  # ~5 km, comfortably past the report's 2 km radius


def build(source_path, packs_dir, generated, log=print) -> dict:
    schools: list[dict] = []
    with open(source_path, encoding="latin-1", newline="") as fh:
        for row in csv.DictReader(fh):
            if (row.get("EstablishmentStatus (name)") or "").strip() != "Open":
                continue
            postcode = normalise(row.get("Postcode", ""))
            easting, northing = row.get("Easting"), row.get("Northing")
            if not postcode or not easting or not northing:
                continue
            try:
                lat, lng = to_wgs84(easting, northing)
            except (TypeError, ValueError):
                continue
            phase = PHASES.get((row.get("PhaseOfEducation (name)") or "").strip().lower())
            schools.append({
                "urn": row.get("URN"),
                "name": (row.get("EstablishmentName") or "").strip(),
                "phase": phase,
                "lat": round(lat, 5),
                "lng": round(lng, 5),
                "area": area_of(postcode),
            })

    log(f"  {len(schools):,} open schools with a usable grid reference")

    # Centroid per area, so a school can be copied into nearby areas' shards.
    by_area: dict[str, list[dict]] = collections.defaultdict(list)
    for s in schools:
        by_area[s["area"]].append(s)
    centroids = {
        area: (sum(s["lat"] for s in items) / len(items),
               sum(s["lng"] for s in items) / len(items))
        for area, items in by_area.items()
    }

    out_dir = packs_dir / "schools"
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    files, total_bytes = 0, 0
    for area, (clat, clng) in centroids.items():
        included = [
            s for s in schools
            if s["area"] == area or (
                abs(s["lat"] - clat) <= NEIGHBOUR_RADIUS_DEG
                and abs(s["lng"] - clng) <= NEIGHBOUR_RADIUS_DEG)
        ]
        payload = {
            "_v": 1,
            "generated": generated,
            "schools": [{k: v for k, v in s.items() if k != "area"} for s in included],
        }
        text = json.dumps(payload, separators=(",", ":"))
        (out_dir / f"{area}.json").write_text(text)
        files += 1
        total_bytes += len(text)

    log(f"  schools: {files} shards, {total_bytes / 1e6:.1f} MB")
    return {"generated": generated, "shards": "postcode-area", "files": files,
            "schools": len(schools), "bytes": total_bytes}
