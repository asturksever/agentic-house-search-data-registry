// What is within walking distance, from OpenStreetMap via Overpass.

import { fact, result, finish, fmt } from '../facts.js';
import { nearby, pick } from './_overpass.js';
import { noteFailure } from './_util.js';

const SOURCE = 'osm-overpass';
const WALK_M = 1000;

const NEAREST = [
  ['supermarket', 'amenities.nearest_supermarket_m', 'Nearest supermarket'],
  ['pharmacy', 'amenities.nearest_pharmacy_m', 'Nearest pharmacy'],
  ['gp', 'amenities.nearest_gp_m', 'Nearest GP surgery'],
  ['park', 'amenities.nearest_park_m', 'Nearest park or green space'],
  ['school', 'amenities.nearest_school_m', 'Nearest school'],
];

const COUNTS = [
  ['convenience', 'amenities.convenience_1km', 'Convenience stores'],
  ['cafe', 'amenities.cafes_1km', 'Cafés'],
  ['pub', 'amenities.pubs_1km', 'Pubs'],
  ['gym', 'amenities.gyms_1km', 'Gyms and sports centres'],
];

export default {
  id: 'amenities',
  label: 'Amenities within walking distance',
  registryIds: [SOURCE],

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'live' });
    const geography = { level: 'Area', code: null, name: 'around the postcode' };

    let items;
    try {
      items = await nearby(place);
    } catch (err) {
      noteFailure(res, SOURCE, 'Overpass (OpenStreetMap)', err);
      res.notes.push('OpenStreetMap\'s Overpass API is volunteer-run and rate-limited; it did not answer this time.');
      return finish(res);
    }

    for (const [kind, key, label] of NEAREST) {
      const hit = pick(items, kind)[0];
      if (!hit) continue;
      res.facts.push(fact({
        key, label, value: Math.round(hit.distance), display: fmt.metres(hit.distance),
        kind: 'distance_m', unit: 'm', geography, period: 'current OSM data',
        sourceId: SOURCE,
        note: hit.name ? `${hit.name} — straight-line distance, not walking route.` : 'Straight-line distance, not walking route.',
      }));
    }

    for (const [kind, key, label] of COUNTS) {
      const n = pick(items, kind, WALK_M).length;
      res.facts.push(fact({
        key, label, value: n, display: fmt.num(n), kind: 'count', geography,
        period: 'current OSM data', sourceId: SOURCE,
        note: `Within ${WALK_M} m.`,
      }));
    }

    res.notes.push('OpenStreetMap is crowd-sourced: it is usually good on shops and green space, and can be patchy on services that rarely get mapped.');
    return finish(res);
  },
};
