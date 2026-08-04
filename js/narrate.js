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
  broadband: ['broadband.gigabit_pct', 'broadband.ufbb_pct', 'broadband.sfbb_pct'],
  mobile: ['mobile.5g_outdoor_all_pct', 'mobile.5g_outdoor_any_pct', 'mobile.4g_indoor_all_pct'],
  noise: ['noise.road_lden', 'noise.rail_lden', 'noise.air_lden'],
  transport: ['transport.nearest_station_m', 'transport.tfl_nearest', 'transport.bus_stops_800m'],
  amenities: ['amenities.nearest_supermarket_m', 'amenities.nearest_park_m', 'amenities.nearest_gp_m'],
  schools: ['schools.nearest_primary_m', 'schools.good_or_better_2km'],
  environment: ['environment.flood_zone', 'environment.designations', 'environment.flood_warnings'],
};

/** The fact a summary tile should lead with. */
export function headlineFact(res) {
  return order(res)[0] || null;
}

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
  if (c && c.vs && c.phrasing !== 'clause') {
    const bench = f.benchmarks.find(b => b.scope === c.vs);
    return `${f.label} is ${f.display}, ${c.band} the ${c.vsName || c.vs} figure of ${benchDisplay(bench)}.`;
  }
  if (c && c.band) {
    // A band written as a complete clause reads as an apposition, with the
    // benchmark parenthesised rather than threaded through the sentence.
    const bench = c.vs && f.benchmarks.find(b => b.scope === c.vs);
    return bench
      ? `${f.label} is ${f.display} — ${c.band} (${c.vsName || c.vs}: ${benchDisplay(bench)}).`
      : `${f.label} is ${f.display} — ${c.band}.`;
  }
  return `${f.label}: ${f.display}.`;
}

const sentenceCase = s => s.charAt(0).toUpperCase() + s.slice(1);

const listOf = items => items.length > 1
  ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  : items[0];

// Labels are written for a table, so they start capitalised. Mid-sentence they
// should not — unless the label opens with an acronym or a proper noun ("5G
// outdoors", "TfL station"), which the second character gives away.
const midSentence = label =>
  /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;

// Three sentences that all end "...above the UK average" is three times the
// words for one idea. Facts landing in the same band against the same
// benchmark collapse into one sentence — each keeping its own figure, so
// nothing in the prose stops being checkable against the table.
function merge(facts) {
  const out = [];
  let i = 0;
  while (i < facts.length) {
    const f = facts[i];
    const c = f.comparison;
    const group = [f];
    if (c?.band) {
      while (i + 1 < facts.length) {
        const next = facts[i + 1].comparison;
        if (!next || next.band !== c.band || next.vs !== c.vs) break;
        group.push(facts[++i]);
      }
    }
    i++;

    if (group.length === 1) {
      out.push(sentence(f));
      continue;
    }
    const parts = listOf(group.map(g => `${midSentence(g.shortLabel || g.label)} (${g.display})`));
    const quantifier = group.length === 2 ? 'both' : 'all';
    out.push(c.vs
      ? `${parts} are ${quantifier} ${c.band} the ${c.vsName || c.vs}.`
      : `${parts} are ${quantifier} ${c.band}.`);
  }
  return out;
}

/**
 * @param {object} opts.skipNotes  caveats are rendered separately by the card,
 *   so the opening paragraph stays about the figures
 */
export function narrate(res, place, opts = {}) {
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

  const lines = merge(facts).map(sentenceCase);
  if (opts.skipNotes) return lines.join(' ');

  const extras = [];
  if (res.status === STATUS.PARTIAL) {
    extras.push(`Some figures are missing: ${res.errors.map(e => e.label || e.sourceId).join(', ')} did not respond.`);
  }
  extras.push(...res.notes);

  return [...lines, ...extras].join(' ');
}
