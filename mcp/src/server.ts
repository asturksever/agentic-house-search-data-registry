import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { registerCompareTool } from './tools/compare.js';
import { registerDatasetTools } from './tools/datasets.js';
import { registerLookupTool } from './tools/lookup.js';
import { registerReportTool } from './tools/report.js';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'UK neighbourhood research from government open data. postcode_lookup resolves a ' +
        'postcode to its geography; postcode_report gathers eleven categories of data about ' +
        'it; postcode_compare lines several postcodes up side by side; ' +
        'postcode_search_datasets and postcode_get_dataset cover the 45 underlying sources ' +
        'for anything the report does not answer directly. Every figure states the geography ' +
        'it describes and the period it covers — an LSOA is a neighbourhood of ~1,500 people ' +
        'and Ofcom mobile coverage describes a whole local authority, so read those before ' +
        'treating a number as being about one address. Coverage varies by UK nation and is ' +
        'reported explicitly rather than silently omitted.',
    },
  );

  registerReportTool(server);
  registerLookupTool(server);
  registerCompareTool(server);
  registerDatasetTools(server);

  return server;
}
