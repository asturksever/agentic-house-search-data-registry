// Card order on the report — roughly what a buyer asks first.

import demographics from './demographics.js';
import crime from './crime.js';
import deprivation from './deprivation.js';
import prices from './prices.js';
import broadband from './broadband.js';
import mobile from './mobile.js';
import noise from './noise.js';
import transport from './transport.js';
import amenities from './amenities.js';
import schools from './schools.js';
import environment from './environment.js';

export const PROVIDERS = [
  demographics,
  crime,
  deprivation,
  prices,
  broadband,
  mobile,
  noise,
  transport,
  amenities,
  schools,
  environment,
];
