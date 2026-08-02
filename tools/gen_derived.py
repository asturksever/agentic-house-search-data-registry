#!/usr/bin/env python3
"""Regenerate the files derived from data/registry.json.

data/registry.json is canonical. data/registry.csv and the "Datasets by
category" section of README.md are generated from it, so they cannot drift.

  python3 tools/gen_derived.py           # write the derived files
  python3 tools/gen_derived.py --check   # exit 1 if they are out of date (CI)
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "registry.json"
CSV_PATH = ROOT / "data" / "registry.csv"
README = ROOT / "README.md"

CSV_FIELDS = ["id", "category", "dataset", "publisher", "link", "api", "api_docs",
              "format", "licence", "coverage", "update_frequency", "questions"]

SECTION_START = "## Datasets by category"
SECTION_END = "## Usage"


# README sections are grouped by coarse heading, in the same order the catalogue
# page shows its filter pills (with Amenities ahead of Health & care, as the
# README has always had it). Categories within a group keep registry order.
GROUP_ORDER = ["Crime", "Demographics", "Affluence", "Property prices",
               "Ownership & tenure", "Planning & constraints", "Ground risk", "Noise",
               "Transport", "Amenities", "Health & care", "Schools", "Environment",
               "Geography backbone", "Extras"]


def group_index(category: str) -> int:
    for i, g in enumerate(GROUP_ORDER):
        if category.startswith(g):
            return i
    return len(GROUP_ORDER)


def short(text: str) -> str:
    """README tables show the headline clause only; the full text lives in the JSON."""
    for sep in (" — ", " - "):
        text = text.split(sep)[0]
    return text.strip()


def short_api(api: str) -> str:
    """Drop the parenthetical caveats and alternates that some api fields carry."""
    return api.split(" (")[0].split(";")[0].strip()


def build_csv(sources: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_FIELDS, lineterminator="\n")
    w.writeheader()
    for s in sources:
        row = {k: s.get(k, "") for k in CSV_FIELDS}
        row["questions"] = " | ".join(s.get("questions", []))
        w.writerow(row)
    return buf.getvalue()


def build_readme_section(sources: list[dict]) -> str:
    by_category: dict[str, list[dict]] = {}
    for s in sources:  # dict preserves registry order
        by_category.setdefault(s["category"], []).append(s)

    ordered = sorted(by_category.items(),
                     key=lambda kv: (group_index(kv[0]), list(by_category).index(kv[0])))

    out = [SECTION_START, ""]
    for category, entries in ordered:
        out += [f"### {category}", "",
                "| Dataset | Publisher | API | Licence |",
                "| --- | --- | --- | --- |"]
        for s in entries:
            out.append(
                f"| [{short(s['dataset'])}]({s['link']}) | {s['publisher']} | "
                f"`{short_api(s['api'])}` | {s['licence']} |"
            )
        out.append("")
    return "\n".join(out)


def build_readme(sources: list[dict]) -> str:
    text = README.read_text()
    start = text.index(SECTION_START)
    end = text.index(SECTION_END, start)
    return text[:start] + build_readme_section(sources) + "\n" + text[end:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify the derived files match instead of writing them")
    args = ap.parse_args()

    sources = json.loads(REGISTRY.read_text())["sources"]
    outputs = {CSV_PATH: build_csv(sources), README: build_readme(sources)}

    stale = [p for p, want in outputs.items() if p.read_text() != want]
    if args.check:
        for p in stale:
            print(f"stale: {p.relative_to(ROOT)} — run python3 tools/gen_derived.py",
                  file=sys.stderr)
        return 1 if stale else 0

    for p, want in outputs.items():
        if p in stale:
            p.write_text(want)
            print(f"wrote {p.relative_to(ROOT)}")
    if not stale:
        print("derived files already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
