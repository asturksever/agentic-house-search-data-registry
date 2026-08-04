import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { isPostcodeError, lookupPostcode } from '../services/data.js';
import { placeDetail, placeHeading, toolError } from '../services/format.js';
import { ResponseFormat } from '../types.js';

const InputSchema = z.object({
  postcode: z.string().min(5).max(10).describe('A UK postcode, e.g. "SW11 1AA"'),
  response_format: z
    .enum([ResponseFormat.MARKDOWN, ResponseFormat.JSON])
    .default(ResponseFormat.MARKDOWN)
    .describe("'markdown' to read, 'json' for the structured record"),
});

const OutputSchema = {
  postcode: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string(),
  region: z.string().nullable(),
  local_authority: z.object({ name: z.string(), code: z.string() }),
  ward: z.object({ name: z.string(), code: z.string() }),
  constituency: z.string(),
  lsoa: z.object({ name: z.string(), code: z.string() }),
  msoa: z.object({ name: z.string(), code: z.string() }),
  output_area: z.string().nullable(),
  police_force: z.string(),
  rural_urban: z.string().nullable(),
  national_park: z.string().nullable(),
  deprivation_rank: z.number().nullable(),
  deprivation_index: z.string().nullable(),
};

// Each nation ranks its own areas against its own index; the counts are what
// make a rank interpretable, and mixing them across nations is meaningless.
const INDEX_BY_COUNTRY: Record<string, string> = {
  England: 'Index of Multiple Deprivation 2019 (32,844 LSOAs)',
  Wales: 'Welsh Index of Multiple Deprivation 2019 (1,909 LSOAs)',
  Scotland: 'Scottish Index of Multiple Deprivation 2020 (6,976 data zones)',
  'Northern Ireland': 'NI Multiple Deprivation Measure 2017 (890 SOAs)',
};

export function registerLookupTool(server: McpServer) {
  server.registerTool(
    'postcode_lookup',
    {
      title: 'Look up UK postcode geography',
      description: `Resolve a UK postcode to its geography — coordinates, local authority, ward, constituency, LSOA/MSOA/output area, police force, rural-urban class and deprivation rank.

One fast call with no downstream data fetching. Use it to check a postcode exists, to get the codes needed for other datasets, or when you only need where somewhere is rather than what it is like.

Args:
  - postcode (string): UK postcode, spaces optional
  - response_format ('markdown' | 'json'): default 'markdown'

Returns:
  Coordinates, administrative geography, statistical geography codes (LSOA/MSOA/OA — these are the keys most UK open datasets are published against), and the deprivation rank with the index it came from.

Examples:
  - "Where is SW11 1AA?" -> postcode="SW11 1AA"
  - "What LSOA covers M1 1AE?" -> postcode="M1 1AE"
  - "Is XY1 2AB a real postcode?" -> postcode="XY1 2AB" (returns an error with suggestions)

Don't use when: you want data about the area — use postcode_report instead.

Note: deprivation ranks are NOT comparable between UK nations. Each nation ranks its own areas against its own index, over a different number of areas; the index and its size are returned so you do not compare them by mistake.`,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ postcode, response_format }) => {
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

      const structured = {
        postcode: place.postcode,
        latitude: place.lat,
        longitude: place.lng,
        country: place.country,
        region: place.region,
        local_authority: place.district,
        ward: place.ward,
        constituency: place.constituency,
        lsoa: place.lsoa,
        msoa: place.msoa,
        output_area: place.oa,
        police_force: place.pfa.name,
        rural_urban: place.ruc,
        national_park: place.nationalPark,
        deprivation_rank: place.imdRank,
        deprivation_index: INDEX_BY_COUNTRY[place.country] ?? null,
      };

      const text =
        response_format === ResponseFormat.JSON
          ? JSON.stringify(structured, null, 2)
          : [
              `# ${placeHeading(place)}`,
              '',
              ...placeDetail(place),
              `- **Police force**: ${place.pfa.name}`,
              `- **MSOA**: ${place.msoa.name} (${place.msoa.code})`,
              ...(place.oa ? [`- **Output area**: ${place.oa}`] : []),
              ...(place.imdRank
                ? [
                    `- **Deprivation rank**: ${place.imdRank.toLocaleString('en-GB')} — ${
                      INDEX_BY_COUNTRY[place.country] ?? 'national index'
                    }`,
                  ]
                : []),
              ...(place.nationalPark ? [`- **National park**: ${place.nationalPark}`] : []),
            ].join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: structured,
      };
    },
  );
}
