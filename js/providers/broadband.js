// Fixed broadband — Ofcom Connected Nations, per postcode, from a pre-built extract.

import { fact, result, finish, fmt } from '../facts.js';
import { loadPack, notBuilt } from './_pack.js';
import { noteFailure } from './_util.js';

const SOURCE = 'ofcom-broadband';
const CHECKER = { label: 'Check this postcode on the Ofcom broadband checker', url: 'https://checker.ofcom.org.uk/' };

export default {
  id: 'broadband',
  label: 'Broadband and fibre',
  registryIds: [SOURCE],

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'pack' });

    let pack;
    try {
      pack = await loadPack('broadband', place.area);
    } catch (err) {
      noteFailure(res, SOURCE, 'broadband extract', err);
      return finish(res);
    }
    if (!pack) return finish(notBuilt(res, 'Ofcom broadband', CHECKER));

    const row = pack.get(place.compact);
    if (!row) {
      res.notes.push('This postcode is not in the Ofcom coverage file — new-build and business-only postcodes often are not.');
      res.alt = CHECKER;
      return finish(res);
    }

    const geography = { level: 'Postcode', code: place.compact, name: place.postcode };
    const period = pack.generated ? `Ofcom extract, ${pack.generated}` : 'Ofcom Connected Nations';
    const exact = pack.exact(place.compact);
    const note = exact ? null
      : 'Not listed individually in the extract; showing the typical value for this postcode area.';

    const pct = (key, label, value) => {
      if (typeof value !== 'number') return;
      res.facts.push(fact({ key, label, value, display: fmt.pct(value), kind: 'percent',
        unit: '%', geography, period, sourceId: SOURCE, note }));
    };

    pct('broadband.gigabit_pct', 'Premises with gigabit-capable broadband', row.gigabit);
    pct('broadband.fttp_pct', 'Premises with full fibre (FTTP)', row.fttp);
    pct('broadband.sfbb_pct', 'Premises with superfast (30 Mbit/s+)', row.sfbb);

    if (typeof row.down === 'number') {
      res.facts.push(fact({
        key: 'broadband.max_download', label: 'Maximum available download speed',
        value: row.down, display: `${fmt.num(row.down)} Mbit/s`, kind: 'rate', unit: 'Mbit/s',
        geography, period, sourceId: SOURCE,
        note: note || 'The fastest package available, not the speed any particular property is buying.',
      }));
    }
    if (typeof row.uso === 'number' && row.uso > 0) {
      res.facts.push(fact({
        key: 'broadband.uso_premises', label: 'Premises below the Universal Service Obligation',
        value: row.uso, display: fmt.num(row.uso), kind: 'count', geography, period, sourceId: SOURCE,
        note: 'These premises cannot get 10 Mbit/s down and 1 Mbit/s up, which triggers a right to request a connection.',
      }));
    }

    return finish(res);
  },
};
