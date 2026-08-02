// Deterministic narrator. Every visitor gets this, with or without an API key.
//
// The one rule that matters: a sentence may only contain a number that is also
// in the fact table rendered beside it. Band words come from thresholds.js and
// always travel next to the figure they describe, so the prose cannot drift.

import { STATUS } from './facts.js';

// Which facts lead a paragraph, when a category has more than we want to say.
const HEADLINE = {
  demographics: ['demographics.population', 'demographics.tenure_owned_pct', 'demographics.quals_level4_pct'],
  crime: ['crime.total_3m'],
  deprivation: ['deprivation.imd_decile', 'deprivation.imd_rank'],
  prices: ['prices.avg_price_district', 'prices.annual_change', 'prices.median_paid'],
  broadband: ['broadband.gigabit_pct', 'broadband.fttp_pct', 'broadband.max_download'],
  mobile: ['mobile.5g_outdoor_operators', 'mobile.4g_indoor_operators'],
  noise: ['noise.road_lden', 'noise.rail_lden', 'noise.air_lden'],
  transport: ['transport.nearest_station_m', 'transport.tfl_nearest', 'transport.bus_stops_800m'],
  amenities: ['amenities.nearest_supermarket_m', 'amenities.nearest_park_m', 'amenities.nearest_gp_m'],
  schools: ['schools.nearest_primary_m', 'schools.good_or_better_2km'],
  environment: ['environment.flood_zone', 'environment.designations', 'environment.flood_warnings'],
};

function order(res) {
  const priority = HEADLINE[res.id] || [];
  const rank = f => {
    const i = priority.indexOf(f.key);
    return i === -1 ? priority.length + (f.comparison ? 0 : 1) : i;
  };
  return [...res.facts].sort((a, b) => rank(a) - rank(b));
}

function benchDisplay(b) {
  return b.display != null ? b.display : String(b.value);
}

function sentence(f) {
  const c = f.comparison;
  if (c && c.vs) {
    const bench = f.benchmarks.find(b => b.scope === c.vs);
    return `${f.label} is ${f.display}, ${c.band} the ${c.vsName || c.vs} figure of ${benchDisplay(bench)}.`;
  }
  if (c && c.band) {
    // Bands written as full clauses ("among the most deprived areas in England")
    // read as a continuation; single words read as an apposition.
    return c.band.includes(' ')
      ? `${f.label} is ${f.display} — ${c.band}.`
      : `${f.label} is ${f.display}, which is ${c.band} for this kind of area.`;
  }
  return `${f.label}: ${f.display}.`;
}

const sentenceCase = s => s.charAt(0).toUpperCase() + s.slice(1);

export function narrate(res, place) {
  void place;
  if (res.status === STATUS.OUT_OF_COVERAGE) {
    return res.notes.join(' ');
  }
  if (res.status === STATUS.UNAVAILABLE || res.status === STATUS.ERROR) {
    const why = res.notes.length ? res.notes.join(' ')
      : 'No data came back from the sources behind this section.';
    return why;
  }

  const facts = order(res).slice(0, 3);
  if (!facts.length) return 'No figures available for this postcode.';

  const lines = facts.map(f => sentenceCase(sentence(f)));

  const extras = [];
  if (res.status === STATUS.PARTIAL) {
    extras.push(`Some figures are missing: ${res.errors.map(e => e.label || e.sourceId).join(', ')} did not respond.`);
  }
  extras.push(...res.notes);

  return [...lines, ...extras].join(' ');
}
