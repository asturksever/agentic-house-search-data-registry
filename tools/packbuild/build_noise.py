"""Defra strategic noise mapping → packs/noise/<AREA>.json.

Not implemented yet, and deliberately so rather than half-done.

Every other pack comes from a flat file keyed by something the report already
knows (a postcode, a local authority). Noise is published as Lden/Lnight
contour polygons for road, rail and air, which means a genuine spatial join:
1.8 million postcode centroids from ONSPD against several hundred thousand
polygons, or the same thing done properly by rasterising the contours to a 50 m
grid and sampling. That needs geopandas/shapely plus the ~1 GB ONSPD download,
and it is the one builder that cannot be verified without running the whole
thing end to end.

Until it lands, the noise card degrades cleanly: it says the extract has not
been built and links to Defra's own map viewer, which is the honest answer.

The shape it should produce, so the front end does not have to change:
    fields: ["road_lden", "road_lnight", "rail_lden", "air_lden"]
    values: integer dB, or null where no contour covers the postcode
"""
from __future__ import annotations


def build(source_path, packs_dir, generated, log=print) -> dict:  # noqa: ARG001
    raise NotImplementedError(
        "the noise pack needs a polygon join (geopandas + ONSPD centroids) — "
        "see tools/packbuild/build_noise.py for the intended output shape")
