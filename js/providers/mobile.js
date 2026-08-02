// Mobile and 5G — Ofcom Connected Nations.
//
// Ofcom publishes fixed broadband down to the postcode but mobile coverage only
// at local-authority and constituency level, so this card describes the whole
// local authority and says so rather than implying doorstep precision.

import { fact, result, finish, fmt } from '../facts.js';
import { loadRaw, notBuilt } from './_pack.js';
import { noteFailure } from './_util.js';

const SOURCE = 'ofcom-broadband';
const CHECKER = { label: 'Check this postcode on the Ofcom mobile checker', url: 'https://checker.ofcom.org.uk/' };

// [pack field, fact key, table label, short name for prose]
const MEASURES = [
  ['g5_out_all', 'mobile.5g_outdoor_all_pct', 'Premises with outdoor 5G from all four operators', '5G outdoors from all four operators'],
  ['g5_out_any', 'mobile.5g_outdoor_any_pct', 'Premises with outdoor 5G from at least one operator', '5G outdoors from at least one'],
  ['g4_in_all', 'mobile.4g_indoor_all_pct', 'Premises with indoor 4G from all four operators', '4G indoors from all four'],
  ['g4_in_any', 'mobile.4g_indoor_any_pct', 'Premises with indoor 4G from at least one operator', '4G indoors from at least one'],
];

export default {
  id: 'mobile',
  label: 'Mobile and 5G',
  short: 'Mobile & 5G',
  registryIds: [SOURCE],
  // Named in the card title too, so nobody reads a local-authority figure as a
  // doorstep one.
  labelFor: place => `Mobile and 5G in ${place.district.name}`,

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'pack' });

    let pack;
    try {
      pack = await loadRaw('mobile', 'all');
    } catch (err) {
      noteFailure(res, SOURCE, 'mobile coverage extract', err);
      return finish(res);
    }
    if (!pack) return finish(notBuilt(res, 'Ofcom mobile coverage', CHECKER));

    const row = pack.areas?.[place.district.code];
    if (!row) {
      res.notes.push(`Ofcom's mobile file does not include ${place.district.name}.`);
      res.alt = CHECKER;
      return finish(res);
    }

    const fields = pack._fields || [];
    const geography = { level: 'Local authority', code: place.district.code, name: place.district.name };
    const period = pack._generated ? `Ofcom extract, ${pack._generated}` : 'Ofcom Connected Nations';

    for (const [field, key, label, shortLabel] of MEASURES) {
      const value = row[fields.indexOf(field)];
      if (typeof value !== 'number') continue;
      res.facts.push(fact({
        key, label, shortLabel, value, display: fmt.pct(value), kind: 'percent', unit: '%',
        geography, period, sourceId: SOURCE,
      }));
    }

    res.notes.push(`These figures cover the whole of ${place.district.name}, not this street: Ofcom only publishes mobile coverage at local-authority level. They are also predicted from operator network models rather than measured at the door, and thick walls beat the model.`);
    return finish(res);
  },
};
