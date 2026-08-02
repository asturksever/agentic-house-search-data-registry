// Postcode → Place. One postcodes.io call gives every geography the providers
// need (LSOA/MSOA/OA 2021 codes, local authority, ward, constituency, police
// force area) plus the IMD rank, so deprivation costs no extra request.

import { getJSON, HttpError } from './fetchx.js';

const API = 'https://api.postcodes.io';
// Deliberately permissive: postcodes.io is the authority on whether a postcode
// exists. This only catches obvious typos before spending a request.
const SHAPE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function normalise(input) {
  return String(input || '').toUpperCase().replace(/\s+/g, '');
}

export function looksLikePostcode(input) {
  return SHAPE.test(normalise(input));
}

export function pretty(compact) {
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

export class PostcodeError extends Error {
  constructor(message, { suggestions = [], terminated = null } = {}) {
    super(message);
    this.suggestions = suggestions;
    this.terminated = terminated;
  }
}

function toPlace(r) {
  const codes = r.codes || {};
  const compact = normalise(r.postcode);
  return {
    postcode: r.postcode,
    compact,
    outcode: r.outcode,
    incode: r.incode,
    // Packs shard by postcode area (the leading letters), and some datasets are
    // published at sector level ("SW11 1").
    area: (r.outcode.match(/^[A-Z]{1,2}/) || [''])[0],
    sector: `${r.outcode} ${r.incode[0]}`,
    lat: r.latitude,
    lng: r.longitude,
    country: r.country,
    region: r.region,
    ruc: r.ruc21 || r.ruc11 || null,
    nationalPark: r.national_park && !/non-National Park/i.test(r.national_park)
      ? r.national_park : null,
    district: { name: r.admin_district, code: codes.admin_district },
    ward: { name: r.admin_ward, code: codes.admin_ward },
    constituency: r.parliamentary_constituency_2024 || r.parliamentary_constituency,
    pfa: { name: r.pfa, code: codes.pfa },
    lsoa: { name: r.lsoa21 || r.lsoa, code: codes.lsoa21 || codes.lsoa },
    lsoa11: { name: r.lsoa11 || r.lsoa, code: codes.lsoa11 || codes.lsoa },
    msoa: { name: r.msoa21 || r.msoa, code: codes.msoa21 || codes.msoa },
    oa: r.oa21 || null,
    imdRank: r.index_of_multiple_deprivation ?? null,
  };
}

async function suggest(compact) {
  try {
    const res = await getJSON(`${API}/postcodes/${encodeURIComponent(compact)}/autocomplete`);
    return res.result || [];
  } catch { return []; }
}

async function terminatedLookup(compact) {
  try {
    const res = await getJSON(`${API}/terminated_postcodes/${encodeURIComponent(compact)}`);
    return res.result || null;
  } catch { return null; }
}

export async function lookup(input) {
  const compact = normalise(input);
  if (!compact) throw new PostcodeError('Enter a UK postcode.');
  if (!looksLikePostcode(compact)) {
    throw new PostcodeError(`"${input}" is not a UK postcode.`,
      { suggestions: await suggest(compact) });
  }

  try {
    const res = await getJSON(`${API}/postcodes/${encodeURIComponent(compact)}`);
    return toPlace(res.result);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      // A terminated postcode is a different story from a typo — say which.
      const dead = await terminatedLookup(compact);
      if (dead) {
        throw new PostcodeError(
          `${pretty(compact)} was withdrawn in ${String(dead.year_terminated)}. ` +
          'Withdrawn postcodes have no current geography, so there is nothing to report on.',
          { terminated: dead });
      }
      throw new PostcodeError(`No such postcode: ${pretty(compact)}.`,
        { suggestions: await suggest(compact) });
    }
    throw err;
  }
}
