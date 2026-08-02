// Noise — Defra strategic noise mapping (Round 4), sampled at the postcode.

import { fact, result, finish, fmt } from '../facts.js';
import { loadPack, notBuilt } from './_pack.js';
import { noteFailure } from './_util.js';

const SOURCE = 'defra-noise';
const VIEWER = { label: 'Defra strategic noise map viewer', url: 'https://environment.data.gov.uk/dataset/562c9d56-7c2d-4d42-83bb-578d6e97a517' };

export default {
  id: 'noise',
  label: 'Noise',
  short: 'Noise',
  registryIds: [SOURCE],

  coverage(place) {
    if (place.country === 'England') return { ok: true };
    return {
      ok: false,
      why: `Defra's strategic noise mapping covers England. ${place.country} maps noise under the same EU directive through its own agency.`,
      alt: place.country === 'Wales'
        ? { label: 'Natural Resources Wales noise maps', url: 'https://naturalresources.wales/evidence-and-data/maps/noise-maps/' }
        : place.country === 'Scotland'
          ? { label: 'Scottish noise mapping', url: 'https://noise.environment.gov.scot/' }
          : { label: 'Northern Ireland strategic noise maps (DAERA)', url: 'https://www.daera-ni.gov.uk/articles/strategic-noise-mapping' },
    };
  },

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'pack' });

    let pack;
    try {
      pack = await loadPack('noise', place.area);
    } catch (err) {
      noteFailure(res, SOURCE, 'noise extract', err);
      return finish(res);
    }
    if (!pack) return finish(notBuilt(res, 'Defra noise mapping', VIEWER));

    const row = pack.get(place.compact);
    if (!row) {
      res.notes.push('This postcode falls outside the mapped areas. Defra maps noise around major roads, railways, airports and large urban areas — everywhere else is simply not surveyed, which usually means quiet.');
      res.alt = VIEWER;
      return finish(res);
    }

    const geography = { level: 'Postcode', code: place.compact, name: place.postcode };
    const period = pack.generated ? `Defra Round 4 (2022), extracted ${pack.generated}` : 'Defra Round 4 (2022)';

    const band = (key, label, value, note) => {
      if (typeof value !== 'number') return;
      res.facts.push(fact({
        key, label, value, display: `${fmt.num(value)} dB`, kind: 'index', unit: 'dB',
        geography, period, sourceId: SOURCE, note,
      }));
    };

    band('noise.road_lden', 'Road noise, day-evening-night (Lden)', row.road_lden,
      'Lden weights evening and night noise more heavily than daytime. Around 55 dB is a quiet suburban street; 70 dB is a busy main road.');
    band('noise.road_lnight', 'Road noise at night (Lnight)', row.road_lnight);
    band('noise.rail_lden', 'Railway noise (Lden)', row.rail_lden);
    band('noise.air_lden', 'Aircraft noise (Lden)', row.air_lden);

    if (!res.facts.length) {
      res.notes.push('No noise contour covers this postcode, which means it sits outside the mapped major-source areas.');
    }
    return finish(res);
  },
};
