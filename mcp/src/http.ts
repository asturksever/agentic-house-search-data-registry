// One stateless MCP request over streamable HTTP.
//
// Both HTTP hosts go through here: `--http` for a server you run yourself, and
// the hosted serverless function for people who would rather paste a URL than
// install anything. Neither should be reimplementing transport wiring, because
// that is how the two start behaving differently for the same request.
//
// Stateless means a fresh server and transport per request and no session id:
// there is no state to lose between invocations, so it scales horizontally with
// no session affinity and survives being torn down after every call.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createServer } from './server.js';

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
