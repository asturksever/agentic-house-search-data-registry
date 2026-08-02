#!/usr/bin/env python3
"""Guard against the GitHub Pages underscore trap.

Pages runs Jekyll by default, and Jekyll silently refuses to publish any file
or directory whose name begins with an underscore. The report's shared provider
modules are named `_nomis.js`, `_pack.js` and so on, so without a `.nojekyll`
file at the repo root they 404 in production — the module graph fails to load,
no event listeners are attached, and the search button does nothing at all.
It works perfectly on a local server, which is exactly what makes it nasty.
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Directories the published site actually serves.
SERVED = ["js", "assets", "data", "packs"]


def main() -> int:
    hidden = []
    for directory in SERVED:
        base = ROOT / directory
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.is_file() and any(p.startswith("_") for p in path.relative_to(ROOT).parts):
                hidden.append(path.relative_to(ROOT))

    if not hidden:
        print("no underscore-prefixed files in the published directories")
        return 0

    if (ROOT / ".nojekyll").exists():
        print(f"{len(hidden)} underscore-prefixed file(s) published; .nojekyll present")
        return 0

    print("GitHub Pages will not serve these files without a .nojekyll at the repo root:",
          file=sys.stderr)
    for path in sorted(hidden):
        print(f"  {path}", file=sys.stderr)
    print("Fix: touch .nojekyll", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
