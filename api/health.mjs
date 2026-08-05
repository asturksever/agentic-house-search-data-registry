// Whether the hosted endpoint is actually able to answer, for anyone who wants
// to check before pasting the URL into a client that will only report
// "connection failed".
//
// It loads the provider layer rather than just reporting that the process is
// running. A health check that says ok while every tool call fails is worse than
// no health check, and this endpoint told exactly that lie once: the function
// booted, /health returned ok, and initialize returned an internal error.
//
// On failure it reports where the provider modules were looked for. That is the
// one thing that goes wrong in a bundled deployment and the one thing you cannot
// guess from outside, and there is nothing sensitive in it — this server holds
// no keys and reads only public data.

import { SERVER_NAME, SERVER_VERSION, DEFAULT_BASE_URL } from '../mcp/dist/constants.js';
import { describeResolution, init, listProviders } from '../mcp/dist/services/data.js';

export default async function handler(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const base = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: 'streamable-http',
    endpoint: '/mcp',
    data: process.env.AHS_BASE_URL || DEFAULT_BASE_URL,
  };

  try {
    await init(process.env.AHS_BASE_URL);
    const providers = await listProviders();
    res.status(200).json({ ok: true, ...base, providers: providers.length });
  } catch (err) {
    res.status(503).json({
      ok: false,
      ...base,
      error: err?.message ?? String(err),
      resolution: describeResolution(),
    });
  }
}
