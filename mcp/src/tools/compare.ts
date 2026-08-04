import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CATEGORY_IDS, type CategoryId } from '../constants.js';
import { buildReport, isPostcodeError, lookupPostcode } from '../services/data.js';
import { capJson, capText, toolError, withAttribution } from '../services/format.js';
import type { CategoryResult, Place } from '../types.js';
import { ResponseFormat } from '../types.js';

const InputSchema = z.object({
  postcodes: z
    .array(z.string().min(5).max(10))
    .min(2)
    .max(5)
    .describe('Two to five UK postcodes to compare, e.g. ["SW11 1AA", "M1 1AE"]'),
  categories: z
    .array(z.enum(CATEGORY_IDS))
    .min(1)
    .max(6)
    .describe(
      'Which categories to compare on. Keep it tight — comparing all eleven across five ' +
        'postcodes produces a very large answer.',
    ),
  response_format: z
    .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
    .default(ResponseFormat.MARKDOWN)
    .describe("'markdown' for a side-by-side table, 'json' for the structured comparison"),
});

const OutputSchema = {
  postcodes: z.array(z.string()),
  categories: z.array(z.string()),
  rows: z.array(
    z.object({
      category: z.string(),
      measure: z.string(),
      values: z.record(
        z.string(),
        z.object({
          display: z.string().nullable(),
          value: z.union([z.number(), z.string()]).nullable(),
          band: z.string().nullable(),
          tone: z.string().nullable(),
          status: z.string(),
        }),
      ),
    }),
  ),
  caveats: z.array(z.string()),
};

