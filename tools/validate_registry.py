#!/usr/bin/env python3
"""Structural checks on data/registry.json (run in CI on every PR)."""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "registry.json"

REQUIRED = ["id", "dataset", "publisher", "link", "api", "api_docs", "format",
            "licence", "coverage", "update_frequency", "questions", "category"]
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def main() -> int:
    data = json.loads(REGISTRY.read_text())
    errors: list[str] = []

    for key in ("title", "description", "generated", "sources"):
        if key not in data:
            errors.append(f"top level: missing {key!r}")
    sources = data.get("sources", [])
    if not sources:
        errors.append("sources: empty")

    seen: set[str] = set()
    for i, s in enumerate(sources):
        where = f"sources[{i}] ({s.get('id', '?')})"
        for key in REQUIRED:
            if not s.get(key):
                errors.append(f"{where}: missing or empty {key!r}")
        sid = s.get("id", "")
        if sid and not ID_RE.match(sid):
            errors.append(f"{where}: id must be kebab-case")
        if sid in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(sid)
        for key in ("link", "api_docs"):
            if s.get(key) and not str(s[key]).startswith("http"):
                errors.append(f"{where}: {key} is not a URL")
        if not isinstance(s.get("questions"), list) or not s.get("questions"):
            errors.append(f"{where}: questions must be a non-empty list")

    for e in errors:
        print(e, file=sys.stderr)
    print(f"{len(sources)} sources checked, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
