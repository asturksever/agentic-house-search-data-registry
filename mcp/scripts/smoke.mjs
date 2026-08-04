// End-to-end smoke test: drive the built server over stdio exactly as a client
// would, and assert every tool answers.
//
// Run: npm run build && npm run smoke

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'dist', 'index.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const client = new Client({ name: 'smoke', version: '0.0.0' });
// StdioClientTransport passes only a safe subset of the environment through by
// default, which silently drops AHS_BASE_URL — so a run intended to test local
// data would quietly test the published site instead.
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...process.env },
}));
if (process.env.AHS_BASE_URL) console.log(`(reading data from ${process.env.AHS_BASE_URL})`);

const { tools } = await client.listTools();
const names = tools.map(t => t.name).sort();
check('lists five tools', names.length === 5, names.join(', '));
check('every tool has a description', tools.every(t => (t.description ?? '').length > 200));
check('every tool declares annotations', tools.every(t => t.annotations?.readOnlyHint === true));
check('every tool declares an output schema', tools.every(t => t.outputSchema));

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  return { text: res.content?.[0]?.text ?? '', structured: res.structuredContent, isError: !!res.isError };
};

// --- postcode_lookup
const lookup = await call('postcode_lookup', { postcode: 'SW11 1AA', response_format: 'json' });
check('lookup resolves a postcode', lookup.structured?.local_authority?.name === 'Wandsworth',
  lookup.structured?.local_authority?.name);
check('lookup names the deprivation index',
  String(lookup.structured?.deprivation_index ?? '').includes('32,844'));

const bad = await call('postcode_lookup', { postcode: 'ZZ9 9ZZ' });
check('lookup rejects a fake postcode', bad.isError, bad.text.slice(0, 60));

// --- postcode_report
const report = await call('postcode_report', {
  postcode: 'SW11 1AA', categories: ['crime', 'deprivation'], response_format: 'json',
});
check('report returns the requested categories only', report.structured?.categories?.length === 2);
check('report facts carry a source id',
  report.structured?.categories?.every(c => c.facts.every(f => f.source_id)));

// Coverage gates are the whole point of the honesty story — verify one.
const scotland = await call('postcode_report', {
  postcode: 'EH1 1YZ', categories: ['crime', 'demographics'], response_format: 'json',
});
check('Scottish postcode reports out_of_coverage rather than empty',
  scotland.structured?.categories?.every(c => c.status === 'out_of_coverage'),
  scotland.structured?.categories?.map(c => `${c.id}:${c.status}`).join(' '));

// --- postcode_compare
const compare = await call('postcode_compare', {
  postcodes: ['SW11 1AA', 'M1 1AE'], categories: ['broadband'], response_format: 'json',
});
check('compare produces rows across both postcodes',
  compare.structured?.rows?.length > 0 &&
  Object.keys(compare.structured.rows[0].values).length === 2);

const crossNation = await call('postcode_compare', {
  postcodes: ['SW11 1AA', 'EH1 1YZ'], categories: ['deprivation'], response_format: 'json',
});
check('compare warns when deprivation spans nations',
  crossNation.structured?.caveats?.some(c => c.includes('cannot be compared')));

// --- registry tools
const search = await call('postcode_search_datasets', { query: 'flood', response_format: 'json' });
check('dataset search finds flood sources', search.structured?.total >= 1,
  `${search.structured?.total} matches`);

const dataset = await call('postcode_get_dataset', { id: 'police-street-crime', response_format: 'json' });
check('get_dataset returns the full entry',
  dataset.structured?.questions?.length > 0 && !!dataset.structured?.api_docs);

const missing = await call('postcode_get_dataset', { id: 'not-a-real-id' });
check('get_dataset suggests alternatives for a bad id', missing.isError);

// --- the honesty defects, each of which shipped once and must not ship again

const schoolsCall = await client.callTool({
  name: 'postcode_report',
  arguments: { postcode: 'SW11 1AA', categories: ['schools'], response_format: 'markdown' },
});
const schoolsText = schoolsCall.content?.[0]?.text ?? '';
// The pack has no Ofsted grades. Nothing may imply it does.
check('schools never claims an Ofsted grade it does not have',
  !/Ofsted:\s*\w/.test(schoolsText) && !/GIAS\/Ofsted/.test(schoolsText),
  schoolsText.match(/Ofsted[^.]{0,60}/)?.[0] ?? 'no Ofsted claim');
check('schools declares the Ofsted gap instead of staying silent',
  /Ofsted grades are not in this extract/i.test(schoolsText));

const crimeReport = await call('postcode_report', { postcode: 'SW11 1AA', categories: ['crime'] });
const crimeFacts = crimeReport.structured?.categories?.[0]?.facts ?? [];
const total = crimeFacts.find(f => f.label === 'Recorded crimes');
check('crime count carries a national benchmark', !!total?.benchmark, total?.benchmark ?? 'none');
check('crime count is banded against the distribution', !!total?.band, total?.band ?? 'none');

// A truncated JSON response used to be sliced mid-token, handing the model
// something unparseable. Force truncation and confirm it still parses.
const big = await client.callTool({
  name: 'postcode_compare',
  arguments: {
    postcodes: ['SW11 1AA', 'M1 1AE', 'LA23 1AA', 'CF10 1EP'],
    categories: ['demographics', 'crime', 'prices', 'broadband', 'amenities', 'transport'],
    response_format: 'json',
  },
});
const bigText = big.content?.[0]?.text ?? '';
let parsed = null;
try { parsed = JSON.parse(bigText); } catch { /* the failure this test exists for */ }
check('an oversized JSON response is still valid JSON', parsed !== null,
  `${bigText.length} chars${parsed?.truncated ? ', truncated and flagged' : ''}`);

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
