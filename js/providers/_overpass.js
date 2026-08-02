// One Overpass query per report, shared by the amenities and transport cards.
//
// Overpass is a volunteer-run service on a fair-use policy, so the two cards
// that need OpenStreetMap data ask for everything once and split the result.

import { getJSON } from '../fetchx.js';
import { haversine } from './_util.js';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const AMENITY_RADIUS = 1500;
const TRANSPORT_RADIUS = 2000;

const pending = new Map();

function query(lat, lng) {
  const a = `${AMENITY_RADIUS},${lat},${lng}`;
  const t = `${TRANSPORT_RADIUS},${lat},${lng}`;
  return `[out:json][timeout:25];
(
  nwr(around:${a})[shop~"^(supermarket|convenience)$"];
  nwr(around:${a})[amenity~"^(pharmacy|doctors|dentist|school|kindergarten|cafe|pub|restaurant|post_office|library)$"];
  nwr(around:${a})[leisure~"^(park|playground|fitness_centre|sports_centre|nature_reserve)$"];
  nwr(around:${t})[railway~"^(station|halt|tram_stop)$"];
  nwr(around:${t})[station=subway];
  node(around:800,${lat},${lng})[highway=bus_stop];
);
out center tags;`;
}

function place2(el) {
  if (typeof el.lat === 'number') return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}

/** @returns {Promise<Array<{name, kind, tags, distance}>>} sorted by distance */
export function nearby(place) {
  if (pending.has(place.compact)) return pending.get(place.compact);

  const url = `${ENDPOINT}?data=${encodeURIComponent(query(place.lat, place.lng))}`;
  // Overpass sheds load with a 504 when busy, so one retry is worth it.
  const p = getJSON(url, { timeout: 25000, retry: 1 }).then(data => {
    const out = [];
    for (const el of data.elements || []) {
      const pos = place2(el);
      if (!pos) continue;
      const tags = el.tags || {};
      out.push({
        id: `${el.type}/${el.id}`,
        name: tags.name || null,
        tags,
        distance: haversine(place.lat, place.lng, pos[0], pos[1]),
      });
    }
    return out.sort((a, b) => a.distance - b.distance);
  });

  pending.set(place.compact, p);
  return p;
}

export const matchers = {
  supermarket: t => t.shop === 'supermarket',
  convenience: t => t.shop === 'convenience',
  pharmacy: t => t.amenity === 'pharmacy',
  gp: t => t.amenity === 'doctors',
  school: t => t.amenity === 'school',
  nursery: t => t.amenity === 'kindergarten',
  cafe: t => t.amenity === 'cafe',
  pub: t => t.amenity === 'pub',
  restaurant: t => t.amenity === 'restaurant',
  post_office: t => t.amenity === 'post_office',
  library: t => t.amenity === 'library',
  park: t => t.leisure === 'park' || t.leisure === 'nature_reserve',
  playground: t => t.leisure === 'playground',
  gym: t => t.leisure === 'fitness_centre' || t.leisure === 'sports_centre',
  station: t => t.railway === 'station' || t.railway === 'halt' || t.station === 'subway',
  tram: t => t.railway === 'tram_stop',
  bus_stop: t => t.highway === 'bus_stop',
};

export function pick(items, kind, withinM = Infinity) {
  const match = matchers[kind];
  return items.filter(i => match(i.tags) && i.distance <= withinM);
}
