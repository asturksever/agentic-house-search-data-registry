import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getRegistry } from '../services/data.js';
import { capText, toolError } from '../services/format.js';
import type { RegistrySource } from '../types.js';
import { ResponseFormat } from '../types.js';

const SearchInputSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Free text matched against dataset name, publisher, category, API endpoint and the ' +
        'questions each dataset answers. Omit to list everything.',
    ),
  category: z
    .string()
    .max(80)
    .optional()
    .describe('Filter by category prefix, e.g. "Crime", "Transport", "Environment"'),
  limit: z.number().int().min(1).max(45).default(10).describe('Maximum results (default 10)'),
  offset: z.number().int().min(0).default(0).describe('Results to skip, for pagination'),
  response_format: z
    .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
    .default(ResponseFormat.MARKDOWN),
});

const SearchOutputSchema = {
  total: z.number(),
  count: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
  next_offset: z.number().optional(),
  datasets: z.array(
    z.object({
      id: z.string(),
      dataset: z.string(),
      publisher: z.string(),
      category: z.string(),
      api: z.string(),
      licence: z.string(),
      coverage: z.string(),
      update_frequency: z.string(),
    }),
  ),
};

const GetInputSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(60)
    .describe('Registry id, e.g. "police-street-crime" — find one with postcode_search_datasets'),
  response_format: z
    .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
    .default(ResponseFormat.MARKDOWN),
});

const GetOutputSchema = {
  id: z.string(),
  dataset: z.string(),
  publisher: z.string(),
  link: z.string(),
  api: z.string(),
  api_docs: z.string(),
  format: z.string(),
  licence: z.string(),
  coverage: z.string(),
  update_frequency: z.string(),
  questions: z.array(z.string()),
  category: z.string(),
};

const summarise = (s: RegistrySource) => ({
  id: s.id,
  dataset: s.dataset,
  publisher: s.publisher,
  category: s.category,
  api: s.api,
  licence: s.licence,
  coverage: s.coverage,
  update_frequency: s.update_frequency,
});

