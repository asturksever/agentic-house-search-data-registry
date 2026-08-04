// Shared response shaping: markdown for reading, JSON for processing, and a
// hard character cap so a wide query cannot flood an agent's context.

import { ATTRIBUTION, CHARACTER_LIMIT } from '../constants.js';
import type { CategoryResult, Fact, Place, Registry } from '../types.js';

const TONE_MARK: Record<string, string> = {
  good: '▲',
  neutral: '●',
  watch: '◆',
  poor: '▼',
};

export function factLine(fact: Fact): string {
  const parts = [`- **${fact.label}**: ${fact.display}`];
  const c = fact.comparison;
  if (c?.band) {
    const mark = TONE_MARK[c.tone] ?? '';
    parts.push(` — ${mark} ${c.band}${c.vs ? ` ${c.vsName ?? c.vs}` : ''}`);
  }
  const bench = fact.benchmarks[0];
  if (bench) parts.push(` (benchmark ${bench.name ?? bench.scope}: ${bench.display ?? bench.value})`);
  if (fact.period) parts.push(` [${fact.period}]`);
  return parts.join('');
}

export function placeHeading(place: Place): string {
  const bits = [place.district.name, place.region || place.country].filter(Boolean);
  return `${place.postcode} · ${bits.join(' · ')}`;
}

export function placeDetail(place: Place): string[] {
  return [
    `- **Local authority**: ${place.district.name} (${place.district.code})`,
    `- **Neighbourhood (LSOA)**: ${place.lsoa.name} (${place.lsoa.code})`,
    `- **Ward**: ${place.ward.name}`,
    `- **Constituency**: ${place.constituency}`,
    `- **Country**: ${place.country}`,
    ...(place.ruc ? [`- **Rural/urban**: ${place.ruc}`] : []),
    `- **Coordinates**: ${place.lat}, ${place.lng}`,
  ];
}

export function categoryMarkdown(category: CategoryResult & { summary?: string }): string {
  const lines = [`## ${category.label} (${category.status})`, ''];
  if (category.summary) lines.push(category.summary, '');
  for (const fact of category.facts) lines.push(factLine(fact));
  if (category.facts.length) lines.push('');
  for (const note of category.notes) lines.push(`> ${note}`);
  if (category.notes.length) lines.push('');
  if (category.alt) lines.push(`Elsewhere: [${category.alt.label}](${category.alt.url})`, '');
  return lines.join('\n');
}

/** Publisher and licence for each source a category actually used. */
export function sourceLines(category: CategoryResult, registry: Registry | null): string[] {
  if (!registry) return [];
  return category.sources
    .map(id => registry.byId[id])
    .filter(Boolean)
    .map(s => `- ${s!.dataset} — ${s!.publisher} (${s!.licence}), updated ${s!.update_frequency}`);
}

/**
 * Truncation is announced, never silent: an agent that cannot tell a partial
 * answer from a complete one will happily report the partial as complete.
 *
 * Prose degrades gracefully when you cut it. JSON does not: slicing a serialised
 * document mid-token hands the model something it cannot parse, and the failure
 * looks like a bug in the model rather than in us. Use capJson for JSON.
 */
export function capText(text: string, hint: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    `${text.slice(0, CHARACTER_LIMIT)}\n\n---\n` +
    `**Response truncated at ${CHARACTER_LIMIT.toLocaleString('en-GB')} characters.** ${hint}`
  );
}

/**
 * Serialise a payload, shrinking the data until it fits rather than cutting the
 * string. Always returns valid JSON.
 *
 * `shrink` should return a smaller version of the payload, or null when there is
 * nothing left to drop. The result carries `truncated` and `truncation_message`
 * so the caller knows it is holding a partial answer.
 */
export function capJson<T extends object>(
  payload: T,
  hint: string,
  shrink: (current: T) => T | null,
): string {
  let current = payload;
  let dropped = false;

  for (;;) {
    const text = JSON.stringify(
      dropped ? { ...current, truncated: true, truncation_message: hint } : current,
      null,
      2,
    );
    if (text.length <= CHARACTER_LIMIT) return text;

    const smaller = shrink(current);
    if (!smaller) {
      // Nothing left to drop and it still does not fit. A tiny valid document
      // saying so beats an unparseable slice of a large one.
      return JSON.stringify({
        truncated: true,
        truncation_message:
          `${hint} The response could not be reduced below the ` +
          `${CHARACTER_LIMIT.toLocaleString('en-GB')} character limit.`,
      }, null, 2);
    }
    current = smaller;
    dropped = true;
  }
}

export function withAttribution(text: string): string {
  return `${text}\n\n---\n${ATTRIBUTION}`;
}

export function toolError(message: string, suggestion?: string) {
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: suggestion ? `${message} ${suggestion}` : message },
    ],
  };
}
