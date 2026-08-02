"""Check the packs on disk before they are committed."""
from __future__ import annotations

import json
import pathlib
import re

POSTCODE_RE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$")
META_KEYS = {"_v", "_fields", "_default", "_generated", "_n"}

# Per-pack ceiling on a single shard, in bytes. A shard is fetched on every
# report, so a blown budget is a user-visible regression, not a tidiness issue.
SHARD_BUDGET = {
    "broadband": 3_000_000,
    "noise": 3_000_000,
    "schools": 6_000_000,
    "mobile": 2_000_000,
}


def validate_pack(name: str, packs_dir: pathlib.Path, *, postcode_keyed: bool = True) -> list[str]:
    errors: list[str] = []
    directory = packs_dir / name
    if not directory.is_dir():
        return [f"{name}: no directory"]

    shards = sorted(directory.glob("*.json"))
    if not shards:
        return [f"{name}: no shards written"]

    budget = SHARD_BUDGET.get(name, 4_000_000)
    for path in shards:
        size = path.stat().st_size
        if size > budget:
            errors.append(f"{name}/{path.name}: {size:,} bytes exceeds the {budget:,} byte budget")
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as err:
            errors.append(f"{name}/{path.name}: invalid JSON ({err})")
            continue

        if data.get("_v") != 1:
            errors.append(f"{name}/{path.name}: unexpected schema version {data.get('_v')!r}")

        fields = data.get("_fields")
        if fields is None or not postcode_keyed:
            continue  # schools and mobile are keyed by school and by authority

        for key, value in data.items():
            if key in META_KEYS:
                continue
            if not POSTCODE_RE.match(key):
                errors.append(f"{name}/{path.name}: {key!r} is not a postcode")
                break
            if not isinstance(value, list) or len(value) != len(fields):
                errors.append(f"{name}/{path.name}: {key} has {len(value)} values, expected {len(fields)}")
                break
            if any(v is not None and not isinstance(v, (int, float)) for v in value):
                errors.append(f"{name}/{path.name}: {key} has a non-numeric value")
                break

    return errors


def validate_all(packs_dir: pathlib.Path) -> list[str]:
    manifest_path = packs_dir / "manifest.json"
    if not manifest_path.exists():
        return ["packs/manifest.json is missing"]

    manifest = json.loads(manifest_path.read_text())
    errors: list[str] = []
    for name, stats in manifest.get("packs", {}).items():
        errors += validate_pack(name, packs_dir,
                                postcode_keyed=stats.get("shards") == "postcode-area"
                                and "postcodes" in stats)
    return errors
