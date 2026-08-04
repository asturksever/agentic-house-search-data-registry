// Street-level crime (Home Office / police forces, data.police.uk).

import { getJSON } from '../fetchx.js';
import { fact, result, finish, fmt } from '../facts.js';
import { packUrl } from './_pack.js';
import { box, monthName, noteFailure } from './_util.js';

const SOURCE = 'police-street-crime';
const API = 'https://data.police.uk/api';
const RADIUS_M = 500;
const MONTHS = 3;

const TITLES = {
  'anti-social-behaviour': 'anti-social behaviour',
  'violent-crime': 'violence and sexual offences',
  'other-theft': 'other theft',
  'theft-from-the-person': 'theft from the person',
  'vehicle-crime': 'vehicle crime',
  'criminal-damage-arson': 'criminal damage and arson',
  'burglary': 'burglary',
  'shoplifting': 'shoplifting',
  'public-order': 'public order',
  'drugs': 'drug offences',
  'bicycle-theft': 'bicycle theft',
  'robbery': 'robbery',
  'possession-of-weapons': 'possession of weapons',
  'other-crime': 'other crime',
};

const title = c => TITLES[c] || c.replace(/-/g, ' ');

/**
 * Place a count against the sampled national distribution.
 *
 * Recorded crime per square kilometre is wildly skewed: most of the country is
 * near zero and a city centre is in the hundreds, so a ratio against the mean
 * would describe an ordinary high street as an outlier. Quartiles say the only
 * thing that is actually true here, which is where this postcode sits in the
 * national ordering.
 */
function bandAgainst(count, baseline) {
  if (!baseline || typeof baseline.median !== 'number') return null;
  const { p25, p75, p90 } = baseline;
  const [band, tone] =
    count <= p25 ? ['well below the national middle', 'good']
    : count <= p75 ? ['around the national middle', 'neutral']
    : count <= p90 ? ['in the busiest quarter of the country', 'watch']
    : ['in the busiest tenth of the country', 'poor'];
  // 'clause' tells the narrator this band is a complete phrase, not a
  // comparative that slots into "X the Y figure of Z".
  return { vs: 'england', vsName: 'sampled UK median', ratio: null, band, tone,
           direction: 'lower_is_better', phrasing: 'clause' };
}

function previousMonth(ym, back) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default {
  id: 'crime',
  label: 'Crime',
  short: 'Crime',
  registryIds: [SOURCE],

  coverage(place) {
    if (place.country !== 'Scotland') return { ok: true };
    return {
      ok: false,
      why: 'data.police.uk publishes street-level crime for England, Wales and Northern Ireland only. Police Scotland reports separately and not at street level.',
      alt: { label: 'Police Scotland statistics and data', url: 'https://www.scotland.police.uk/about-us/how-we-do-it/statistics-and-data/' },
    };
  },

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'live' });

    let latest;
    try {
      latest = (await getJSON(`${API}/crime-last-updated`)).date.slice(0, 7);
    } catch (err) {
      noteFailure(res, SOURCE, 'data.police.uk', err);
      return finish(res);
    }

    // A polygon keeps the response small; the 1-mile lat/lng form returns
    // megabytes in a city centre.
    const b = box(place.lat, place.lng, RADIUS_M);
    const poly = [
      [b.south, b.west], [b.south, b.east], [b.north, b.east], [b.north, b.west],
    ].map(([la, ln]) => `${la.toFixed(5)},${ln.toFixed(5)}`).join(':');

    const months = Array.from({ length: MONTHS }, (_, i) => previousMonth(latest, i));
    const batches = await Promise.all(months.map(m =>
      getJSON(`${API}/crimes-street/all-crime?poly=${poly}&date=${m}`, { timeout: 12000 })
        .catch(err => { noteFailure(res, SOURCE, `crimes for ${monthName(m)}`, err); return null; })));

    const crimes = batches.filter(Boolean).flat();
    if (!crimes.length) {
      if (!res.errors.length) {
        res.notes.push(`No crimes were recorded in the ${(RADIUS_M * 2) / 1000} km square around this postcode in the three months to ${monthName(latest)}.`);
      }
      return finish(res);
    }

    const period = `${monthName(months[months.length - 1])} – ${monthName(latest)}`;
    const geography = { level: 'Area', code: null, name: `a ${(RADIUS_M * 2) / 1000} km square centred on the postcode` };
    const note = 'Locations are snapped to anonymous map points near the incident, so counts describe the area rather than a specific address.';

    // The box is always the same size, so this count is already a density and
    // comparable between places. What it lacked was anything to compare against.
    const baseline = (await getJSON(packUrl('baselines.json')).catch(() => null))?.crime;

    res.facts.push(fact({
      key: 'crime.total_3m', label: 'Recorded crimes', value: crimes.length,
      display: fmt.num(crimes.length), kind: 'count', geography, period, sourceId: SOURCE, note,
      comparison: bandAgainst(crimes.length, baseline),
      benchmarks: baseline ? [{
        scope: 'england', name: 'sampled UK median',
        value: baseline.median, display: fmt.num(baseline.median),
      }] : [],
    }));

    if (baseline) {
      res.notes.push(`For scale, the same 1 km square over the same three months holds ${fmt.num(baseline.median)} recorded crimes at the median UK postcode, ${fmt.num(baseline.p75)} at the busiest quarter and ${fmt.num(baseline.p90)} at the busiest tenth, from a ${baseline.sample_size}-postcode sample.`);
    }

    const counts = new Map();
    for (const c of crimes) counts.set(c.category, (counts.get(c.category) || 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    for (const [category, n] of ranked.slice(0, 3)) {
      const pct = (n / crimes.length) * 100;
      res.facts.push(fact({
        key: `crime.category.${category}`, label: title(category), value: n,
        display: `${fmt.num(n)} (${fmt.pct(pct)})`, kind: 'count', geography, period, sourceId: SOURCE,
      }));
    }

    res.notes.push(`Police data runs about two months behind, so the most recent month available is ${monthName(latest)}.`);

    // data.police.uk only has what each force submits, and some forces have
    // stopped supplying street-level data for months at a time. A near-empty
    // result in a built-up area is far more likely to be a gap than a quiet
    // street, and saying so is better than letting the number stand alone.
    if (crimes.length < 5) {
      res.notes.push(`Only ${crimes.length} crime${crimes.length === 1 ? '' : 's'} came back for three months, which is low enough to be worth double-checking: data.police.uk depends on each force submitting its data, and some have gaps lasting months.`);
    }

    return finish(res);
  },
};
