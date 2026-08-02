// Census 2021 (ONS, via Nomis) — who lives in this neighbourhood.

import { fact, result, finish, fmt } from '../facts.js';
import { fetchTable, geographiesFor, TABLES, ENGLAND_AND_WALES } from './_nomis.js';
import { noteFailure } from './_util.js';

const SOURCE = 'ons-census-2021';

export default {
  id: 'demographics',
  label: 'Who lives here',
  registryIds: [SOURCE],

  coverage(place) {
    if (place.country === 'England' || place.country === 'Wales') return { ok: true };
    const alt = place.country === 'Scotland'
      ? { label: "Scotland's Census 2022 (National Records of Scotland)", url: 'https://www.scotlandscensus.gov.uk/' }
      : { label: 'NISRA Census 2021 (Northern Ireland)', url: 'https://www.nisra.gov.uk/statistics/census' };
    return {
      ok: false,
      why: `Census tables on Nomis cover England and Wales only. ${place.country} runs its own census, published separately.`,
      alt,
    };
  },

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'live' });
    const geogs = geographiesFor(place);
    const lsoa = place.lsoa.code, lad = place.district.code, ew = ENGLAND_AND_WALES;
    const geography = { level: 'Neighbourhood (LSOA)', code: lsoa, name: place.lsoa.name };
    const period = 'Census 2021';

    const [pop, age, tenure, quals] = await Promise.all(
      [TABLES.population, TABLES.age, TABLES.tenure, TABLES.quals].map(t =>
        fetchTable(t, geogs).catch(err => { noteFailure(res, SOURCE, t.name, err); return null; })));

    const share = (row, key) => (row && row.total ? (row[key] / row.total) * 100 : null);
    const pctFact = (key, label, rows, cell) => {
      const here = share(rows[lsoa], cell);
      if (here == null) return;
      const benchmarks = [];
      const la = share(rows[lad], cell), nat = share(rows[ew], cell);
      if (la != null) benchmarks.push({ scope: 'local_authority', name: place.district.name, value: la, display: fmt.pct(la) });
      if (nat != null) benchmarks.push({ scope: 'england_wales', name: 'England & Wales', value: nat, display: fmt.pct(nat) });
      res.facts.push(fact({ key, label, value: here, display: fmt.pct(here), kind: 'percent',
        unit: '%', geography, period, benchmarks, sourceId: SOURCE }));
    };

    if (pop && pop[lsoa]) {
      res.facts.push(fact({
        key: 'demographics.population', label: 'Usual residents',
        value: pop[lsoa].total, display: fmt.num(pop[lsoa].total), kind: 'count',
        geography, period, sourceId: SOURCE,
        note: 'An LSOA is a neighbourhood of roughly 1,500 people, not the postcode itself.',
      }));
    }
    if (age) {
      pctFact('demographics.age_over65_pct', 'Aged 65 and over', age, 'over65');
      pctFact('demographics.age_under16_pct', 'Aged under 16', age, 'under16');
    }
    if (tenure) {
      pctFact('demographics.tenure_owned_pct', 'Households that own their home', tenure, 'owned');
      pctFact('demographics.tenure_private_rent_pct', 'Households privately renting', tenure, 'privateRent');
      pctFact('demographics.tenure_social_pct', 'Households in social housing', tenure, 'social');
    }
    if (quals) {
      pctFact('demographics.quals_level4_pct', 'Adults with a degree-level qualification', quals, 'level4plus');
    }

    return finish(res);
  },
};
