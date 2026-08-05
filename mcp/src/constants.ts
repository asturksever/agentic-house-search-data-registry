export const SERVER_NAME = 'agentic-house-search';
export const SERVER_VERSION = '0.1.2';

/**
 * Where the data comes from. The published site is the default so `npx` works
 * with no setup; point AHS_BASE_URL at a local checkout served over HTTP
 * (`python3 -m http.server 8000`) to develop against uncommitted packs.
 */
export const DEFAULT_BASE_URL =
  'https://agentic-house-search.vercel.app/';

/** Cap on a single tool response, so a wide comparison cannot flood a context. */
export const CHARACTER_LIMIT = 25_000;

/** Every category the report can produce, in the order the site shows them. */
export const CATEGORY_IDS = [
  'demographics',
  'crime',
  'deprivation',
  'prices',
  'broadband',
  'mobile',
  'noise',
  'transport',
  'amenities',
  'schools',
  'environment',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Attribution the OGL and the ONS postcode licence require downstream users to carry. */
export const ATTRIBUTION =
  'Contains public sector information licensed under the Open Government Licence v3.0. ' +
  'Postcode geography contains OS data © Crown copyright and database right, Royal Mail ' +
  'data © Royal Mail copyright and database right, and National Statistics data © Crown ' +
  'copyright and database right. Amenity data © OpenStreetMap contributors (ODbL). ' +
  'Not a survey, valuation or conveyancing search.';
