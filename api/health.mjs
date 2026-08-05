// A plain GET that says whether the hosted endpoint is up, for anyone who wants
// to check before pasting the URL into a client that will only report
// "connection failed".

import { SERVER_NAME, SERVER_VERSION } from '../mcp/dist/constants.js';

export default function handler(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: 'streamable-http',
    endpoint: '/mcp',
    data: process.env.AHS_BASE_URL || 'https://asturksever.github.io/agentic-house-search-data-registry/',
  });
}
