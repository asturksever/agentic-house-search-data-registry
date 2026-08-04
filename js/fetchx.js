// Fetch with a deadline, one retry, and a per-tab response cache.
//
// Every source the report talks to is a free public API with no SLA, so a
// single slow endpoint must never hold up the page: providers run
// concurrently and each request carries its own timeout.

const TIMEOUT_MS = 8000;
const CACHE_PREFIX = 'ahs.cache.';

// How long a response stays usable, by what it is. A browser tab lives for
// minutes and throws the cache away on close, so this barely matters there. An
// MCP server lives as long as its client session, which for a desktop app left
// open is days: without expiry it would keep reporting the crime month that was
// current when it started, and grow by every postcode it ever saw.
const MINUTE = 60 * 1000;
const TTL = [
  [/\/packs\/.*\/[A-Z]+\.json/i, 7 * 24 * 60 * MINUTE],   // shards change only on a rebuild
  [/\/packs\/manifest\.json/i, 60 * MINUTE],
  [/\/packs\/baselines\.json/i, 60 * MINUTE],
  [/registry\.json/i, 60 * MINUTE],
  [/api\.postcodes\.io/i, 24 * 60 * MINUTE],              // postcode geography is near-static
];
const DEFAULT_TTL = 60 * MINUTE;                          // live APIs: crime, prices, planning
const MAX_ENTRIES = 2000;

function ttlFor(url) {
  for (const [pattern, ttl] of TTL) if (pattern.test(url)) return ttl;
  return DEFAULT_TTL;
}

// Caching is an optimisation, never a requirement: a browser gets sessionStorage
// (per tab, cleared on close), a Node host gets a bounded Map, and anything that
// has neither simply refetches.
const memory = new Map();

// "Has sessionStorage" stopped meaning "is a browser": Node 22+ ships a working
// one, and taking that branch under Node put every response in an unbounded
// per-process store that clearCache() could not reach — which is the exact bug
// the TTL work exists to fix. Test for a document instead.
const inBrowser = typeof document !== 'undefined'
  && typeof sessionStorage !== 'undefined';

const store = inBrowser
  ? {
      get: key => sessionStorage.getItem(key),
      set: (key, value) => sessionStorage.setItem(key, value),
      delete: key => sessionStorage.removeItem(key),
      // sessionStorage is already bounded by the browser and dies with the tab.
      evict: () => {},
    }
  : {
      get: key => (memory.has(key) ? memory.get(key) : null),
      set: (key, value) => memory.set(key, value),
      delete: key => memory.delete(key),
      evict: () => {
        if (memory.size <= MAX_ENTRIES) return;
        // Map preserves insertion order, so the oldest keys come out first.
        const excess = memory.size - MAX_ENTRIES;
        let dropped = 0;
        for (const key of memory.keys()) {
          memory.delete(key);
          if (++dropped >= excess) break;
        }
      },
    };

function cacheGet(key) {
  try {
    const raw = store.get(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // Entries written before this format existed have no expiry; treat them as
    // expired rather than trusting them forever.
    if (!entry || typeof entry.expiresAt !== 'number') return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(CACHE_PREFIX + key);
      return null;
    }
    return entry.value;
  } catch { return null; }
}

function cacheSet(key, value, url) {
  try {
    store.set(CACHE_PREFIX + key,
      JSON.stringify({ value, expiresAt: Date.now() + ttlFor(url) }));
    store.evict();
  } catch { /* quota, private mode, whatever — dropping the cache is harmless */ }
}

/** Drop everything cached. Mostly for tests and long-lived hosts between runs. */
export function clearCache() {
  memory.clear();
}

/** Cache size, for tests and for a host that wants to log it. */
export function cacheSize() {
  return memory.size;
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

async function once(url, { timeout, headers, accept }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: accept, ...headers },
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function request(url, opts, parse) {
  const { timeout = TIMEOUT_MS, retry = 1, cache = true, headers, accept } = opts;
  if (cache) {
    const hit = cacheGet(url);
    if (hit !== null) return hit;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const value = await parse(await once(url, { timeout, headers, accept }));
      if (cache) cacheSet(url, value, url);
      return value;
    } catch (err) {
      lastErr = err;
      // A 4xx will not fix itself; only retry timeouts, network errors and 5xx.
      if (err instanceof HttpError && err.status < 500) break;
    }
  }
  throw lastErr;
}

export function getJSON(url, opts = {}) {
  return request(url, { accept: 'application/json', ...opts }, res => res.json());
}

export function getText(url, opts = {}) {
  return request(url, { accept: 'text/plain,*/*', ...opts }, res => res.text());
}

// Run promises and keep whatever came back, mapping failures to null so one
// dead endpoint degrades a card to "partial" instead of losing the whole thing.
export async function settle(entries) {
  const results = await Promise.allSettled(entries.map(e => e.run));
  return results.map((r, i) => ({
    key: entries[i].key,
    value: r.status === 'fulfilled' ? r.value : null,
    error: r.status === 'rejected' ? r.reason : null,
  }));
}
