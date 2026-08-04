#!/usr/bin/env node
/**
 * agentic-house-search
 *
 *   agentic-house-search              # stdio (default) — for Claude Desktop, Claude Code
 *   agentic-house-search --http       # streamable HTTP on 127.0.0.1:8848
 *   agentic-house-search --http --port 9000 --host 0.0.0.0
 *
 * Environment:
 *   AHS_BASE_URL     site root to read data from (default: the published GitHub Pages site)
 *   ALLOWED_ORIGINS  comma-separated Origin allowlist for HTTP mode
 *   API_KEYS         comma-separated `key` or `key:pro` — unset means open access
 *   RATE_LIMIT_ANONYMOUS / RATE_LIMIT_PRO / RATE_LIMIT_WINDOW_MS
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { DEFAULT_BASE_URL, SERVER_NAME, SERVER_VERSION } from './constants.js';
import { authenticate, describeAccess, loadAccessConfig, rateLimit } from './services/access.js';
import { init } from './services/data.js';
import { createServer } from './server.js';

interface Options {
  http: boolean;
  port: number;
  host: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { http: false, port: 8848, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--http') options.http = true;
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--host') options.host = String(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        `${SERVER_NAME} ${SERVER_VERSION}\n\n` +
          '  --http           serve streamable HTTP instead of stdio\n' +
          '  --port <n>       HTTP port (default 8848)\n' +
          '  --host <addr>    HTTP bind address (default 127.0.0.1)\n\n' +
          'Env: AHS_BASE_URL, ALLOWED_ORIGINS\n',
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`--port must be a valid port number, got ${options.port}`);
  }
  return options;
}

// stdio speaks JSON-RPC on stdout, so every log line has to go to stderr or it
// corrupts the protocol stream.
const log = (message: string) => process.stderr.write(`${message}\n`);

async function runStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  log(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio`);
}

async function runHttp({ port, host }: Options) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // DNS-rebinding defence: a browser page on some other origin must not be able
  // to drive a server bound to the user's own loopback interface.
  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowed.includes(origin)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: `Origin ${origin} is not allowed. Set ALLOWED_ORIGINS.` },
        id: null,
      });
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ name: SERVER_NAME, version: SERVER_VERSION, ok: true });
  });

  // Gating applies to this transport only. Running the server yourself stays
  // free and ungated; with no API_KEYS set this is just a courtesy limit that
  // keeps one runaway agent from burning the upstream fair-use budgets.
  const access = loadAccessConfig();
  app.use('/mcp', authenticate(access), rateLimit(access));

  // Stateless: a fresh server and transport per request, so there is no session
  // state to lose and the process scales horizontally without stickiness.
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log(`request failed: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no server-initiated messages to deliver.
  const reject = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This server is stateless; use POST /mcp.' },
      id: null,
    });
  };
  app.get('/mcp', reject);
  app.delete('/mcp', reject);

  await new Promise<void>(resolve => {
    app.listen(port, host, () => {
      log(`${SERVER_NAME} ${SERVER_VERSION} listening on http://${host}:${port}/mcp`);
      log(`access: ${describeAccess(access)}`);
      resolve();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.AHS_BASE_URL || DEFAULT_BASE_URL;

  // Fail at startup rather than on the first tool call: a bad base URL is a
  // configuration problem, and an agent should not have to discover it.
  await init(baseUrl);
  log(`reading data from ${baseUrl}`);

  if (options.http) await runHttp(options);
  else await runStdio();
}

main().catch(err => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
