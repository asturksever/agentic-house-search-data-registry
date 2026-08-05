// Assemble the website into public/ for the deployment to serve.
//
// One host now serves everything — the landing page, the registry, the postcode
// report, the connect page and the MCP endpoint — so the static surface has to
// be exactly the website and nothing else.
//
// Hence a staging step rather than `outputDirectory: "."`. .vercelignore runs
// against the clone, before the build; the build then creates mcp/node_modules
// and mcp/dist inside that same tree, and serving the repo root would publish
// tens of megabytes of dependencies as static files. Copying the site out is the
// only way to get a served tree that is neither the repo root nor a permanent
// reorganisation of it — and the pack build pipeline writes to data/ and packs/
// where they are, so moving them for the deployment's convenience would be the
// tail wagging the dog.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repoRoot, 'public');

// Everything the browser can ask for. js/ is here because the report and the
// registry are ES modules fetched by the page, not a bundle.
const SITE = [
  'index.html',
  'registry.html',
  'report.html',
  'connect.html',
  'assets',
  'js',
  'data',
  'packs',
];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const entry of SITE) {
  const from = join(repoRoot, entry);
  try {
    await stat(from);
  } catch {
    throw new Error(`stage-site: ${entry} is missing — is it excluded by .vercelignore?`);
  }
  await cp(from, join(target, entry), { recursive: true });
}

// The report is the page most likely to be hit first from a search result, and
// it is useless without the registry behind it. Fail the build rather than
// deploy a site whose data layer silently did not travel.
for (const required of ['data/registry.json', 'packs/manifest.json', 'js/config.js']) {
  await stat(join(target, required)).catch(() => {
    throw new Error(`stage-site: ${required} did not reach public/`);
  });
}

process.stdout.write(`staged ${SITE.length} entries into public/\n`);
