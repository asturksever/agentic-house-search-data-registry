// Pre-built extracts.
//
// Ofcom coverage, Defra noise and the DfE school register are published as bulk
// files with no queryable API, so tools/packbuild joins them to postcode
// centroids and commits one JSON shard per postcode area. A page only ever
// fetches the shard it needs.

import { getJSON, HttpError } from '../fetchx.js';
import { resolve } from '../config.js';

// Packs are the only part of this repo that grows, so they may one day be
// served from a sibling repo; every reader goes through this one function.
export const PACKS_BASE = 'packs';

export const packUrl = path => resolve(`${PACKS_BASE}/${path}`);

let manifest;

export function packManifest() {
  if (!manifest) {
    // Memoise the success, never the failure: caching a null here would mean one
    // blip at startup permanently strips the extract date off every pack for the
    // life of the process. fetchx already caches the successful response, so a
    // retry after a failure costs a request at most once.
    manifest = getJSON(packUrl('manifest.json')).catch(() => {
      manifest = undefined;
      return null;
    });
  }
  return manifest;
}

/**
 * Fetch a shard as-is, for packs that are not keyed by postcode (the school
 * register is a list of points the client measures distance against).
 * @returns {Promise<Object|null>} null when the shard has not been built.
 */
export async function loadRaw(name, area) {
  try {
    return await getJSON(packUrl(`${name}/${area}.json`), { retry: 0 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/**
 * @returns {Promise<{fields: string[], get(postcode): Object|null, generated: string}|null>}
 *   null when the pack has not been built yet (a missing shard is an expected
 *   state, not an error — the card says so and links to the publisher).
 */
export async function loadPack(name, area) {
  let shard;
  try {
    shard = await getJSON(packUrl(`${name}/${area}.json`), { retry: 0 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }

  const fields = shard._fields || [];
  const fallback = shard._default || null;
  const meta = await packManifest();

  return {
    fields,
    generated: shard._generated || meta?.packs?.[name]?.generated || meta?.generated || null,
    get(postcode) {
      const row = shard[postcode] || fallback;
      if (!row) return null;
      return Object.fromEntries(fields.map((f, i) => [f, row[i]]));
    },
    // Whether this postcode was explicitly listed or fell back to the area's
    // modal row — worth saying out loud, since the two differ in confidence.
    exact(postcode) { return Object.prototype.hasOwnProperty.call(shard, postcode); },
  };
}

/** Uniform "the extract for this area has not been built yet" outcome. */
export function notBuilt(res, what, alt) {
  res.notes.push(`The ${what} extract has not been built for this postcode area yet.`);
  if (alt) res.alt = alt;
  return res;
}
