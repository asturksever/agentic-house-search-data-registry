import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CATEGORY_IDS, type CategoryId } from '../constants.js';
import { buildReport, getRegistry, isPostcodeError, lookupPostcode } from '../services/data.js';
import {
  capJson, capText, categoryMarkdown, placeHeading, sourceLines, toolError, withAttribution,
} from '../services/format.js';
import { ResponseFormat } from '../types.js';

const InputSchema = z.object({
  postcode: z
    .string()
    .min(5)
    .max(10)
    .describe('A UK postcode, with or without a space, e.g. "SW11 1AA" or "m11ae"'),
  categories: z
    .array(z.enum(CATEGORY_IDS))
    .optional()
    .describe(
      'Which sections to fetch. Omit for all eleven. Fetching only what you need is ' +
        'faster and much smaller — e.g. ["crime","schools"] for a family-safety question.',
    ),
  include_sources: z
    .boolean()
    .default(false)
    .describe('Append the publisher and licence of each dataset used (default false)'),
  response_format: z
    .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
    .default(ResponseFormat.MARKDOWN)
    .describe("'markdown' to read, 'json' for the full structured facts"),
});

const OutputSchema = {
  postcode: z.string(),
  local_authority: z.string(),
  country: z.string(),
  categories: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.string(),
      summary: z.string().optional(),
      facts: z.array(
        z.object({
          label: z.string(),
          value: z.union([z.number(), z.string()]),
          display: z.string(),
          unit: z.string().optional(),
          band: z.string().nullable().optional(),
          tone: z.string().nullable().optional(),
          benchmark: z.string().nullable().optional(),
          geography: z.string().nullable().optional(),
          period: z.string().nullable().optional(),
          source_id: z.string(),
          note: z.string().nullable().optional(),
        }),
      ),
      notes: z.array(z.string()),
    }),
  ),
};

export function registerReportTool(server: McpServer) {
  server.registerTool(
    'postcode_report',
    {
      title: 'UK postcode neighbourhood report',
      description: `Full neighbourhood report for one UK postcode, assembled live from UK government open data.

Covers eleven categories: demographics (Census 2021), crime (data.police.uk), deprivation (IMD/WIMD/SIMD/NIMDM), property prices (HM Land Registry), broadband and 5G (Ofcom), noise (Defra), transport, amenities (OpenStreetMap), schools (DfE register: name, phase and distance only, no Ofsted grades) and planning constraints (Planning Data platform, Environment Agency).

Every figure carries the geography it describes (a postcode, an LSOA of ~1,500 people, or a whole local authority), the period it covers, and a benchmark where one exists. Read those: a crime count describes a 1 km square, and Ofcom mobile coverage describes an entire local authority, not the street.

Args:
  - postcode (string): UK postcode, spaces optional
  - categories (string[], optional): subset to fetch; omit for all eleven
  - include_sources (boolean): append publisher and licence per category (default false)
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Per category: a status, a one-paragraph summary, the facts (label, value, band, benchmark, geography, period, source id) and any caveats.

  Statuses that are normal rather than failures:
  - "out_of_coverage": the dataset genuinely does not cover this nation. Census tables are England & Wales; police.uk excludes Scotland; Planning Data, Defra noise and the DfE school register are England-only. The reason and the devolved equivalent are given.
  - "unavailable": a pre-built extract has not been generated for this area yet (noise, currently).
  - "partial": some sources answered and some did not; check notes.

Examples:
  - "What's SW11 1AA like?" -> postcode="SW11 1AA"
  - "Is the broadband any good at M1 1AE?" -> postcode="M1 1AE", categories=["broadband","mobile"]
  - "Crime and schools near LA23 1AA" -> postcode="LA23 1AA", categories=["crime","schools"]

Errors:
  - "No such postcode" with suggestions when the postcode does not exist
  - Terminated postcodes are reported with the year they were withdrawn

Not a survey, valuation or conveyancing search. Check anything decision-critical against the source.`,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const { postcode, categories, include_sources, response_format } = params;
      let place;
      try {
        place = await lookupPostcode(postcode);
      } catch (err) {
        if (await isPostcodeError(err)) {
          const e = err as Error & { suggestions?: string[] };
          const suggestions = e.suggestions?.length
            ? ` Did you mean: ${e.suggestions.slice(0, 5).join(', ')}?`
            : '';
          return toolError(e.message, suggestions);
        }
        return toolError(
          `Could not look up ${postcode}: ${(err as Error).message}.`,
          'postcodes.io may be unreachable; retry shortly.',
        );
      }

      const report = await buildReport(place, { categories: categories as CategoryId[] });
      const registry = include_sources ? await getRegistry().catch(() => null) : null;

      const structured = {
        postcode: place.postcode,
        local_authority: place.district.name,
        country: place.country,
        categories: report.categories.map(c => ({
          id: c.id,
          label: c.label,
          status: c.status,
          summary: (c as { summary?: string }).summary,
          facts: c.facts.map(f => ({
            label: f.label,
            value: f.value,
            display: f.display,
            unit: f.unit,
            band: f.comparison?.band ?? null,
            tone: f.comparison?.tone ?? null,
            benchmark: f.benchmarks[0]
              ? `${f.benchmarks[0].name ?? f.benchmarks[0].scope}: ${f.benchmarks[0].display ?? f.benchmarks[0].value}`
              : null,
            geography: f.geography
              ? `${f.geography.level}: ${f.geography.name ?? f.geography.code}`
              : null,
            period: f.period,
            source_id: f.sourceId,
            note: f.note,
          })),
          notes: c.notes,
        })),
      };

      let text: string;
      if (response_format === ResponseFormat.JSON) {
        // Shed the least useful thing first: notes, then the tail of each
        // category's facts, then whole categories. Never a string slice.
        text = capJson(
          structured,
          'Request fewer categories to see everything.',
          current => {
            const withNotes = current.categories.find(c => c.notes.length);
            if (withNotes) {
              return { ...current, categories: current.categories.map(c => ({ ...c, notes: [] })) };
            }
            const longest = current.categories.reduce(
              (a, b) => (b.facts.length > a.facts.length ? b : a), current.categories[0]!);
            if (longest && longest.facts.length > 1) {
              return {
                ...current,
                categories: current.categories.map(c =>
                  c === longest ? { ...c, facts: c.facts.slice(0, -1) } : c),
              };
            }
            return current.categories.length > 1
              ? { ...current, categories: current.categories.slice(0, -1) }
              : null;
          },
        );
      } else {
        const lines = [`# ${placeHeading(place)}`, ''];
        lines.push(
          `Neighbourhood: ${place.lsoa.name} · Ward: ${place.ward.name} · Constituency: ${place.constituency}`,
          '',
        );
        for (const category of report.categories) {
          lines.push(categoryMarkdown(category as never));
          if (registry) {
            const sources = sourceLines(category, registry);
            if (sources.length) lines.push('Sources:', ...sources, '');
          }
        }
        text = withAttribution(lines.join('\n'));
      }

      return {
        content: [
          {
            type: 'text' as const,
            // capJson has already capped the JSON path; only markdown needs the
            // string cap, and cutting prose short is safe.
            text: response_format === ResponseFormat.JSON
              ? text
              : capText(text, 'Request fewer categories, or response_format="json" for a denser payload.'),
          },
        ],
        structuredContent: structured,
      };
    },
  );
}
