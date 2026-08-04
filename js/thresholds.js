// Where the judgement lives: how a raw number becomes "well below average".
//
// Every band is data, not prose. The narrator writes the sentence, the card
// paints a status, but the word each reaches for comes from here, and the
// number always travels with it — so a paragraph can never say "low" next to a
// table cell that says otherwise.
//
// Bands are [min, max, word, tone]. `tone` drives the colour and the glyph on
// the card; it is written out per band rather than derived from position,
// because "in line with average" is neutral whichever direction is better.

export const TONES = ['good', 'neutral', 'watch', 'poor'];

// direction: which way is better for a buyer, or 'neutral' for purely
//   descriptive facts (a 34% owner-occupier share is not good or bad).
// baseline: which benchmark scope to compare against when one is present.
// ratioBands: over value / baseline.  absBands: over the raw value, used when
//   no benchmark is available.
export const THRESHOLDS = {
  // Crime is deliberately absent from this table. Recorded crime per 1 km square
  // is extremely skewed (a sampled national median of ~16 against a mean of ~79),
  // so banding it by ratio against an average would call an ordinary city street
  // "forty times the national figure". js/providers/crime.js bands it by
  // percentile against the sampled distribution in packs/baselines.json and
  // supplies its own comparison.
  'deprivation.imd_decile': {
    direction: 'higher_is_better', baseline: null,
    // Nation-neutral wording: the fact names which index it came from, and the
    // four UK indices are not comparable with each other.
    absBands: [[1, 3, 'among the most deprived fifth of neighbourhoods', 'poor'],
               [3, 5, 'more deprived than average', 'watch'],
               [5, 7, 'around the middle of the national ranking', 'neutral'],
               [7, 9, 'less deprived than average', 'good'],
               [9, 11, 'among the least deprived fifth of neighbourhoods', 'good']],
  },
  'prices.median_paid': {
    direction: 'neutral', baseline: 'local_authority',
    ratioBands: [[0, .75, 'well below', 'neutral'], [.75, .92, 'below', 'neutral'],
                 [.92, 1.08, 'in line with', 'neutral'], [1.08, 1.35, 'above', 'neutral'],
                 [1.35, Infinity, 'well above', 'neutral']],
  },
  'prices.avg_price_district': {
    direction: 'neutral', baseline: 'england',
    ratioBands: [[0, .75, 'well below', 'neutral'], [.75, .92, 'below', 'neutral'],
                 [.92, 1.08, 'in line with', 'neutral'], [1.08, 1.35, 'above', 'neutral'],
                 [1.35, Infinity, 'well above', 'neutral']],
  },

  // Coverage percentages saturate at 100, so a ratio against the UK mean is
  // more informative than one against the median (which is usually 100).
  'broadband.gigabit_pct': {
    direction: 'higher_is_better', baseline: 'uk',
    ratioBands: [[0, .5, 'far below', 'poor'], [.5, .9, 'below', 'watch'],
                 [.9, 1.05, 'in line with', 'neutral'], [1.05, Infinity, 'above', 'good']],
    absBands: [[0, 1, 'no gigabit service', 'poor'], [1, 50, 'patchy', 'watch'],
               [50, 95, 'mostly available', 'neutral'],
               [95, 101, 'available across the postcode', 'good']],
  },
  'broadband.ufbb_pct': {
    direction: 'higher_is_better', baseline: 'uk',
    ratioBands: [[0, .5, 'far below', 'poor'], [.5, .9, 'below', 'watch'],
                 [.9, 1.05, 'in line with', 'neutral'], [1.05, Infinity, 'above', 'good']],
    absBands: [[0, 1, 'not available', 'poor'], [1, 50, 'patchy', 'watch'],
               [50, 95, 'mostly available', 'neutral'],
               [95, 101, 'available across the postcode', 'good']],
  },
  'broadband.sfbb_pct': {
    direction: 'higher_is_better', baseline: 'uk',
    ratioBands: [[0, .5, 'far below', 'poor'], [.5, .9, 'below', 'watch'],
                 [.9, 1.05, 'in line with', 'neutral'], [1.05, Infinity, 'above', 'good']],
  },
  'broadband.uso_pct': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 1, 'none affected', 'good'], [1, 10, 'a few premises', 'watch'],
               [10, 101, 'a significant share', 'poor']],
  },
  // Adjectives rather than adverbs, so several of these read as a list:
  // "5G outdoors (93%) and 4G indoors (100%) are all almost universal."
  'mobile.5g_outdoor_all_pct': {
    direction: 'higher_is_better', baseline: null,
    absBands: [[0, 5, 'all but absent', 'poor'], [5, 40, 'patchy', 'watch'],
               [40, 80, 'widespread', 'neutral'], [80, 101, 'almost universal', 'good']],
  },
  'mobile.5g_outdoor_any_pct': {
    direction: 'higher_is_better', baseline: null,
    absBands: [[0, 50, 'limited', 'poor'], [50, 90, 'widespread', 'watch'],
               [90, 101, 'almost universal', 'good']],
  },
  'mobile.4g_indoor_all_pct': {
    direction: 'higher_is_better', baseline: null,
    absBands: [[0, 40, 'patchy', 'watch'], [40, 80, 'widespread', 'neutral'],
               [80, 101, 'almost universal', 'good']],
  },
  'noise.road_lden': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 55, 'quiet for road noise', 'good'], [55, 60, 'moderate road noise', 'neutral'],
               [60, 70, 'noticeable road noise', 'watch'], [70, Infinity, 'high road noise', 'poor']],
  },
  'amenities.nearest_supermarket_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 400, 'on the doorstep', 'good'], [400, 900, 'a short walk', 'good'],
               [900, 2000, 'a longer walk', 'watch'],
               [2000, Infinity, 'not within walking distance', 'poor']],
  },
  'amenities.nearest_gp_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 800, 'a short walk', 'good'], [800, 2000, 'a longer walk', 'neutral'],
               [2000, Infinity, 'not within walking distance', 'watch']],
  },
  'amenities.nearest_park_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 400, 'on the doorstep', 'good'], [400, 1000, 'a short walk', 'good'],
               [1000, Infinity, 'a longer walk', 'watch']],
  },
  'transport.nearest_station_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 500, 'on the doorstep', 'good'], [500, 1200, 'a short walk', 'good'],
               [1200, 2500, 'a longer walk', 'watch'], [2500, Infinity, 'not walkable', 'poor']],
  },
  'schools.nearest_primary_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 800, 'a short walk', 'good'], [800, 2000, 'a longer walk', 'neutral'],
               [2000, Infinity, 'a drive away', 'watch']],
  },
  'schools.nearest_secondary_m': {
    direction: 'lower_is_better', baseline: null,
    absBands: [[0, 1500, 'a short walk', 'good'], [1500, 3000, 'a longer walk', 'neutral'],
               [3000, Infinity, 'a drive away', 'watch']],
  },
  'environment.no2': {
    direction: 'lower_is_better', baseline: 'england',
    absBands: [[0, 10, 'well within', 'good'], [10, 20, 'within', 'neutral'],
               [20, 40, 'approaching', 'watch'], [40, Infinity, 'above', 'poor']],
  },
};

