// Access control for HTTP mode.
//
// The open-core boundary lives here, and only here. Running the server yourself
// (stdio or your own HTTP) is free and ungated forever: with no API_KEYS set,
// every request is anonymous and the only limit is a courtesy rate limit that
// stops a runaway agent hammering the upstream government APIs.
//
// A hosted deployment sets API_KEYS and gets tiers. That is the whole
// difference, so the free product cannot quietly rot while the paid one gets
// the attention.

import type { NextFunction, Request, Response } from 'express';

export type Tier = 'anonymous' | 'pro';

export interface AccessConfig {
  keys: Map<string, Tier>;
  limits: Record<Tier, number>;
  windowMs: number;
}

/**
 * API_KEYS is a comma-separated list, each entry `key` or `key:tier`.
 * Empty (the default) means no authentication: everything is anonymous.
 */
export function loadAccessConfig(env: NodeJS.ProcessEnv = process.env): AccessConfig {
  const keys = new Map<string, Tier>();
  for (const entry of (env.API_KEYS ?? '').split(',').map(e => e.trim()).filter(Boolean)) {
    const [key, tier] = entry.split(':');
    if (key) keys.set(key, tier === 'pro' ? 'pro' : 'anonymous');
  }
  return {
    keys,
    limits: {
      anonymous: Number(env.RATE_LIMIT_ANONYMOUS ?? 60),
      pro: Number(env.RATE_LIMIT_PRO ?? 1000),
    },
    windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000),
  };
}

/** Bearer token, or nothing. */
function presentedKey(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const alt = req.get('x-api-key');
  return alt ? alt.trim() : null;
}

const jsonRpcError = (res: Response, status: number, code: number, message: string) => {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
};

/**
 * Resolve the caller's tier. With no keys configured every caller is anonymous
 * and nothing is rejected; with keys configured an unrecognised key is refused
 * rather than silently downgraded, because a silent downgrade looks like a bug
 * to whoever is paying.
 */
export function authenticate(config: AccessConfig) {
  return (req: Request & { tier?: Tier; callerId?: string }, res: Response, next: NextFunction) => {
    const key = presentedKey(req);

    if (!config.keys.size) {
      req.tier = 'anonymous';
      req.callerId = req.ip ?? 'unknown';
      return next();
    }

    if (!key) {
      req.tier = 'anonymous';
      req.callerId = req.ip ?? 'unknown';
      return next();
    }

    const tier = config.keys.get(key);
    if (!tier) {
      jsonRpcError(res, 401, -32001, 'Unrecognised API key.');
      return;
    }

    req.tier = tier;
    // Key prefix only: enough to attribute usage, never enough to reconstruct.
    req.callerId = `key:${key.slice(0, 8)}`;
    return next();
  };
}

/**
 * Fixed-window counter, in memory.
 *
 * Deliberately not a dependency and deliberately not distributed: this exists
 * to stop one runaway agent exhausting the upstream fair-use budgets that
 * Overpass and friends run on. A hosted deployment that needs accurate,
 * multi-instance metering should put a real gateway in front.
 */
export function rateLimit(config: AccessConfig) {
  const counters = new Map<string, { count: number; resetAt: number }>();

  return (req: Request & { tier?: Tier; callerId?: string }, res: Response, next: NextFunction) => {
    const tier = req.tier ?? 'anonymous';
    const id = `${tier}:${req.callerId ?? req.ip ?? 'unknown'}`;
    const limit = config.limits[tier];
    const now = Date.now();

    let entry = counters.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      counters.set(id, entry);
    }
    entry.count++;

    // Opportunistic sweep, so a long-lived process does not accumulate keys.
    if (counters.size > 10_000) {
      for (const [k, v] of counters) if (v.resetAt <= now) counters.delete(k);
    }

    const remaining = Math.max(0, limit - entry.count);
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      jsonRpcError(
        res,
        429,
        -32002,
        `Rate limit reached (${limit} requests per ${Math.round(config.windowMs / 60000)} minutes). ` +
          `Retry in ${retryAfter}s, or run the server yourself with ` +
          '`npx agentic-house-uk` for unlimited local use.',
      );
      return;
    }

    return next();
  };
}

export function describeAccess(config: AccessConfig): string {
  if (!config.keys.size) {
    return `open (no API keys configured), ${config.limits.anonymous} requests/hour per client`;
  }
  return (
    `${config.keys.size} key(s) configured · anonymous ${config.limits.anonymous}/h · ` +
    `pro ${config.limits.pro}/h`
  );
}
