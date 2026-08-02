// Schools — the DfE register (GIAS) with Ofsted grades, from a pre-built extract.
//
// Distance here is straight-line and says nothing about admission: a school
// 300 m away can still be out of catchment. The card says so.

import { fact, result, finish, fmt } from '../facts.js';
import { loadRaw, notBuilt } from './_pack.js';
import { haversine, noteFailure } from './_util.js';

const GIAS = 'gias';
const OFSTED = 'ofsted';
const FINDER = { label: 'Find and compare schools in England (DfE)', url: 'https://www.compare-school-performance.service.gov.uk/' };
const RADIUS_M = 2000;

export default {
  id: 'schools',
  label: 'Schools',
  short: 'Schools',
  registryIds: [GIAS, OFSTED],

  coverage(place) {
    if (place.country === 'England') return { ok: true };
    return {
      ok: false,
      why: `GIAS and Ofsted cover England. ${place.country} inspects and publishes school data through its own body.`,
      alt: place.country === 'Wales'
        ? { label: 'Estyn inspection reports (Wales)', url: 'https://www.estyn.gov.wales/' }
        : place.country === 'Scotland'
          ? { label: 'Education Scotland inspection reports', url: 'https://education.gov.scot/' }
          : { label: 'Education and Training Inspectorate (NI)', url: 'https://www.etini.gov.uk/' },
    };
  },

  async run(place) {
    const res = result(this.id, this.label, { sources: [GIAS, OFSTED], mode: 'pack' });

    let shard;
    try {
      shard = await loadRaw('schools', place.area);
    } catch (err) {
      noteFailure(res, GIAS, 'schools extract', err);
      return finish(res);
    }
    if (!shard) return finish(notBuilt(res, 'school register', FINDER));

    const all = (shard.schools || []).map(s => ({
      ...s, distance: haversine(place.lat, place.lng, s.lat, s.lng),
    })).filter(s => s.distance <= RADIUS_M).sort((a, b) => a.distance - b.distance);

    if (!all.length) {
      res.notes.push(`No schools are recorded within ${RADIUS_M / 1000} km of this postcode.`);
      res.alt = FINDER;
      return finish(res);
    }

    const geography = { level: 'Area', code: null, name: `within ${RADIUS_M / 1000} km` };
    const period = shard.generated ? `GIAS/Ofsted extract, ${shard.generated}` : 'GIAS/Ofsted';

    for (const [phase, key, label] of [
      ['primary', 'schools.nearest_primary_m', 'Nearest primary school'],
      ['secondary', 'schools.nearest_secondary_m', 'Nearest secondary school'],
    ]) {
      const hit = all.find(s => s.phase === phase);
      if (!hit) continue;
      res.facts.push(fact({
        key, label, value: Math.round(hit.distance), display: fmt.metres(hit.distance),
        kind: 'distance_m', unit: 'm', geography, period, sourceId: GIAS,
        note: `${hit.name}${hit.ofsted ? ` — Ofsted: ${hit.ofsted}` : ''}. Straight-line distance; catchment is decided by the admissions authority, not by distance alone.`,
      }));
    }

    const graded = all.filter(s => s.ofsted);
    if (graded.length) {
      const good = graded.filter(s => /outstanding|good/i.test(s.ofsted)).length;
      res.facts.push(fact({
        key: 'schools.good_or_better_2km', label: 'Rated Good or Outstanding',
        value: good, display: `${good} of ${graded.length}`, kind: 'count',
        geography, period, sourceId: OFSTED,
        note: 'Ofsted grades are a snapshot from the last inspection, which may be several years old.',
      }));
    }

    res.facts.push(fact({
      key: 'schools.count_2km', label: 'Schools within 2 km', value: all.length,
      display: fmt.num(all.length), kind: 'count', geography, period, sourceId: GIAS,
    }));

    return finish(res);
  },
};