function pick(bands, value) {
  for (const [min, max, word, tone] of bands) {
    if (value >= min && value < max) return { band: word, tone: tone || 'neutral' };
  }
  return null;
}

/** Compare a value against its benchmarks → {vs, ratio, band, tone, direction}. */
export function compare(key, value, benchmarks = []) {
  const t = THRESHOLDS[key];
  if (!t || typeof value !== 'number' || !isFinite(value)) return null;

  const bench = t.baseline && benchmarks.find(b => b.scope === t.baseline);
  if (bench && t.ratioBands && bench.value) {
    const ratio = value / bench.value;
    const hit = pick(t.ratioBands, ratio);
    return { vs: bench.scope, vsName: bench.name || bench.scope, ratio,
             band: hit?.band || null, tone: hit?.tone || 'neutral', direction: t.direction };
  }
  if (t.absBands) {
    const hit = pick(t.absBands, value);
    return { vs: null, ratio: null, band: hit?.band || null,
             tone: hit?.tone || 'neutral', direction: t.direction };
  }
  return null;
}

/** The card's overall status: its worst rated fact, or neutral if none rate. */
export function worstTone(facts) {
  const order = { good: 0, neutral: 1, watch: 2, poor: 3 };
  let worst = null;
  for (const f of facts) {
    const tone = f.comparison?.tone;
    if (!tone || tone === 'neutral') continue;
    if (worst === null || order[tone] > order[worst]) worst = tone;
  }
  return worst;
}