export function registerDatasetTools(server: McpServer) {
  server.registerTool(
    'postcode_search_datasets',
    {
      title: 'Search the UK open-data registry',
      description: `Search a curated registry of 45 UK open datasets and APIs for property and neighbourhood research.

Each entry records the dataset's home page, its machine-readable endpoint, format, licence, geographic coverage, update cadence, and the concrete questions it can answer. Use it to find the right source for something this server does not report directly — EPC ratings, planning applications, flood risk, council tax bands, bus timetables, air quality, ground stability, land ownership.

Args:
  - query (string, optional): free text over name, publisher, category, endpoint and questions
  - category (string, optional): category prefix, e.g. "Crime", "Transport", "Environment"
  - limit (number): 1-45, default 10
  - offset (number): pagination offset, default 0
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  { total, count, offset, has_more, next_offset, datasets: [{ id, dataset, publisher, category, api, licence, coverage, update_frequency }] }

Examples:
  - "Where do I get EPC data?" -> query="EPC"
  - "What flood datasets are there?" -> query="flood"
  - "List every transport source" -> category="Transport", limit=20

Follow up with postcode_get_dataset for the full entry including API docs and the questions it answers.`,
      inputSchema: SearchInputSchema.shape,
      outputSchema: SearchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, category, limit, offset, response_format }) => {
      const registry = await getRegistry().catch(() => null);
      if (!registry) {
        return toolError(
          'Could not load the dataset registry.',
          'The registry is served over HTTPS from GitHub Pages; check connectivity or set AHS_BASE_URL.',
        );
      }

      const needle = query?.toLowerCase().trim();
      const matched = registry.sources.filter(s => {
        if (category && !s.category.toLowerCase().startsWith(category.toLowerCase())) return false;
        if (!needle) return true;
        const haystack = [s.id, s.dataset, s.publisher, s.category, s.api, s.link, s.format,
          ...s.questions].join(' ').toLowerCase();
        return haystack.includes(needle);
      });

      const page = matched.slice(offset, offset + limit);
      const hasMore = matched.length > offset + page.length;
      const structured = {
        total: matched.length,
        count: page.length,
        offset,
        has_more: hasMore,
        ...(hasMore ? { next_offset: offset + page.length } : {}),
        datasets: page.map(summarise),
      };

      if (!page.length) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `No datasets match${needle ? ` "${query}"` : ''}${category ? ` in category "${category}"` : ''}. ` +
                'Try a broader query, or omit both filters to list all 45.',
            },
          ],
          structuredContent: structured,
        };
      }

      const text =
        response_format === ResponseFormat.JSON
          ? JSON.stringify(structured, null, 2)
          : [
              `# ${matched.length} dataset${matched.length === 1 ? '' : 's'} matched (showing ${page.length})`,
              '',
              ...page.flatMap(s => [
                `## ${s.dataset}`,
                `- **id**: \`${s.id}\``,
                `- **Publisher**: ${s.publisher}`,
                `- **Category**: ${s.category}`,
                `- **API**: \`${s.api}\``,
                `- **Licence**: ${s.licence}`,
                `- **Coverage**: ${s.coverage} · updated ${s.update_frequency}`,
                '',
              ]),
              ...(hasMore ? [`More available — call again with offset=${offset + page.length}.`] : []),
            ].join('\n');

      return {
        content: [
          { type: 'text' as const, text: capText(text, 'Use a smaller limit or a narrower query.') },
        ],
        structuredContent: structured,
      };
    },
  );

  server.registerTool(
    'postcode_get_dataset',
    {
      title: 'Get one registry dataset entry',
      description: `Full registry entry for one dataset, by id.

Returns everything needed to call the source yourself: its home page, machine-readable endpoint, API documentation, format, licence, geographic coverage, update cadence, and the concrete questions it can answer.

Args:
  - id (string): registry id, e.g. "police-street-crime", "land-registry-ppd", "ea-flood"
  - response_format ('markdown' | 'json'): default 'markdown'

Examples:
  - "How do I call the police API?" -> id="police-street-crime"
  - "What licence is Price Paid under?" -> id="land-registry-ppd"

Errors:
  - Returns the closest matching ids when the id is not found.`,
      inputSchema: GetInputSchema.shape,
      outputSchema: GetOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, response_format }) => {
      const registry = await getRegistry().catch(() => null);
      if (!registry) {
        return toolError(
          'Could not load the dataset registry.',
          'Check connectivity or set AHS_BASE_URL.',
        );
      }

      const source = registry.byId[id];
      if (!source) {
        const near = registry.sources
          .filter(s => s.id.includes(id.slice(0, 4)) || id.includes(s.id.slice(0, 4)))
          .slice(0, 5)
          .map(s => s.id);
        return toolError(
          `No dataset with id "${id}".`,
          near.length
            ? `Closest ids: ${near.join(', ')}. Or search with postcode_search_datasets.`
            : 'Use postcode_search_datasets to find valid ids.',
        );
      }

      const text =
        response_format === ResponseFormat.JSON
          ? JSON.stringify(source, null, 2)
          : [
              `# ${source.dataset}`,
              '',
              `- **id**: \`${source.id}\``,
              `- **Publisher**: ${source.publisher}`,
              `- **Category**: ${source.category}`,
              `- **Home**: ${source.link}`,
              `- **API**: \`${source.api}\``,
              `- **API docs**: ${source.api_docs}`,
              `- **Format**: ${source.format}`,
              `- **Licence**: ${source.licence}`,
              `- **Coverage**: ${source.coverage}`,
              `- **Updated**: ${source.update_frequency}`,
              '',
              '## Questions this answers',
              ...source.questions.map(q => `- ${q}`),
            ].join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { ...source },
      };
    },
  );
}
