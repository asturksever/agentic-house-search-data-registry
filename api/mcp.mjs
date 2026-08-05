// The hosted MCP endpoint.
//
// This exists so that connecting takes one URL and no install. It is the same
// server as `npx agentic-house-search`, the same provider modules and the same
// numbers — only the transport differs. Running it yourself stays free and
// ungated; this is a convenience, not a gate.
//
// Stateless by construction: a fresh server and transport per request, no
// session id, nothing to lose between invocations. That is what lets it live in
// a serverless function at all.

import { handleMcpRequest } from '../mcp/dist/http.js';
import { init } from '../mcp/dist/services/data.js';

// Public, read-only, no credentials: a browser-based client should be able to
// reach it from anywhere. `mcp-session-id` and `mcp-protocol-version` have to be
// exposed by name or a client cannot read them off the response.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

const applyCors = res => {
  for (const [header, value] of Object.entries(CORS)) res.setHeader(header, value);
};

const jsonRpcError = (res, status, code, message) => {
  applyCors(res);
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
};

// A courtesy limit, not a paywall. It is per warm instance and therefore
// approximate — several instances mean several buckets — but it is enough to
// stop one runaway agent from burning the fair-use budget of the government
// APIs underneath, which is the only thing it is for.
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = Number(process.env.RATE_LIMIT_ANONYMOUS ?? 120);
const seen = new Map();

function overLimit(req) {
  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const bucket = seen.get(ip);
  if (!bucket || now > bucket.resetAt) {
    seen.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count++;
  // Unbounded growth across a long-lived instance is the only leak available
  // here, so drop expired buckets whenever the map gets large.
  if (seen.size > 5_000) {
    for (const [key, value] of seen) if (now > value.resetAt) seen.delete(key);
  }
  return bucket.count > LIMIT;
}

// Start loading the provider layer while the instance is still cold, so the
// first request does not pay for it. The result is cached inside init(), so the
// request path re-enters it rather than holding this promise: init() drops a
// failed load, and a stale reference here would pin the failure forever.
//
// Nothing awaits this one, so its rejection has to be marked handled or a
// cold-start blip takes the instance down before it can answer with a real error.
init(process.env.AHS_BASE_URL).catch(() => {});

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(res);
    res.status(204).end();
    return;
  }

  // Stateless mode has no server-initiated messages to deliver and no session
  // to delete, so the two streaming verbs have nothing to do.
  if (req.method !== 'POST') {
    jsonRpcError(res, 405, -32000, 'This server is stateless; use POST with a JSON-RPC body.');
    return;
  }

  if (overLimit(req)) {
    res.setHeader('Retry-After', String(WINDOW_MS / 1000));
    jsonRpcError(
      res,
      429,
      -32000,
      `Rate limit of ${LIMIT} requests/hour reached. Run the server yourself for no limit: npx -y agentic-house-search`,
    );
    return;
  }

  applyCors(res);

  try {
    await init(process.env.AHS_BASE_URL);
    await handleMcpRequest(req, res, req.body);
  } catch (err) {
    process.stderr.write(`request failed: ${err?.stack ?? err}\n`);
    if (!res.headersSent) {
      // The message goes to the caller rather than only to the platform log.
      // There is nothing to leak — no keys, no user data, only public open data —
      // and the alternative is a client that can report nothing but "internal
      // error" to someone who cannot see the logs.
      jsonRpcError(res, 500, -32603, `Internal server error: ${err?.message ?? err}`);
    }
  }
}
