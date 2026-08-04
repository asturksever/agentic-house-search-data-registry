"""Fixture tests for the pack build. Run: PYTHONPATH=tools python3 -m pytest tools

These run against tiny committed fixtures rather than the real 34 MB downloads,
so they take a second and can run on every PR. The heavy build runs on a
schedule.
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from packbuild import baselines, build_broadband, build_crime_baseline, build_mobile, validate  # noqa: E402
from packbuild.osgb import to_wgs84  # noqa: E402
from packbuild.shard import area_of, normalise, write_pack  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
GENERATED = "2026-01-01"


def test_normalise_accepts_real_postcodes_and_rejects_junk():
    assert normalise("sw11 1aa") == "SW111AA"
    assert normalise(" EC3A5DE ") == "EC3A5DE"
    assert normalise("SW11") is None
    assert normalise("") is None
    assert normalise("NOT A POSTCODE") is None


def test_area_is_the_leading_letters():
    assert area_of("SW111AA") == "SW"
    assert area_of("M11AE") == "M"
    assert area_of("EC3A5DE") == "EC"


def test_osgb_conversion_lands_on_the_right_building():
    # The Aldgate School, EC3A 5DE, from its GIAS grid reference.
    lat, lng = to_wgs84(533498, 181201)
    assert abs(lat - 51.5140) < 0.001
    assert abs(lng - -0.0775) < 0.001


def test_modal_row_is_elided_and_counted(tmp_path):
    rows = {
        "SW111AA": [100, 100, 100, 0],
        "SW111AB": [100, 100, 100, 0],
        "SW111AC": [100, 100, 100, 0],
        "SW111AD": [12, 40, 90, 3],
        "M11AE": [50, 50, 100, 0],
    }
    stats = write_pack("t", ["gigabit", "ufbb", "sfbb", "uso"], rows,
                       packs_dir=tmp_path, generated=GENERATED, log=lambda *_: None)
    assert stats["postcodes"] == 5
    assert stats["files"] == 2

    sw = json.loads((tmp_path / "t" / "SW.json").read_text())
    assert sw["_default"] == [100, 100, 100, 0]
    assert sw["_n"] == 4                      # every postcode the shard covers
    assert "SW111AA" not in sw                # elided into _default
    assert sw["SW111AD"] == [12, 40, 90, 3]   # the exception is listed

    # A single-postcode area has no modal row worth eliding.
    m = json.loads((tmp_path / "t" / "M.json").read_text())
    assert "_default" not in m
    assert m["M11AE"] == [50, 50, 100, 0]


def test_broadband_build_from_fixture(tmp_path):
    stats = build_broadband.build(FIXTURES / "ofcom_fixed_postcodes.zip", tmp_path,
                                  GENERATED, log=lambda *_: None)
    assert stats["postcodes"] == 4

    shard = json.loads((tmp_path / "broadband" / "AB.json").read_text())
    assert shard["_fields"] == ["gigabit", "ufbb", "sfbb", "uso"]
    # AB10 1UG in the fixture: gigabit 95.8, ufbb 95.8, sfbb 100.0, uso 0.0
    row = shard.get("AB101UG") or shard["_default"]
    assert row == [96, 96, 100, 0]


def test_broadband_build_rejects_a_renamed_column(tmp_path):
    import pytest
    with pytest.raises(KeyError, match="missing columns"):
        build_broadband.build(FIXTURES / "ofcom_fixed_postcodes_renamed.zip", tmp_path,
                              GENERATED, log=lambda *_: None)


def test_mobile_build_inverts_the_none_column(tmp_path):
    build_mobile.build(FIXTURES / "ofcom_mobile_laua.zip", tmp_path, GENERATED,
                       log=lambda *_: None)
    pack = json.loads((tmp_path / "mobile" / "all.json").read_text())
    assert pack["_fields"] == ["g5_out_all", "g5_out_any", "g4_in_all", "g4_in_any"]
    # Fixture: 5G_..._prem_out_4 = 1.22, 5G_..._prem_out_0 = 1.78 → any = 98.22
    assert pack["areas"]["E06000001"][:2] == [1, 98]
    assert pack["names"]["E06000001"] == "Hartlepool"


def test_crime_baseline_month_arithmetic_crosses_years():
    assert build_crime_baseline.previous_month("2026-06", 0) == "2026-06"
    assert build_crime_baseline.previous_month("2026-06", 2) == "2026-04"
    assert build_crime_baseline.previous_month("2026-01", 1) == "2025-12"
    assert build_crime_baseline.previous_month("2026-01", 13) == "2024-12"


def test_crime_baseline_box_is_one_square_kilometre():
    # Four corners, and the box must match the one js/providers/crime.js queries,
    # or the baseline would describe a different sized area than the report.
    poly = build_crime_baseline.box_poly(51.5, -0.1)
    corners = [tuple(float(v) for v in c.split(",")) for c in poly.split(":")]
    assert len(corners) == 4

    lats = sorted({round(c[0], 5) for c in corners})
    lngs = sorted({round(c[1], 5) for c in corners})
    height_m = (lats[1] - lats[0]) * 111320
    width_m = (lngs[1] - lngs[0]) * 111320 * math.cos(math.radians(51.5))
    assert 990 < height_m < 1010
    assert 990 < width_m < 1010


def test_baselines_keeps_the_previous_crime_block_when_sampling_is_skipped(tmp_path):
    # A failed or skipped sampling run must not silently delete the benchmark the
    # crime card depends on; the card degrades to an unbenchmarked count only if
    # there was never one.
    (tmp_path / "baselines.json").write_text(json.dumps({
        "generated": "2026-01-01",
        "crime": {"median": 16, "p25": 2, "p75": 77, "p90": 236, "period": "2025-10..2025-12"},
    }))
    out = baselines.build(tmp_path, "2026-08-05", log=lambda *_: None, with_crime=False)
    assert out["crime"]["median"] == 16
    assert out["crime"]["period"] == "2025-10..2025-12"
    assert out["generated"] == "2026-08-05"


def test_validate_flags_a_bad_shard(tmp_path):
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "SW.json").write_text(json.dumps({
        "_v": 1, "_fields": ["a", "b"], "NOTAPOSTCODE": [1, 2],
    }))
    errors = validate.validate_pack("broken", tmp_path)
    assert any("is not a postcode" in e for e in errors)

    (tmp_path / "broken" / "SW.json").write_text(json.dumps({
        "_v": 1, "_fields": ["a", "b"], "SW111AA": [1],
    }))
    errors = validate.validate_pack("broken", tmp_path)
    assert any("expected 2" in e for e in errors)
