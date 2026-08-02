// Fixed broadband — Ofcom Connected Nations, per postcode, from a pre-built extract.

import { getJSON } from '../fetchx.js';
import { fact, result, finish, fmt } from '../facts.js';
import { loadPack, notBuilt, PACKS_BASE } from './_pack.js';
import { noteFailure } from './_util.js';

const SOURCE = 'ofcom-broadband';
const CHECKER = { label: 'Check this postcode on the Ofcom broadband checker', url: 'https://checker.ofcom.org.uk/' };

// [pack field, fact key, table label, short name for prose]
const MEASURES = [
  ['gigabit', 'broadband.gigabit_pct', 'Premises able to get gigabit broadband', 'gigabit'],
  ['ufbb', 'broadband.ufbb_pct', 'Premises able to get ultrafast (300 Mbit/s+)', 'ultrafast'],
  ['sfbb', 'broadband.sfbb_pct', 'Premises able to get superfast (30 Mbit/s+)', 'superfast'],
];

export default {
  id: 'broadband',
  label: 'Broadband and fibre',
  short: 'Broadband',
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

    // National means come from the same extract, so a benchmark can never
    // describe a different vintage from the value beside it.
    const uk = await getJSON(`${PACKS_BASE}/baselines.json`).catch(() => null);

    const geography = { level: 'Postcode', code: place.compact, name: place.postcode };
    const period = pack.generated ? `Ofcom extract, ${pack.generated}` : 'Ofcom Connected Nations';
    const exact = pack.exact(place.compact);
    const note = exact ? null
      : 'This postcode shares the most common values for its area rather than being listed separately.';

    for (const [field, key, label, shortLabel] of MEASURES) {
      const value = row[field];
      if (typeof value !== 'number') continue;
      const mean = uk?.broadband?.[field]?.mean;
      res.facts.push(fact({
        key, label, shortLabel, value, display: fmt.pct(value), kind: 'percent', unit: '%',
        geography, period, sourceId: SOURCE, note,
        benchmarks: typeof mean === 'number'
          ? [{ scope: 'uk', name: 'UK average', value: mean, display: fmt.pct(mean, 1) }]
          : [],
      }));
    }

    if (typeof row.uso === 'number') {
      res.facts.push(fact({
        key: 'broadband.uso_pct', label: 'Premises below the Universal Service Obligation',
        value: row.uso, display: fmt.pct(row.uso), kind: 'percent', unit: '%',
        geography, period, sourceId: SOURCE,
        note: 'These premises cannot get 10 Mbit/s down and 1 Mbit/s up, which gives a right to request a connection.',
      }));
    }

    res.notes.push('Availability is what can be ordered at the address, not what any particular property is currently paying for.');
    return finish(res);
  },
};
