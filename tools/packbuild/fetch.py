"""Download bulk sources, with a cache and a way to survive a moved URL."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import pathlib
import re
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
CACHE = ROOT / ".cache"
SOURCES = json.loads((pathlib.Path(__file__).parent / "sources.json").read_text())
UA = {"User-Agent": "agentic-house-search-data-registry packbuild (+https://github.com/asturksever/agentic-house-search-data-registry)"}


class SourceUnavailable(Exception):
    """The source could not be downloaded, from its URL or by discovery."""


def _get(url: str, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def _expand(url: str) -> str:
    return url.replace("{today}", dt.date.today().strftime("%Y%m%d"))


def _discover(spec: dict, log) -> str | None:
    disc = spec.get("discovery")
    if not disc:
        return None
    try:
        page = _get(disc["page"], timeout=60).decode("utf-8", "replace")
    except Exception as err:  # noqa: BLE001 — any failure here is just "no luck"
        log(f"  discovery page unreachable: {err}")
        return None
    match = re.search(disc["link_regex"], page, re.I)
    if not match:
        log("  discovery pattern matched nothing on the page")
        return None
    return urllib.parse.urljoin(disc["page"], match.group(1))


def fetch(name: str, *, log=print, refresh: bool = False) -> tuple[pathlib.Path, dict]:
    """Return (path on disk, metadata). Raises SourceUnavailable if it cannot be had."""
    spec = SOURCES[name]
    CACHE.mkdir(exist_ok=True)

    candidates = []
    if spec.get("url"):
        candidates.append((_expand(spec["url"]), False))

    body = None
    used = None
    for url, relocated in candidates:
        cached = CACHE / f"{name}{pathlib.Path(urllib.parse.urlparse(url).path).suffix or '.bin'}"
        if cached.exists() and not refresh:
            log(f"  using cached {cached.name}")
            return cached, {"url": url, "cached": True,
                            "sha256": hashlib.sha256(cached.read_bytes()).hexdigest(),
                            "bytes": cached.stat().st_size, "relocated": relocated}
        try:
            log(f"  downloading {url}")
            body = _get(url)
            used = url
            break
        except Exception as err:  # noqa: BLE001
            log(f"  {err} — trying discovery")

    if body is None:
        url = _discover(spec, log)
        if not url:
            raise SourceUnavailable(f"{name}: no working URL (configured URL failed and discovery found nothing)")
        log(f"  RELOCATED: {name} now at {url} — update sources.json")
        body = _get(url)
        used = url

    suffix = pathlib.Path(urllib.parse.urlparse(used).path).suffix or ".bin"
    path = CACHE / f"{name}{suffix}"
    path.write_bytes(body)
    return path, {"url": used, "cached": False, "sha256": hashlib.sha256(body).hexdigest(),
                  "bytes": len(body), "relocated": used != _expand(spec.get("url") or "")}
