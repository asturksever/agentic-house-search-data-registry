// Helpers shared by providers.

/** Great-circle distance in metres. */
export function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A lat/lng box roughly `metres` on each side, for APIs that take a polygon. */
export function box(lat, lng, metres) {
  const dLat = metres / 111320;
  const dLng = metres / (111320 * Math.cos(lat * Math.PI / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

export function monthsAgo(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Record a failed source on a CategoryResult without losing what did work. */
export function noteFailure(res, sourceId, label, err) {
  res.errors.push({ sourceId, label, message: err?.message || String(err) });
}
