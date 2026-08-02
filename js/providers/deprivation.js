// Deprivation. postcodes.io already returned the rank, so this costs no request.
//
// Each UK nation publishes its own index over its own set of small areas — they
// are not comparable with each other, so the decile is always computed against
// the right denominator and labelled with the index it came from.

import { fact, result, finish, fmt } from '../facts.js';

const SOURCE = 'imd';

const INDEX = {
  England: { name: 'Index of Multiple Deprivation 2019', areas: 32844, unit: 'LSOAs',
             short: 'IMD 2019', sourceId: 'imd' },
  Wales: { name: 'Welsh Index of Multiple Deprivation 2019', areas: 1909, unit: 'LSOAs',
           short: 'WIMD 2019', sourceId: 'imd',
           link: { label: 'Welsh Index of Multiple Deprivation', url: 'https://www.gov.wales/welsh-index-multiple-deprivation' } },
  Scotland: { name: 'Scottish Index of Multiple Deprivation 2020', areas: 6976, unit: 'data zones',
              short: 'SIMD 2020', sourceId: 'imd',
              link: { label: 'Scottish Index of Multiple Deprivation', url: 'https://www.gov.scot/collections/scottish-index-of-multiple-deprivation-2020/' } },
  'Northern Ireland': { name: 'NI Multiple Deprivation Measure 2017', areas: 890, unit: 'super output areas',
              short: 'NIMDM 2017', sourceId: 'imd',
              link: { label: 'NI Multiple Deprivation Measure', url: 'https://www.nisra.gov.uk/statistics/deprivation' } },
};

export default {
  id: 'deprivation',
  label: 'Deprivation',
  registryIds: [SOURCE],

  coverage(place) {
    if (!INDEX[place.country]) {
      return { ok: false, why: `No deprivation index is available for ${place.country}.` };
    }
    if (place.imdRank == null) {
      return { ok: false, why: 'No deprivation rank is published for this postcode.' };
    }
    return { ok: true };
  },

  async run(place) {
    const idx = INDEX[place.country];
    const res = result(this.id, this.label, {
      sources: [SOURCE], mode: 'live',
      alt: idx.link || null,
    });

    const rank = place.imdRank;
    // Rank 1 is the most deprived area; decile 1 is the most deprived tenth.
    const decile = Math.min(10, Math.ceil((rank / idx.areas) * 10));
    const geography = { level: 'Neighbourhood (LSOA)', code: place.lsoa.code, name: place.lsoa.name };

    res.facts.push(fact({
      key: 'deprivation.imd_decile', label: 'Deprivation decile', value: decile,
      display: `${decile} of 10`, kind: 'decile', geography, period: idx.short,
      sourceId: SOURCE,
      note: 'Decile 1 is the most deprived tenth of neighbourhoods, decile 10 the least.',
    }));

    res.facts.push(fact({
      key: 'deprivation.imd_rank', label: 'Rank', value: rank,
      display: `${fmt.num(rank)} of ${fmt.num(idx.areas)}`, kind: 'rank',
      geography, period: idx.short, sourceId: SOURCE,
      note: `Ranked against every one of the ${fmt.num(idx.areas)} ${idx.unit} in ${place.country}.`,
    }));

    res.notes.push(`Figures come from the ${idx.name}; each UK nation ranks its own areas, so these ranks are not comparable across nations.`);
    return finish(res);
  },
};
