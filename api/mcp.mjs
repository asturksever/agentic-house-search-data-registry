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

// People paste this URL into a browser to see whether it is "working", and a
// raw JSON-RPC error reads as broken. Only the presentation changes: the status
// stays 405 because the method really is not allowed, and anything that is not
// asking for HTML still gets the JSON-RPC error byte for byte, so no client
// sees a difference.
//
// Self-contained on purpose. The website is on this host now, but an endpoint
// that renders unstyled the day a build drops assets/ is a worse trade than
// fifteen lines of inline CSS.
const browserPage = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP endpoint — Agentic House Search</title>
<meta name="robots" content="noindex">
<style>
 :root{--bg:#f4f1ea;--card:#fffdf9;--ink:#1c2b24;--muted:#5f665c;--line:#ddd6c9;--accent:#1f4d3a;--rule:#a67c2e}
 @media (prefers-color-scheme:dark){:root{--bg:#121611;--card:#1a1f18;--ink:#e9e6dd;--muted:#9aa196;--line:#2c342a;--accent:#8fc0a4;--rule:#c9a253}}
 body{margin:0;padding:56px 24px;background:var(--bg);color:var(--ink);
   font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
 main{max-width:50ch;margin:0 auto}
 h1{font-family:Georgia,serif;font-weight:600;font-size:28px;line-height:1.25;margin:0 0 16px}
 p{color:var(--muted);margin:0 0 16px}
 code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px}
 .url{display:block;background:var(--card);border:1px solid var(--line);border-top:2px solid var(--rule);
   border-radius:0 0 5px 5px;padding:14px 16px;margin:0 0 20px;color:var(--ink);word-break:break-all}
 a{color:var(--accent)}
</style></head>
<body><main>
 <h1>This is an MCP endpoint, and it is working</h1>
 <p>Your browser asked for this page with <code>GET</code>. The Model Context
   Protocol speaks <code>POST</code> with a JSON-RPC body, so there is nothing
   to show here — the error you would otherwise see is the endpoint answering
   correctly, not failing.</p>
 <p>Give this URL to an AI client rather than a browser:</p>
 <span class="url">https://agentic-house-search.vercel.app/mcp</span>
 <p>The <a href="/connect.html">connect page</a> has per-client instructions, and
   <a href="/health">/health</a> reports whether the server can reach its data —
   that one <em>is</em> meant for a browser.</p>
 <p>UK neighbourhood research from government open data. Free, no account, no key.</p>
</main></body></html>
`;

const wantsHtml = req => (req.headers.accept ?? '').includes('text/html');

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
    if (req.method === 'GET' && wantsHtml(req)) {
      applyCors(res);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.status(405).end(browserPage);
      return;
    }
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
