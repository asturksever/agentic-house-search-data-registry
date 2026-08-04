// Single source of truth for registry metadata. Both the catalogue page and the
// postcode report read from data/registry.json through here, so a card's
// publisher/licence/cadence line is never written out by hand twice.

import { resolve } from './config.js';
import { getJSON } from './fetchx.js';

let cached = null;

export async function loadRegistry() {
  if (cached) return cached;
  // Through fetchx rather than bare fetch, so this gets the same deadline and
  // retry as everything else: a hung registry fetch used to have no timeout at
  // all, and it runs before the page can render anything.
  const data = await getJSON(resolve('data/registry.json'));
  data.byId = Object.fromEntries(data.sources.map(s => [s.id, s]));
  cached = data;
  return cached;
}

// The catalogue groups freeform category strings ("Environment (Flood risk)")
// under a coarse heading by prefix match.
export const GROUPS = ['All', 'Crime', 'Demographics', 'Affluence', 'Property prices',
  'Ownership & tenure', 'Planning & constraints', 'Ground risk', 'Noise', 'Transport',
  'Health & care', 'Amenities', 'Schools', 'Environment', 'Geography backbone', 'Extras'];

export function groupOf(source) {
  for (const g of GROUPS) {
    if (g !== 'All' && source.category.startsWith(g)) return g;
  }
  return 'Other';
}

// Deep link to a source's card on the catalogue page.
export function registryAnchor(id) {
  return `index.html#src-${id}`;
}
