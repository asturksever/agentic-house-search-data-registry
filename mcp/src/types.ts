// Shapes produced by the shared provider layer in js/. Declared here rather
// than inferred, because that layer is plain JavaScript loaded at runtime.

export interface Benchmark {
  scope: string;
  name?: string;
  value: number;
  display?: string;
}

export interface Comparison {
  vs: string | null;
  vsName?: string;
  ratio: number | null;
  band: string | null;
  tone: 'good' | 'neutral' | 'watch' | 'poor';
  direction: string;
}

export interface Fact {
  key: string;
  label: string;
  shortLabel?: string;
  value: number | string;
  unit: string;
  display: string;
  kind: string;
  geography: { level: string; code: string | null; name?: string } | null;
  period: string | null;
  benchmarks: Benchmark[];
  comparison: Comparison | null;
  sourceId: string;
  note: string | null;
}

export type CategoryStatus =
  | 'ok'
  | 'partial'
  | 'unavailable'
  | 'out_of_coverage'
  | 'error';

export interface CategoryResult {
  id: string;
  label: string;
  status: CategoryStatus;
  facts: Fact[];
  notes: string[];
  errors: { sourceId: string; label?: string; message: string }[];
  sources: string[];
  alt?: { label: string; url: string } | null;
  mode?: 'live' | 'pack';
  fetchedAt?: string;
}

export interface Place {
  postcode: string;
  compact: string;
  outcode: string;
  incode: string;
  area: string;
  sector: string;
  lat: number;
  lng: number;
  country: string;
  region: string | null;
  ruc: string | null;
  nationalPark: string | null;
  district: { name: string; code: string };
  ward: { name: string; code: string };
  constituency: string;
  pfa: { name: string; code: string };
  lsoa: { name: string; code: string };
  msoa: { name: string; code: string };
  oa: string | null;
  imdRank: number | null;
}

export interface Provider {
  id: string;
  label: string;
  short?: string;
  registryIds: string[];
  labelFor?: (place: Place) => string;
  coverage?: (place: Place) => { ok: boolean; why?: string; alt?: { label: string; url: string } };
  run: (place: Place) => Promise<CategoryResult>;
}

export interface RegistrySource {
  id: string;
  dataset: string;
  publisher: string;
  link: string;
  api: string;
  api_docs: string;
  format: string;
  licence: string;
  coverage: string;
  update_frequency: string;
  questions: string[];
  category: string;
}

export interface Registry {
  title: string;
  description: string;
  generated: string;
  sources: RegistrySource[];
  byId: Record<string, RegistrySource>;
}

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}
