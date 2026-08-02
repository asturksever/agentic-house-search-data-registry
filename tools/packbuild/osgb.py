"""OSGB36 easting/northing → WGS84 latitude/longitude.

GIAS publishes grid references, the report measures distances in lat/lng, and
pulling in pyproj for one conversion is not worth it. This is the standard
Ordnance Survey reverse-projection plus a Helmert transform, good to a few
metres — far tighter than anything a "nearest school" distance needs.
"""
from __future__ import annotations

import math

# Airy 1830 (OSGB36) and the National Grid projection.
A, B = 6377563.396, 6356256.909
F0 = 0.9996012717
LAT0, LON0 = math.radians(49), math.radians(-2)
N0, E0 = -100000.0, 400000.0
E2 = 1 - (B * B) / (A * A)
N = (A - B) / (A + B)

# Helmert OSGB36 → WGS84.
TX, TY, TZ = 446.448, -125.157, 542.060
RX, RY, RZ = [math.radians(v / 3600) for v in (0.1502, 0.2470, 0.8421)]
S = 20.4894e-6

WGS_A, WGS_B = 6378137.000, 6356752.3141
WGS_E2 = 1 - (WGS_B * WGS_B) / (WGS_A * WGS_A)


def _grid_to_airy(easting: float, northing: float) -> tuple[float, float]:
    lat = LAT0
    m = 0.0
    while abs(northing - N0 - m) >= 0.00001:
        lat += (northing - N0 - m) / (A * F0)
        dlat, slat = lat - LAT0, lat + LAT0
        ma = (1 + N + 1.25 * N**2 + 1.25 * N**3) * dlat
        mb = (3 * N + 3 * N**2 + 2.625 * N**3) * math.sin(dlat) * math.cos(slat)
        mc = (1.875 * N**2 + 1.875 * N**3) * math.sin(2 * dlat) * math.cos(2 * slat)
        md = (35 / 24) * N**3 * math.sin(3 * dlat) * math.cos(3 * slat)
        m = B * F0 * (ma - mb + mc - md)

    sin_lat, cos_lat, tan_lat = math.sin(lat), math.cos(lat), math.tan(lat)
    nu = A * F0 / math.sqrt(1 - E2 * sin_lat**2)
    rho = A * F0 * (1 - E2) / (1 - E2 * sin_lat**2) ** 1.5
    eta2 = nu / rho - 1

    vii = tan_lat / (2 * rho * nu)
    viii = tan_lat / (24 * rho * nu**3) * (5 + 3 * tan_lat**2 + eta2 - 9 * tan_lat**2 * eta2)
    ix = tan_lat / (720 * rho * nu**5) * (61 + 90 * tan_lat**2 + 45 * tan_lat**4)
    x = 1 / (cos_lat * nu)
    xi = 1 / (cos_lat * 6 * nu**3) * (nu / rho + 2 * tan_lat**2)
    xii = 1 / (cos_lat * 120 * nu**5) * (5 + 28 * tan_lat**2 + 24 * tan_lat**4)
    xiia = 1 / (cos_lat * 5040 * nu**7) * (61 + 662 * tan_lat**2 + 1320 * tan_lat**4 + 720 * tan_lat**6)

    de = easting - E0
    lat = lat - vii * de**2 + viii * de**4 - ix * de**6
    lon = LON0 + x * de - xi * de**3 + xii * de**5 - xiia * de**7
    return lat, lon


def _helmert(lat: float, lon: float) -> tuple[float, float]:
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)
    sin_lon, cos_lon = math.sin(lon), math.cos(lon)
    nu = A / math.sqrt(1 - E2 * sin_lat**2)

    x1 = nu * cos_lat * cos_lon
    y1 = nu * cos_lat * sin_lon
    z1 = (1 - E2) * nu * sin_lat

    x2 = TX + x1 * (1 + S) - y1 * RZ + z1 * RY
    y2 = TY + x1 * RZ + y1 * (1 + S) - z1 * RX
    z2 = TZ - x1 * RY + y1 * RX + z1 * (1 + S)

    lon2 = math.atan2(y2, x2)
    p = math.sqrt(x2**2 + y2**2)
    lat2 = math.atan2(z2, p * (1 - WGS_E2))
    for _ in range(10):
        nu2 = WGS_A / math.sqrt(1 - WGS_E2 * math.sin(lat2) ** 2)
        next_lat = math.atan2(z2 + WGS_E2 * nu2 * math.sin(lat2), p)
        if abs(next_lat - lat2) < 1e-12:
            lat2 = next_lat
            break
        lat2 = next_lat
    return math.degrees(lat2), math.degrees(lon2)


def to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    lat, lon = _grid_to_airy(float(easting), float(northing))
    return _helmert(lat, lon)
