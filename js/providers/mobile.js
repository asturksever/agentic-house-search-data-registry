// Mobile and 5G — Ofcom Connected Nations predicted coverage, per postcode.

import { fact, result, finish, fmt } from '../facts.js';
import { loadPack, notBuilt } from './_pack.js';
import { noteFailure } from './_util.js';

const SOURCE = 'ofcom-broadband';
const CHECKER = { label: 'Check this postcode on the Ofcom mobile checker', url: 'https://checker.ofcom.org.uk/' };

export default {
  id: 'mobile',
  label: 'Mobile and 5G',
  registryIds: [SOURCE],

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'pack' });

    let pack;
    try {
      pack = await loadPack('mobile', place.area);
    } catch (err) {
      noteFailure(res, SOURCE, 'mobile coverage extract', err);
      return finish(res);
    }
    if (!pack) return finish(notBuilt(res, 'Ofcom mobile coverage', CHECKER));

    const row = pack.get(place.compact);
    if (!row) {
      res.notes.push('This postcode is not in the Ofcom mobile coverage file.');
      res.alt = CHECKER;
      return finish(res);
    }

    const geography = { level: 'Postcode', code: place.compact, name: place.postcode };
    const period = pack.generated ? `Ofcom extract, ${pack.generated}` : 'Ofcom Connected Nations';
    const note = pack.exact(place.compact) ? null
      : 'Not listed individually in the extract; showing the typical value for this postcode area.';

    const operators = (key, label, value, extra) => {
      if (typeof value !== 'number') return;
      res.facts.push(fact({
        key, label, value, display: `${value} of 4`, kind: 'count', geography, period,
        sourceId: SOURCE, note: extra || note,
      }));
    };

    operators('mobile.5g_outdoor_operators', 'Operators with 5G outdoors', row.g5_out);
    operators('mobile.5g_indoor_operators', 'Operators with 5G indoors', row.g5_in);
    operators('mobile.4g_outdoor_operators', 'Operators with 4G outdoors', row.g4_out);
    operators('mobile.4g_indoor_operators', 'Operators with 4G indoors', row.g4_in,
      'Indoor coverage is modelled, and thick walls beat the model.');

    res.notes.push('Ofcom coverage is predicted from operator network models rather than measured at the door, so treat it as a strong indication rather than a guarantee.');
    return finish(res);
  },
};
