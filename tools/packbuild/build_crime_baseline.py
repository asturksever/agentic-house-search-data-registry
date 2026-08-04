"""A national reference for "is this a lot of crime?".

The crime card reports how many crimes were recorded in a 1 km square around a
postcode over three months. The box is always the same size, so the number is
already a density and is comparable between places. What it lacked was anything
to compare it *to*: 749 means nothing without knowing what typical looks like.

Publishing a rate per 1,000 residents would need a population for the box, and
the box is not an LSOA, a ward or anything else with a published population.
Dividing by the LSOA population would be inventing a comparison, which is the
one thing this project does not do.

So the baseline is built the only way that is genuinely like-for-like: run the
*same query shape* at a random sample of real postcodes and keep the
distribution. A postcode can then be placed against "the same 1 km box, the same
three months, everywhere else in the country".

Sampling is deterministic (fixed seed) so a rebuild with unchanged inputs
produces an unchanged baseline, and the sample size and period are recorded
alongside the numbers so nobody has to guess how solid they are.
"""
from __future__ import annotations

import json
import math
import random
import statistics
import time
import urllib.error
import urllib.request

SEED = 20260805
SAMPLE_SIZE = 200
MONTHS = 3
BOX_M = 500  # half-width, so the query box is 1 km x 1 km, matching js/providers/crime.js

POSTCODES_IO = "https://api.postcodes.io/postcodes"
POLICE = "https://data.police.uk/api"
UA = {"User-Agent": "agentic-house-search packbuild (+https://github.com/asturksever/agentic-house-search-data-registry)"}

# police.uk publishes England, Wales and Northern Ireland. Scottish postcodes
# would contribute a structural zero and drag the national picture down.
COVERED = {"England", "Wales", "Northern Ireland"}


def _get(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


def _post(url: str, payload: dict, timeout: int = 60):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={**UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


def sample_postcodes(packs_dir, log) -> list[str]:
    """Draw from the broadband pack, which is the only complete postcode list here."""
    import glob
    import os

    everything: list[str] = []
    for path in sorted(glob.glob(os.path.join(str(packs_dir), "broadband", "*.json"))):
        shard = json.load(open(path))
        everything.extend(k for k in shard if not k.startswith("_"))

    if not everything:
        raise RuntimeError("no broadband pack to sample postcodes from; build that first")

    rng = random.Random(SEED)
    # Oversample: some postcodes will be Scottish or fail to geocode.
    picked = rng.sample(everything, min(len(everything), SAMPLE_SIZE * 3))
    log(f"  sampling from {len(everything):,} postcodes (seed {SEED})")
    return picked


def geocode(postcodes: list[str], log) -> list[dict]:
    """postcodes.io takes 100 at a time, so this is a handful of calls."""
    out = []
    for i in range(0, len(postcodes), 100):
        batch = postcodes[i:i + 100]
        try:
            data = _post(POSTCODES_IO, {"postcodes": batch})
        except (urllib.error.URLError, TimeoutError) as err:
            log(f"  geocode batch failed ({err}); continuing with what we have")
            continue
        for row in data.get("result", []):
            r = row.get("result")
            if r and r.get("country") in COVERED and r.get("latitude") is not None:
                out.append(r)
        time.sleep(0.2)
    return out


def previous_month(ym: str, back: int) -> str:
    year, month = (int(p) for p in ym.split("-"))
    month -= back
    while month < 1:
        month += 12
        year -= 1
    return f"{year}-{month:02d}"


def box_poly(lat: float, lng: float) -> str:
    d_lat = BOX_M / 111320
    d_lng = BOX_M / (111320 * math.cos(math.radians(lat)))
    corners = [
        (lat - d_lat, lng - d_lng), (lat - d_lat, lng + d_lng),
        (lat + d_lat, lng + d_lng), (lat + d_lat, lng - d_lng),
    ]
    return ":".join(f"{a:.5f},{b:.5f}" for a, b in corners)


def count_crimes(place: dict, months: list[str], log) -> int | None:
    total = 0
    for month in months:
        url = f"{POLICE}/crimes-street/all-crime?poly={box_poly(place['latitude'], place['longitude'])}&date={month}"
        for attempt in range(2):
            try:
                total += len(_get(url))
                break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
                if attempt:
                    log(f"  {place['postcode']} {month}: {err}; dropping this postcode")
                    return None
                time.sleep(2)
        time.sleep(0.3)  # police.uk is free and unmetered; do not hammer it
    return total


def build(packs_dir, log=print) -> dict:
    latest = _get(f"{POLICE}/crime-last-updated")["date"][:7]
    months = [previous_month(latest, i) for i in range(MONTHS)]
    log(f"  months: {', '.join(reversed(months))}")

    candidates = geocode(sample_postcodes(packs_dir, log), log)
    log(f"  {len(candidates)} candidates in covered nations")

    counts: list[int] = []
    for place in candidates:
        if len(counts) >= SAMPLE_SIZE:
            break
        n = count_crimes(place, months, log)
        if n is not None:
            counts.append(n)
        if len(counts) % 50 == 0 and counts:
            log(f"  {len(counts)}/{SAMPLE_SIZE} sampled")

    if len(counts) < SAMPLE_SIZE // 2:
        raise RuntimeError(f"only {len(counts)} usable samples; refusing to publish a baseline this thin")

    counts.sort()
    quantile = lambda q: counts[min(len(counts) - 1, int(len(counts) * q))]

    baseline = {
        "period": f"{months[-1]}..{months[0]}",
        "months": MONTHS,
        "box_km2": round((BOX_M * 2 / 1000) ** 2, 2),
        "sample_size": len(counts),
        "seed": SEED,
        "median": statistics.median(counts),
        "mean": round(statistics.fmean(counts), 1),
        "p25": quantile(0.25),
        "p75": quantile(0.75),
        "p90": quantile(0.90),
        "note": (
            "Recorded crimes in a 1 km square over three months, at a random sample of "
            "UK postcodes covered by data.police.uk. The same query shape as the report, "
            "so a postcode's count can be read against it directly."
        ),
    }
    log(f"  crime baseline: median {baseline['median']}, p75 {baseline['p75']}, "
        f"from {len(counts)} postcodes")
    return baseline
