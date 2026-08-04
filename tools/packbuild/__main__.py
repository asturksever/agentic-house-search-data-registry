"""packbuild — build the static extracts the postcode report reads.

    python3 -m packbuild build              # every pack
    python3 -m packbuild build --only broadband
    python3 -m packbuild validate

Run from the repo root with tools/ on the path:

    PYTHONPATH=tools python3 -m packbuild build
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

from . import baselines, validate
from .fetch import SourceUnavailable, fetch

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PACKS = ROOT / "packs"

# pack name → (source key, builder module attribute)
BUILDERS = {
    "broadband": ("ofcom_fixed_postcodes", "build_broadband"),
    "mobile": ("ofcom_mobile_laua", "build_mobile"),
    "schools": ("gias_schools", "build_schools"),
    "noise": ("defra_noise", "build_noise"),
}

# A pack whose postcode count moves by more than this without --allow-large-change
# is treated as a broken source rather than a real change.
CHANGE_TOLERANCE = 0.05


def load_manifest() -> dict:
    path = PACKS / "manifest.json"
    if path.exists():
        return json.loads(path.read_text())
    return {"version": 1, "generated": None, "packs": {}, "sources": {}}


def build(names: list[str], *, refresh: bool, allow_large_change: bool,
          crime_baseline: bool = True, log=print) -> int:
    import importlib

    PACKS.mkdir(exist_ok=True)
    manifest = load_manifest()
    generated = dt.date.today().isoformat()
    failures: list[str] = []

    for name in names:
        source_key, module_name = BUILDERS[name]
        log(f"{name}:")
        try:
            path, meta = fetch(source_key, log=log, refresh=refresh)
        except SourceUnavailable as err:
            # Leave the committed shards alone: a moved URL must not blank the
            # site, and the workflow turns this into an issue.
            log(f"  SKIPPED — {err}")
            failures.append(f"{name}: {err}")
            continue

        try:
            module = importlib.import_module(f".{module_name}", package=__package__)
            stats = module.build(path, PACKS, generated, log=log)
        except NotImplementedError as err:
            log(f"  SKIPPED — {err}")
            failures.append(f"{name}: {err}")
            continue

        previous = manifest.get("packs", {}).get(name, {})
        before, after = previous.get("postcodes"), stats.get("postcodes")
        if before and after and abs(after - before) / before > CHANGE_TOLERANCE:
            message = (f"{name}: postcode count moved {before:,} → {after:,} "
                       f"({(after - before) / before:+.1%})")
            if allow_large_change:
                log(f"  {message} — allowed")
            else:
                log(f"  REJECTED — {message}; re-run with --allow-large-change if this is real")
                failures.append(message)
                continue

        manifest.setdefault("packs", {})[name] = stats
        manifest.setdefault("sources", {})[name] = {
            "url": meta["url"], "sha256": meta["sha256"], "bytes": meta["bytes"],
            "fetched": generated, "relocated": meta.get("relocated", False),
        }

    manifest["generated"] = generated
    (PACKS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    baselines.build(PACKS, generated, log=log, with_crime=crime_baseline)

    errors = validate.validate_all(PACKS)
    for e in errors:
        print(e, file=sys.stderr)

    if failures:
        print("\nnot built:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)

    return 1 if errors else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="packbuild", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build", help="download sources and write packs/")
    b.add_argument("--only", default="all",
                   help=f"comma-separated pack names ({', '.join(BUILDERS)}) or 'all'")
    b.add_argument("--refresh", action="store_true", help="ignore the download cache")
    b.add_argument("--allow-large-change", action="store_true",
                   help="accept a pack whose size moved more than 5%%")
    b.add_argument("--skip-crime-baseline", action="store_true",
                   help="do not re-sample the national crime baseline (it makes ~600 live "
                        "API calls and takes several minutes); the previous one is kept")

    sub.add_parser("validate", help="check the packs already on disk")

    args = ap.parse_args(argv)
    if args.command == "validate":
        errors = validate.validate_all(PACKS)
        for e in errors:
            print(e, file=sys.stderr)
        print(f"{len(errors)} problem(s)")
        return 1 if errors else 0

    names = list(BUILDERS) if args.only == "all" else [n.strip() for n in args.only.split(",")]
    unknown = [n for n in names if n not in BUILDERS]
    if unknown:
        ap.error(f"unknown pack(s): {', '.join(unknown)}")
    return build(names, refresh=args.refresh,
                 allow_large_change=args.allow_large_change,
                 crime_baseline=not args.skip_crime_baseline)


if __name__ == "__main__":
    raise SystemExit(main())
