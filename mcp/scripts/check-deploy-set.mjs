// Does .vercelignore still ship everything the hosted endpoint needs to build?
//
// This exists because a deployment failed on exactly this and nothing could have
// caught it: CI checks out from git and never reads .vercelignore, so the build
// it runs is not the build Vercel runs. The bug was a bare `tools/` pattern —
// gitignore syntax matches at any depth, so it excluded `mcp/src/tools/` along
// with the repo's root `tools/`, and `tsc` failed on four missing modules.
//
// Rather than reimplement gitignore matching, this hands .vercelignore to git as
// a .gitignore in a scratch directory and asks git itself. Same matcher, same
// answers, including the depth rule that caused the problem.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });

// Everything the Vercel build command and the function need at runtime. A path
// under one of these prefixes must survive the upload.
const REQUIRED_PREFIXES = ['api/', 'js/', 'mcp/src/', 'mcp/scripts/', 'public/'];
const REQUIRED_FILES = [
  'vercel.json',
  'mcp/package.json',
  'mcp/package-lock.json',
  'mcp/tsconfig.json',
];

const tracked = git(['ls-files'], repoRoot).split('\n').filter(Boolean);
const needed = tracked.filter(
  path => REQUIRED_PREFIXES.some(prefix => path.startsWith(prefix)) || REQUIRED_FILES.includes(path),
);

const scratch = mkdtempSync(join(tmpdir(), 'vercelignore-'));
let excluded = [];
try {
  git(['init', '-q', '.'], scratch);
  writeFileSync(join(scratch, '.gitignore'), readFileSync(join(repoRoot, '.vercelignore')));
  // check-ignore exits 1 when nothing matches, which is the good case here.
  try {
    excluded = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: scratch,
      input: needed.join('\n'),
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch (err) {
    if (err.status !== 1) throw err;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const missingRequired = REQUIRED_FILES.filter(path => !tracked.includes(path));

// The build does not create the output directory — it is committed. Vercel
// fails the deployment outright when it is missing, after a build that
// otherwise succeeded, so check it here rather than discovering it there.
const { outputDirectory } = JSON.parse(readFileSync(join(repoRoot, 'vercel.json'), 'utf8'));
if (outputDirectory && !needed.some(path => path.startsWith(`${outputDirectory}/`))) {
  process.stderr.write(
    `vercel.json#outputDirectory is "${outputDirectory}", but no tracked file survives ` +
      'the upload under it — Vercel will fail with "No Output Directory found".\n',
  );
  process.exit(1);
}

if (excluded.length || missingRequired.length) {
  for (const path of excluded) {
    process.stderr.write(`.vercelignore excludes ${path}, which the deployment needs\n`);
  }
  for (const path of missingRequired) {
    process.stderr.write(`${path} is not tracked, so the deployment cannot build\n`);
  }
  process.stderr.write(
    '\nAnchor every .vercelignore pattern with a leading slash — a bare `name/` ' +
      'matches at any depth.\n',
  );
  process.exit(1);
}

process.stdout.write(`${needed.length} deployment file(s) checked, 0 problem(s)\n`);
