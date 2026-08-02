// Where the judgement lives: how a raw number becomes "well below average".
//
// Every band is data, not prose. The narrator writes the sentence, but the word
// it reaches for comes from here, and the number always travels with it — so a
// paragraph can never say "low" next to a table cell that says otherwise.

// direction: which way is better for a buyer, or 'neutral' for purely
//   descriptive facts (a 34% owner-occupier share is not good or bad).
// baseline: which benchmark scope to compare against when one is present.
// ratioBands: [min, max, word] over value / baseline.
// absBands:  [min, max, word] over the raw value, used when no benchmark exists.
export const THRESHOLDS = {
  'crime.rate_per_1000': {
    direction: 'lower_is_better', baseline: 'england',
    ratioBands: [[0, .7, 'well below'], [.7, .9, 'below'], [.9, 1.1, 'in line with'],
                 [1.1, 1.4, 'above'], [1.4, Infinity, 'well above']],
    absBands: [[0, 40, 'notably low'], [40, 70, 'low'], [70, 110, 'typical'],
               [110, 160, 'high'], [160, Infinity, 'very high']],
  },
  'deprivation.imd_decile': {
    direction: 'higher_is_better', baseline: null,
    // Nation-neutral wording: the fact itself names which index it came from,
    // and the four UK indices are not comparable with each other.
    absBands: [[1, 3, 'among the most deprived fifth of neighbourhoods'],
               [3, 5, 'more deprived than average'],
               [5, 7, 'around the middle of the national ranking'],
               [7, 9, 'less deprived than average'],
               [9, 11, 'among the least deprived fifth of neighbourhoods']],
  },
  'prices.median_paid': {
    direction: 'neutral', baseline: 'local_authority',
    ratioBands: [[0, .75, 'well below'], [.75, .92, 'below'], [.92, 1.08, 'in line with'],
                 [1.08, 1.35, 'above'], [1.35, Infinity, 'well above']],
  },
  'prices.avg_price_district': { direction: 'neutral', baseline: 'england',
    ratioBands: [[0, .75, 'well below'], [.75, .92, 'below'], [.92, 1.08, 'in line with'],
                 [1.08, 1.35, 'above'], [1.35, Infinity, 'well above']] },
  // Coverage percentages saturate at 100, so a ratio against the UK mean is
  // more informative than a ratio against the median (which is usually 100).
  'broadband.gigabit_pct': {
    direction: 'higher_is_better', baseline: 'uk',
    ratioBands: [[0, .5, 'far below'], [.5, .9, 'below'], [.9, 1.05, 'in line with'],
                 [1.05, Infinity, 'above']],
    absBands: [[0, 1, 'no gigabit service'], [1, 50, 'patchy'], [50, 95, 'mostly available'],
               [95, 101, 'available across the postcode']],
  },
  'broadband.ufbb_pct': { direction: 'higher_is_better', baseline: 'uk',
    ratioBands: [[0, .5, 'far below'], [.5, .9, 'below'], [.9, 1.05, 'in line with'],
                 [1.05, Infinity, 'above']],
    absBands: [[0, 1, 'not available'], [1, 50, 'patchy'], [50, 95, 'mostly available'],
               [95, 101, 'available across the postcode']] },
  'broadband.sfbb_pct': { direction: 'higher_is_better', baseline: 'uk',
    ratioBands: [[0, .5, 'far below'], [.5, .9, 'below'], [.9, 1.05, 'in line with'],
                 [1.05, Infinity, 'above']] },
  'mobile.5g_outdoor_all_pct': {
    direction: 'higher_is_better', baseline: null,
    absBands: [[0, 5, 'almost nowhere'], [5, 40, 'patchy'], [40, 80, 'widespread'],
               [80, 101, 'nearly everywhere']],
  },
  'mobile.4g_indoor_all_pct': {
    direction: 'higher_is_better', baseline: null,
    absBands: [[0, 40, 'patchy'], [40, 80, 'widespread'], [80, 101, 'nearly everywhere']],
  },
  'noise.road_lden': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 55, 'quiet for road noise'], [55, 60, 'moderate road noise'],
               [60, 70, 'noticeable road noise'], [70, Infinity, 'high road noise']],
  },
  'amenities.nearest_supermarket_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 400, 'on the doorstep'], [400, 900, 'a short walk'],
               [900, 2000, 'a longer walk'], [2000, Infinity, 'not within walking distance']],
  },
  'transport.nearest_station_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 500, 'on the doorstep'], [500, 1200, 'a short walk'],
               [1200, 2500, 'a longer walk'], [2500, Infinity, 'not walkable']],
  },
  'environment.no2': {
    direction: 'lower_is_better', baseline: 'england',
    absBands: [[0, 10, 'well within'], [10, 20, 'within'], [20, 40, 'approaching'],
               [40, Infinity, 'above']],
  },
};

function pick(bands, value) {
  for (const [min, max, word] of bands) {
    if (value >= min && value < max) return word;
  }
  return null;
}

/** Compare a value against its benchmarks and return {vs, ratio, band, direction}. */
export function compare(key, value, benchmarks = []) {
  const t = THRESHOLDS[key];
  if (!t || typeof value !== 'number' || !isFinite(value)) return null;

  const bench = t.baseline && benchmarks.find(b => b.scope === t.baseline);
  if (bench && t.ratioBands && bench.value) {
    const ratio = value / bench.value;
    return { vs: bench.scope, vsName: bench.name || bench.scope, ratio,
             band: pick(t.ratioBands, ratio), direction: t.direction };
  }
  if (t.absBands) {
    return { vs: null, ratio: null, band: pick(t.absBands, value), direction: t.direction };
  }
  return null;
}
