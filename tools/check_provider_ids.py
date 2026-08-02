#!/usr/bin/env python3
"""Every registry id a report provider claims must exist in data/registry.json.

Providers cite their sources by id so the report can render attribution and a
link back to the catalogue entry. A typo there would silently drop the licence
line from a card, so it is a CI failure rather than a runtime surprise.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROVIDERS = ROOT / "js" / "providers"
IDS_RE = re.compile(r"registryIds\s*:\s*\[([^\]]*)\]", re.S)
STRING_RE = re.compile(r"['\"]([^'\"]+)['\"]")


def main() -> int:
    known = {s["id"] for s in json.loads((ROOT / "data" / "registry.json").read_text())["sources"]}
    if not PROVIDERS.is_dir():
        print("no js/providers yet — nothing to check")
        return 0

    errors, checked = [], 0
    for path in sorted(PROVIDERS.glob("*.js")):
        for block in IDS_RE.findall(path.read_text()):
            for sid in STRING_RE.findall(block):
                checked += 1
                if sid not in known:
                    errors.append(f"{path.relative_to(ROOT)}: unknown registry id {sid!r}")

    for e in errors:
        print(e, file=sys.stderr)
    print(f"{checked} provider registry id(s) checked, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
