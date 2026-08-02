// Environment and planning constraints — the things that constrain what you can
// do with a property, plus whether the Environment Agency currently has a flood
// warning in force nearby.

import { getJSON } from '../fetchx.js';
import { fact, result, finish, fmt } from '../facts.js';
import { noteFailure } from './_util.js';

const PLANNING = 'planning-data';
const FLOOD = 'ea-flood';

// Point-in-polygon lookups. `field=` keeps the multi-megabyte geometry out of
// the response.
const DATASETS = [
  ['flood-risk-zone', 'Flood risk zone'],
  ['conservation-area', 'Conservation area'],
  ['green-belt', 'Green belt'],
  ['article-4-direction-area', 'Article 4 direction'],
  ['ancient-woodland', 'Ancient woodland'],
  ['site-of-special-scientific-interest', 'SSSI'],
  ['area-of-outstanding-natural-beauty', 'National landscape (AONB)'],
  ['national-park', 'National park'],
  ['tree-preservation-zone', 'Tree preservation order'],
];

export default {
  id: 'environment',
  label: 'Environment and planning constraints',
  short: 'Environment',
  registryIds: [PLANNING, FLOOD],

  coverage(place) {
    if (place.country === 'England') return { ok: true };
    return {
      ok: false,
      why: `The Planning Data platform and Environment Agency flood services cover England. ${place.country} publishes equivalent designations through its own planning body.`,
      alt: place.country === 'Wales'
        ? { label: 'Natural Resources Wales flood risk map', url: 'https://naturalresources.wales/flooding/' }
        : place.country === 'Scotland'
          ? { label: 'SEPA flood maps', url: 'https://www.sepa.org.uk/environment/water/flooding/' }
          : { label: 'DAERA flood maps for Northern Ireland', url: 'https://www.infrastructure-ni.gov.uk/articles/flooding-maps' },
    };
  },

  async run(place) {
    const res = result(this.id, this.label, { sources: [PLANNING, FLOOD], mode: 'live' });
    const geography = { level: 'Point', code: null, name: 'the postcode centroid' };

    const params = new URLSearchParams();
    params.set('longitude', place.lng);
    params.set('latitude', place.lat);
    for (const [ds] of DATASETS) params.append('dataset', ds);
    for (const f of ['dataset', 'name', 'reference']) params.append('field', f);
    params.set('limit', '50');

    const [entities, floods] = await Promise.all([
      getJSON(`https://www.planning.data.gov.uk/entity.json?${params}`, { timeout: 12000 })
        .then(d => d.entities || [])
        .catch(err => { noteFailure(res, PLANNING, 'Planning Data platform', err); return null; }),
      getJSON(`https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${place.lat}&long=${place.lng}&dist=10`, { timeout: 10000 })
        .then(d => d.items || [])
        .catch(err => { noteFailure(res, FLOOD, 'EA flood warnings', err); return null; }),
    ]);

    if (entities) {
      const labels = new Map(DATASETS);
      const found = new Map();
      for (const e of entities) {
        const list = found.get(e.dataset) || [];
        list.push(e.name || e.reference);
        found.set(e.dataset, list);
      }

      const flood = found.get('flood-risk-zone');
      res.facts.push(fact({
        key: 'environment.flood_zone', label: 'Flood risk zone',
        value: flood ? flood.join(', ') : 'none',
        display: flood ? flood.join(', ') : 'Not in a mapped flood risk zone',
        kind: 'category', geography, period: 'current', sourceId: PLANNING,
        note: 'Zones 2 and 3 describe river and sea flood risk before defences are taken into account. Surface-water risk is mapped separately.',
      }));

      const others = [...found.entries()].filter(([ds]) => ds !== 'flood-risk-zone');
      res.facts.push(fact({
        key: 'environment.designations', label: 'Planning designations at this point',
        value: others.length,
        display: others.length
          ? others.map(([ds, names]) => `${labels.get(ds)}${names[0] ? ` (${names[0]})` : ''}`).join('; ')
          : 'None recorded',
        kind: 'category', geography, period: 'current', sourceId: PLANNING,
        note: 'Designations such as a conservation area or Article 4 direction restrict permitted development.',
      }));
    }

    if (floods) {
      const severe = floods.filter(f => (f.severityLevel ?? 4) <= 2);
      res.facts.push(fact({
        key: 'environment.flood_warnings', label: 'Flood warnings in force within 10 km',
        value: floods.length,
        display: floods.length
          ? `${fmt.num(floods.length)} (${severe.length} warning${severe.length === 1 ? '' : 's'}, rest alerts)`
          : 'None right now',
        kind: 'count', geography, period: 'live', sourceId: FLOOD,
        note: 'A live snapshot, not a measure of long-term risk.',
      }));
    }

    return finish(res);
  },
};
