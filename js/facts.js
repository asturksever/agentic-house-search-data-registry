// The one shape every provider returns, and the only shape the narrator, the
// card renderer and the LLM prompt ever read.

import { compare } from './thresholds.js';

export const STATUS = {
  OK: 'ok',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
  OUT_OF_COVERAGE: 'out_of_coverage',
  ERROR: 'error',
};

export const fmt = {
  num: (v, dp = 0) => v.toLocaleString('en-GB', { maximumFractionDigits: dp }),
  pct: (v, dp = 0) => `${v.toLocaleString('en-GB', { maximumFractionDigits: dp })}%`,
  money: v => `£${Math.round(v).toLocaleString('en-GB')}`,
  rate: (v, per = 1000) => `${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })} per ${per.toLocaleString('en-GB')}`,
  metres: v => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`),
  ordinal: n => {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },
};

/**
 * @param {object} spec
 * @param {string} spec.key        stable identifier, also the thresholds key
 * @param {string} spec.label      human label for the table row
 * @param {number|string} spec.value
 * @param {string} spec.display    pre-formatted value for display
 * @param {string} spec.kind       rate|percent|count|money|index|decile|distance_m|minutes|category
 * @param {object} spec.geography  {level, code, name} the value actually describes
 * @param {string} spec.period     the period the value covers
 * @param {Array}  spec.benchmarks [{scope, name, value}]
 * @param {string} spec.sourceId   registry id, drives attribution and the catalogue link
 * @param {string} spec.note       caveat shown under the row
 */
export function fact(spec) {
  const f = {
    key: spec.key,
    label: spec.label,
    value: spec.value,
    unit: spec.unit || '',
    display: spec.display,
    kind: spec.kind || 'count',
    geography: spec.geography || null,
    period: spec.period || null,
    benchmarks: spec.benchmarks || [],
    sourceId: spec.sourceId,
    note: spec.note || null,
  };
  f.comparison = compare(f.key, f.value, f.benchmarks);
  return f;
}

export function result(id, label, patch = {}) {
  return {
    id,
    label,
    status: STATUS.OK,
    facts: [],
    notes: [],
    errors: [],
    sources: [],
    fetchedAt: new Date().toISOString(),
    ...patch,
  };
}

export function outOfCoverage(id, label, why, alt) {
  return result(id, label, {
    status: STATUS.OUT_OF_COVERAGE,
    notes: [why],
    alt: alt || null,
  });
}

/**
 * Settle a category: whatever facts survived plus the sources that failed.
 * A provider never throws — a dead endpoint downgrades the card to "partial"
 * and names what is missing, rather than blanking it.
 */
export function finish(res) {
  if (res.status === STATUS.OUT_OF_COVERAGE) return res;

  // Attribute only the sources that actually produced a fact, so a card never
  // carries a licence line for data it did not use.
  if (res.facts.length) {
    const used = new Set(res.facts.map(f => f.sourceId));
    res.sources = res.sources.filter(id => used.has(id));
  }

  if (!res.facts.length) {
    res.status = res.errors.length ? STATUS.ERROR : STATUS.UNAVAILABLE;
  } else if (res.errors.length) {
    res.status = STATUS.PARTIAL;
  }
  return res;
}

/** What the LLM is allowed to see: facts only, no URLs, no raw payloads. */
export function forPrompt(res) {
  return {
    id: res.id,
    label: res.label,
    status: res.status,
    notes: res.notes,
    missing: res.errors.map(e => e.sourceId),
    facts: res.facts.map(f => ({
      label: f.label,
      display: f.display,
      value: f.value,
      unit: f.unit,
      geography: f.geography && `${f.geography.level} ${f.geography.name || f.geography.code}`,
      period: f.period,
      benchmarks: f.benchmarks.map(b => ({ scope: b.scope, name: b.name, value: b.value })),
      comparison: f.comparison,
      note: f.note,
    })),
  };
}
