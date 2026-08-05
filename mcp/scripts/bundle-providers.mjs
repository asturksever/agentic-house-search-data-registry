// Copy the repo's browser provider layer into dist/ so the published package
// carries it.
//
// The alternative — reimplementing eleven providers, their thresholds and their
// coverage gates in TypeScript — is how the numbers on the website and the
// numbers this server reports start disagreeing. They are the same modules.

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const source = join(repoRoot, 'js');
const target = join(here, '..', 'dist', 'js');

// The browser-only half of js/ has no business in a server bundle: report.js
// and topbar.js touch the DOM at import time and ai.js talks to the Anthropic
// API. registry.js stays — the server loads it for the dataset tools.
const BROWSER_ONLY = new Set(['report.js', 'ai.js', 'topbar.js']);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

let copied = 0;
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (BROWSER_ONLY.has(entry.name)) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dst);
    } else if (entry.name.endsWith('.js')) {
      await cp(src, dst);
      copied++;
    }
  }
}

await copyTree(source, target);

const { size } = await stat(join(target, 'providers', 'index.js'));
if (!size) throw new Error('providers/index.js came out empty — check the copy');

console.log(`bundled ${copied} provider modules into dist/js`);
