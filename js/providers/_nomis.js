// Census 2021 via the Nomis API.
//
// One request returns the neighbourhood, its local authority and England
// together, which is how census facts arrive with their own benchmarks without
// spending extra calls.

import { getJSON } from '../fetchx.js';

const BASE = 'https://www.nomisweb.co.uk/api/v01/dataset';
const ENGLAND_AND_WALES = 'K04000001';

// Cell codes are stable Nomis category ids, checked against the published
// codelists — see tools/README for how to re-derive them if a table changes.
export const TABLES = {
  population: { id: 'NM_2021_1', dim: 'c2021_restype_3', cells: { total: 0 }, name: 'TS001' },
  age:        { id: 'NM_2018_1', dim: 'c2021_age_12a',
                cells: { total: 0, under16: [1, 2, 3], over65: [9, 10, 11] }, name: 'TS007B' },
  tenure:     { id: 'NM_2072_1', dim: 'c2021_tenure_9',
                cells: { total: 0, owned: 1001, social: 1003, privateRent: 1004 }, name: 'TS054' },
  quals:      { id: 'NM_2084_1', dim: 'c2021_hiqual_8',
                cells: { total: 0, level4plus: 6 }, name: 'TS067' },
};

function cellCodes(table) {
  return [...new Set(Object.values(table.cells).flat())].join(',');
}

/**
 * @returns {Promise<Object>} geogcode → { cellName: value }
 */
export async function fetchTable(table, geographies) {
  const url = `${BASE}/${table.id}.data.json` +
    `?geography=${geographies.join(',')}` +
    `&${table.dim}=${cellCodes(table)}` +
    '&measures=20100';
  const data = await getJSON(url, { timeout: 10000 });
  if (data.error) throw new Error(`Nomis ${table.name}: ${data.error}`);

  const out = {};
  for (const o of data.obs || []) {
    const geog = o.geography.geogcode;
    const code = o[table.dim].value;
    const value = o.obs_value.value;
    out[geog] = out[geog] || {};
    for (const [name, wanted] of Object.entries(table.cells)) {
      const codes = Array.isArray(wanted) ? wanted : [wanted];
      if (codes.includes(code)) out[geog][name] = (out[geog][name] || 0) + value;
    }
  }
  return out;
}

export function geographiesFor(place) {
  return [place.lsoa.code, place.district.code, ENGLAND_AND_WALES];
}

export const SCOPES = {
  local_authority: place => ({ scope: 'local_authority', name: place.district.name, code: place.district.code }),
  england_wales: () => ({ scope: 'england_wales', name: 'England & Wales', code: ENGLAND_AND_WALES }),
};

export { ENGLAND_AND_WALES };
