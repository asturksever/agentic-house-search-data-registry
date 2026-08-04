// Fetch with a deadline, one retry, and a per-tab response cache.
//
// Every source the report talks to is a free public API with no SLA, so a
// single slow endpoint must never hold up the page: providers run
// concurrently and each request carries its own timeout.

const TIMEOUT_MS = 8000;
const CACHE_PREFIX = 'ahs.cache.';

// Caching is an optimisation, never a requirement: a browser gets sessionStorage
// (per tab, cleared on close), a Node host gets a plain Map, and anything that
// has neither simply refetches.
const memory = new Map();

const store = typeof sessionStorage !== 'undefined'
  ? {
      get: key => sessionStorage.getItem(key),
      set: (key, value) => sessionStorage.setItem(key, value),
    }
  : {
      get: key => (memory.has(key) ? memory.get(key) : null),
      set: (key, value) => memory.set(key, value),
    };

function cacheGet(key) {
  try {
    const raw = store.get(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cacheSet(key, value) {
  try {
    store.set(CACHE_PREFIX + key, JSON.stringify(value));
  } catch { /* quota, private mode, whatever — dropping the cache is harmless */ }
}

/** Drop everything cached. Long-lived hosts call this to avoid serving stale data. */
export function clearCache() {
  memory.clear();
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
      if (cache) cacheSet(url, value);
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