export function registerCompareTool(server: McpServer) {
  server.registerTool(
    'postcode_compare',
    {
      title: 'Compare UK postcodes side by side',
      description: `Compare two to five UK postcodes on chosen categories, aligned measure by measure.

Fetches each postcode's report concurrently and lines the facts up in a table, so you can answer "which of these is better connected / quieter / cheaper" in one call instead of several.

Args:
  - postcodes (string[]): 2-5 UK postcodes
  - categories (string[]): 1-6 of demographics, crime, deprivation, prices, broadband, mobile, noise, transport, amenities, schools, environment
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  One row per measure with a column per postcode, each cell carrying the value, its band, and the category status for that postcode. Caveats collect anything that makes a row not strictly comparable.

Comparability warnings you must respect, and which this tool surfaces:
  - Deprivation ranks from different UK nations are NOT comparable — different indices over different numbers of areas.
  - A measure missing for one postcode because the dataset does not cover that nation is not a low score; the cell says "out_of_coverage".
  - Ofcom mobile figures describe a whole local authority, so two postcodes in the same authority will always be identical.
  - Crime counts describe a 1 km square and depend on each police force submitting data; a very low count can be a gap rather than a quiet street.

Examples:
  - "Which has better broadband, SW11 1AA or M1 1AE?" -> postcodes=[...], categories=["broadband"]
  - "Compare these three on crime and schools" -> categories=["crime","schools"]

Don't use when: you have one postcode (use postcode_report) or want the underlying datasets (use postcode_search_datasets).`,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ postcodes, categories, response_format }) => {
      const looked = await Promise.all(
        postcodes.map(async pc => {
          try {
            return { pc, place: await lookupPostcode(pc), error: null as string | null };
          } catch (err) {
            const message = (await isPostcodeError(err))
              ? (err as Error).message
              : `Lookup failed: ${(err as Error).message}`;
            return { pc, place: null, error: message };
          }
        }),
      );

      const bad = looked.filter(l => l.error);
      if (bad.length === looked.length) {
        return toolError(
          `None of those postcodes could be resolved: ${bad.map(b => `${b.pc} (${b.error})`).join('; ')}.`,
        );
      }

      const usable = looked.filter(l => l.place) as { pc: string; place: Place }[];
      const reports = await Promise.all(
        usable.map(async ({ pc, place }) => ({
          pc: place.postcode,
          input: pc,
          place,
          report: await buildReport(place, { categories: categories as CategoryId[] }),
        })),
      );

      const columns = reports.map(r => r.pc);
      const caveats: string[] = bad.map(b => `${b.pc}: ${b.error}`);

      // Union of measures, in the order the first postcode that has them produced.
      const rows: {
        category: string;
        measure: string;
        values: Record<string, {
          display: string | null; value: number | string | null;
          band: string | null; tone: string | null; status: string;
        }>;
      }[] = [];

      const byPostcode = new Map<string, Map<string, CategoryResult>>();
      for (const r of reports) {
        byPostcode.set(r.pc, new Map(r.report.categories.map(c => [c.id, c])));
      }

      for (const categoryId of categories) {
        const measures: string[] = [];
        for (const r of reports) {
          const cat = byPostcode.get(r.pc)?.get(categoryId);
          for (const fact of cat?.facts ?? []) {
            if (!measures.includes(fact.label)) measures.push(fact.label);
          }
        }

        for (const measure of measures) {
          const values: (typeof rows)[number]['values'] = {};
          for (const r of reports) {
            const cat = byPostcode.get(r.pc)?.get(categoryId);
            const fact = cat?.facts.find(f => f.label === measure);
            values[r.pc] = {
              display: fact?.display ?? null,
              value: fact?.value ?? null,
              band: fact?.comparison?.band ?? null,
              tone: fact?.comparison?.tone ?? null,
              status: cat?.status ?? 'unavailable',
            };
          }
          rows.push({ category: categoryId, measure, values });
        }

        // A category that produced nothing anywhere is worth saying out loud.
        for (const r of reports) {
          const cat = byPostcode.get(r.pc)?.get(categoryId);
          if (cat && cat.status === 'out_of_coverage') {
            caveats.push(`${categoryId} for ${r.pc}: ${cat.notes[0] ?? 'not covered'}`);
          }
        }
      }

      const countries = new Set(reports.map(r => r.place.country));
      if (categories.includes('deprivation' as CategoryId) && countries.size > 1) {
        caveats.push(
          'These postcodes span more than one UK nation, so their deprivation ranks come ' +
            'from different indices over different numbers of areas and cannot be compared directly.',
        );
      }
      const authorities = reports.map(r => r.place.district.name);
      if (categories.includes('mobile' as CategoryId) && new Set(authorities).size < authorities.length) {
        caveats.push(
          'Two or more of these postcodes share a local authority, and Ofcom publishes mobile ' +
            'coverage only at authority level — identical mobile figures do not mean identical streets.',
        );
      }

      const structured = { postcodes: columns, categories, rows, caveats };

      let text: string;
      if (response_format === ResponseFormat.JSON) {
        // Drop whole measure rows from the end rather than slicing the string.
        text = capJson(
          structured,
          'Compare fewer postcodes or fewer categories.',
          current => (current.rows.length > 1
            ? { ...current, rows: current.rows.slice(0, -1) }
            : null),
        );
      } else {
        const lines = [`# Comparing ${columns.join(' · ')}`, ''];
        lines.push(
          `| Measure | ${columns.join(' | ')} |`,
          `| --- | ${columns.map(() => '---').join(' | ')} |`,
        );
        let lastCategory = '';
        for (const row of rows) {
          if (row.category !== lastCategory) {
            lines.push(`| **${row.category}** | ${columns.map(() => '').join(' | ')} |`);
            lastCategory = row.category;
          }
          const cells = columns.map(pc => {
            const cell = row.values[pc]!;
            if (cell.display === null) return `— (${cell.status})`;
            return cell.band ? `${cell.display} (${cell.band})` : cell.display;
          });
          lines.push(`| ${row.measure} | ${cells.join(' | ')} |`);
        }
        if (caveats.length) {
          lines.push('', '## Caveats', ...caveats.map(c => `- ${c}`));
        }
        text = withAttribution(lines.join('\n'));
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: response_format === ResponseFormat.JSON
              ? text
              : capText(text, 'Compare fewer postcodes or fewer categories.'),
          },
        ],
        structuredContent: structured,
      };
    },
  );
}
