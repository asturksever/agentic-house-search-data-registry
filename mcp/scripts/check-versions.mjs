// The version number lives in four places. Do they still agree?
//
// package.json is the one npm publishes. SERVER_VERSION is what the server
// reports in every MCP handshake and in /health. server.json is what the MCP
// registry lists, twice — once for the server entry and once for the npm package
// it points at. `npm version` updates the first and the lockfile, and knows
// nothing about the other three.
//
// Drift here is quiet and embarrassing rather than loud: a client is told it is
// talking to 0.1.1 while running 0.1.2, and the registry offers a version that
// was never published. Nothing fails, so nothing tells you.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mcpRoot, '..');
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

const pkg = json(join(mcpRoot, 'package.json'));
const lock = json(join(mcpRoot, 'package-lock.json'));
const registry = json(join(repoRoot, 'server.json'));
const constants = read(join(mcpRoot, 'src', 'constants.ts'));

const declared = constants.match(/SERVER_VERSION\s*=\s*'([^']+)'/)?.[1] ?? null;
const npmEntry = registry.packages?.find(entry => entry.registryType === 'npm') ?? null;

const found = [
  ['mcp/package.json', pkg.version],
  ['mcp/package-lock.json', lock.version],
  ['mcp/src/constants.ts (SERVER_VERSION)', declared],
  ['server.json (version)', registry.version],
  ['server.json (npm package version)', npmEntry?.version ?? null],
];

const mismatched = found.filter(([, version]) => version !== pkg.version);

if (mismatched.length) {
  process.stderr.write(`Version mismatch. mcp/package.json says ${pkg.version}:\n`);
  for (const [where, version] of found) {
    process.stderr.write(`  ${version === pkg.version ? ' ' : '✗'} ${where}: ${version ?? '(not found)'}\n`);
  }
  process.exit(1);
}

process.stdout.write(`version ${pkg.version} agrees across ${found.length} places\n`);
