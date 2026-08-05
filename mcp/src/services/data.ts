// The bridge to the shared provider layer.
//
// js/ is plain ES modules written for the browser and copied into dist/js at
// build time, so it is loaded dynamically and typed here rather than compiled.
// Everything downstream — tools, formatting — works against those types.

import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { DEFAULT_BASE_URL, type CategoryId } from '../constants.js';
import type { CategoryResult, Place, Provider, Registry } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));

// Normally the provider modules sit beside the compiled output, where the build
// copied them. A bundler that inlines this file — the serverless deployment does
// — moves it away from them, so AHS_JS_ROOT names the directory instead. Read at
// call time rather than at import time, because a host that sets it in its own
// module body would otherwise lose the race against this one.
function jsRoot(): string {
  const override = process.env.AHS_JS_ROOT;
  if (!override) return join(here, '..', 'js');
  return isAbsolute(override) ? override : resolvePath(process.cwd(), override);
}

const load = (relative: string) =>
  import(pathToFileURL(join(jsRoot(), relative)).href) as Promise<any>;

let ready: Promise<{
  providers: Provider[];
  lookup: (input: string) => Promise<Place>;
  loadRegistry: () => Promise<Registry>;
  narrate: (res: CategoryResult, place: Place, opts?: { skipNotes?: boolean }) => string;
  PostcodeError: new (...args: any[]) => Error;
}> | null = null;

/**
 * Load the provider layer once and point it at a site root.
 *
 * A failure clears the cached promise rather than keeping it. The CLI exits on a
 * bad startup either way, but a serverless instance stays alive: caching the
 * rejection would poison that instance for its whole life over one transient
 * network blip, and every request it then served would fail identically.
 */
export function init(baseUrl = process.env.AHS_BASE_URL || DEFAULT_BASE_URL) {
  if (!ready) {
    ready = (async () => {
      const config = await load('config.js');
      config.setBase(baseUrl);
      const [geo, providers, registry, narrate] = await Promise.all([
        load('geo.js'),
        load('providers/index.js'),
        load('registry.js'),
        load('narrate.js'),
      ]);
      return {
        providers: providers.PROVIDERS as Provider[],
        lookup: geo.lookup,
        loadRegistry: registry.loadRegistry,
        narrate: narrate.narrate,
        PostcodeError: geo.PostcodeError,
      };
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export async function lookupPostcode(postcode: string): Promise<Place> {
  const { lookup } = await init();
  return lookup(postcode);
}

export async function getRegistry(): Promise<Registry> {
  const { loadRegistry } = await init();
  return loadRegistry();
}

/** True when the thrown error is a postcode problem rather than a network one. */
export async function isPostcodeError(err: unknown): Promise<boolean> {
  const { PostcodeError } = await init();
  return err instanceof PostcodeError;
}

export interface ReportOptions {
  categories?: CategoryId[];
}

export interface Report {
  place: Place;
  categories: CategoryResult[];
}

/**
 * Run the requested categories concurrently. A provider is contractually
 * required to handle its own failures, so a category always comes back with a
 * status — `out_of_coverage` for Scotland's census, `unavailable` for a pack
 * that has not been built — rather than throwing and losing the rest.
 */
export async function buildReport(
  place: Place,
  options: ReportOptions = {},
): Promise<Report> {
  const { providers, narrate } = await init();
  const wanted = options.categories?.length
    ? providers.filter(p => (options.categories as string[]).includes(p.id))
    : providers;

  const categories = await Promise.all(
    wanted.map(async provider => {
      const base = {
        id: provider.id,
        label: provider.labelFor ? provider.labelFor(place) : provider.label,
        sources: provider.registryIds,
      };
      try {
        const gate = provider.coverage ? provider.coverage(place) : { ok: true };
        if (!gate.ok) {
          return {
            ...base,
            status: 'out_of_coverage' as const,
            facts: [],
            notes: [gate.why ?? 'Not covered for this postcode.'],
            errors: [],
            alt: gate.alt ?? null,
            summary: gate.why ?? 'Not covered for this postcode.',
          };
        }
        const result = await provider.run(place);
        return {
          ...result,
          ...base,
          summary: narrate(result, place, { skipNotes: true }),
        };
      } catch (err) {
        return {
          ...base,
          status: 'error' as const,
          facts: [],
          notes: [`This section failed unexpectedly: ${(err as Error).message}`],
          errors: [],
          summary: `This section failed unexpectedly: ${(err as Error).message}`,
        };
      }
    }),
  );

  return { place, categories: categories as CategoryResult[] };
}

export async function listProviders(): Promise<Provider[]> {
  const { providers } = await init();
  return providers;
}
