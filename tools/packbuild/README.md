# packbuild

The postcode report reads most of its numbers straight from publishers' APIs.
Three sources have no queryable API at all — they are published as bulk files —
so they are pre-joined here and committed as static JSON under `packs/`.

```bash
PYTHONPATH=tools python3 -m packbuild build              # everything
PYTHONPATH=tools python3 -m packbuild build --only broadband
PYTHONPATH=tools python3 -m packbuild validate           # check what is on disk
PYTHONPATH=tools python3 -m pytest tools/packbuild/tests -q
```

No third-party dependencies: stdlib `csv`/`zipfile`/`urllib`, and a pure-Python
OSGB→WGS84 conversion in `osgb.py` rather than pulling in pyproj for one call.
Downloads are cached in `.cache/` (gitignored); `--refresh` ignores the cache.

## What gets built

| Pack | Source | Key | Size |
| --- | --- | --- | --- |
| `broadband` | Ofcom Connected Nations, fixed coverage by postcode | postcode, sharded by area | ~11 MB over 121 shards |
| `mobile` | Ofcom Connected Nations, mobile coverage by local authority | local authority code, one file | ~20 KB |
| `schools` | GIAS full register (daily) | school, sharded by postcode area | ~3 MB over 114 shards |
| `noise` | Defra strategic noise mapping | — | not built yet, see below |

A page fetches exactly one shard per pack, so the number that matters is the
largest single shard (~265 KB, before gzip), not the total.

**Mobile is local-authority level on purpose.** Ofcom publishes fixed broadband
down to the postcode but mobile coverage only by local authority and
constituency, so the mobile card describes the whole authority and says so.

**Noise is not implemented.** Every other pack comes from a flat file keyed by
something the report already knows. Noise is contour polygons, so it needs a
real spatial join (geopandas plus the ~1 GB ONSPD centroids) and cannot be
verified without running the whole thing end to end. Until then the noise card
degrades cleanly to "not built yet" and links to Defra's own viewer.
`build_noise.py` records the output shape it should produce.

## Encoding

Each postcode-keyed shard is a flat object:

```json
{"_v":1,"_fields":["gigabit","ufbb","sfbb","uso"],"_n":13380,
 "_default":[100,100,100,0],"AB101XG":[80,80,100,2]}
```

Values are integer-quantised, and any postcode whose row equals the area's modal
row is left out and resolved client-side from `_default` — which removes most
rows in dense urban areas, where neighbouring postcodes genuinely share a value.
`_n` counts every postcode the shard covers including the elided ones, so a
consumer can weight the modal row correctly (`baselines.py` depends on this).

## When a source moves

Publishers rotate these URLs every release. Each entry in `sources.json` carries
a `discovery` page and a link pattern: if the configured URL 404s, the builder
scrapes the page, takes the first matching link and logs `RELOCATED`. If that
fails too, the pack is **skipped** — the committed shards are left exactly as
they are, and the scheduled workflow opens an issue naming the source. A rotted
URL must never take the live site down with it.

The build also refuses a pack whose postcode count has moved more than 5% since
the last run unless `--allow-large-change` is passed; a source that silently
half-publishes looks exactly like a successful build otherwise.

## Licensing

`packs/` contains values derived from third-party open data. Ofcom Connected
Nations is under Ofcom's own terms rather than OGL, so **confirm that
redistributing derived postcode-level values is permitted before publishing a
refresh**. Defra noise, GIAS and Ofsted are OGL v3. Anything derived from
postcode geography carries the mandatory OS and Royal Mail attribution, which
the report footer prints.
