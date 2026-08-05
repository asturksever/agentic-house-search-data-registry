// Drive the serverless entrypoint the hosted endpoint runs.
//
// `npm run smoke` covers the tools over stdio. This covers the things only the
// HTTP deployment can get wrong: CORS, the method contract, and — the one that
// actually broke — whether the provider modules can still be found after a
// bundler has moved the compiled server away from them. It stands the function
// up behind a real HTTP server with a Vercel-shaped req/res, because a handler
// called directly in-process would not exercise any of that.

import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The deployment sets this; without it a bundled function looks for the provider
// modules beside itself and does not find them.
process.env.AHS_JS_ROOT ??= join(repoRoot, 'js');

const { default: handler } = await import(pathToFileURL(join(repoRoot, 'api', 'mcp.mjs')).href);

// Vercel hands the function a Node request with the JSON body already parsed and
// an Express-flavoured response. Reproduce exactly that much and no more.
const server = http.createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(value));
    return res;
  };
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  req.body = raw ? JSON.parse(raw) : undefined;
  await handler(req, res);
});

const port = 8849;
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${port}/mcp`;

let id = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await response.text();
  // Streamable HTTP answers a single request as one SSE event by default.
  const payload = text.startsWith('event:') ? text.split('\ndata: ')[1]?.split('\n')[0] : text;
  return { response, body: payload ? JSON.parse(payload) : null };
}

let failures = 0;
const check = (name, ok, detail = '') => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failures++;
};

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke-http', version: '0' },
});
check(
  'initialize succeeds',
  init.response.status === 200 && init.body?.result?.serverInfo?.name === 'agentic-house-search',
  `${init.response.status} ${init.body?.result?.serverInfo?.version ?? ''}`,
);
check(
  'CORS is open, and exposes the MCP headers a client has to read',
  init.response.headers.get('access-control-allow-origin') === '*' &&
    (init.response.headers.get('access-control-expose-headers') ?? '').includes('mcp-session-id'),
);

const tools = await rpc('tools/list', {});
const names = (tools.body?.result?.tools ?? []).map(tool => tool.name).sort();
check('lists five tools', names.length === 5, names.join(', '));

// The one that catches a broken provider path: this call has to reach js/ on
// disk and then the published site over the network.
const lookup = await rpc('tools/call', { name: 'postcode_lookup', arguments: { postcode: 'SW11 1AA' } });
const text = lookup.body?.result?.content?.[0]?.text ?? '';
check(
  'postcode_lookup reaches the shared provider modules',
  text.includes('Wandsworth') && !lookup.body?.result?.isError,
  text.slice(0, 70).replace(/\n/g, ' '),
);

const report = await rpc('tools/call', {
  name: 'postcode_report',
  arguments: { postcode: 'SW11 1AA', categories: ['broadband'] },
});
check(
  'postcode_report reaches a pack extract',
  !report.body?.result?.isError && /broadband|fibre|gigabit/i.test(report.body?.result?.content?.[0]?.text ?? ''),
);

const get = await fetch(endpoint);
check('GET is refused, because the server is stateless', get.status === 405, String(get.status));

const preflight = await fetch(endpoint, { method: 'OPTIONS' });
check(
  'OPTIONS preflight is answered without a body',
  preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*',
  String(preflight.status),
);

server.close();
process.stdout.write(failures ? `\n${failures} failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
