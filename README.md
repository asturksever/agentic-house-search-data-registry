# Agentic House Search Data Registry

A machine-readable registry of **45 UK open datasets and APIs** for automated house and neighbourhood research — everything an agent needs to answer "should I buy here?" without a human opening 20 browser tabs.

**Live site:** https://asturksever.github.io/agentic-house-search-data-registry/

Each entry records the dataset's home page, its machine-readable API endpoint, format, licence, geographic coverage, update cadence, and the concrete questions it can answer.

## Why this exists

UK property intelligence sites (CrystalRoof, PropertyData, and others) are largely assembled from public data. This registry maps out that raw material — the Open Government Licence datasets and free APIs underneath — so anyone building an agentic property search can go straight to the source.

## Contents

| File | Description |
| --- | --- |
| [`data/registry.json`](data/registry.json) | Canonical machine-readable registry |
| [`data/registry.csv`](data/registry.csv) | Flat table for spreadsheets (generated) |
| [`index.html`](index.html) | Searchable catalogue of every entry |
| [`report.html`](report.html) | Postcode report — pulls live values out of these sources for one postcode |
| [`tools/`](tools) | `gen_derived.py` (regenerates the CSV and the README tables), `validate_registry.py`, `check_provider_ids.py` |

Both pages fetch `data/registry.json` at runtime, so they need to be served over
HTTP rather than opened from disk: `python3 -m http.server 8000`, then
<http://localhost:8000/>.

## Postcode report

[`report.html`](report.html) is the registry pointed at a single postcode: enter
one and it fetches the real values out of these sources and writes a plain
paragraph per category — who lives here, crime, deprivation, prices, fibre, 5G,
noise, transport, amenities, schools, planning constraints.

It runs entirely in the browser. Most sources are called directly (postcodes.io,
data.police.uk, Nomis, HM Land Registry, Planning Data, the Environment Agency,
TfL, Overpass); the three that publish bulk files instead of an API — Ofcom
fibre, Ofcom mobile, the DfE school register — are pre-joined into `packs/` by
[`tools/packbuild`](tools/packbuild/README.md).

Results open with a tile per category — the headline figure and how it rates —
then one card each with the numbers behind it. Ratings are colour-coded, but
never by colour alone: each carries a glyph (▲ good, ● typical, ◆ worth a look,
▼ needs attention) and the band in words, so the meaning survives greyscale,
printing and colour blindness. Categories that cannot be judged good or bad — a
house price is neither — stay deliberately uncoloured.

Two things it will not do. It never invents a comparison: every band word
("above the UK average") comes from `js/thresholds.js` and always sits next to
the figure it describes, which is in the table below the paragraph. And it never
pretends to cover ground it does not — a Scottish postcode gets an explicit
"data.police.uk does not publish Scottish data" with a link to Police Scotland,
not a blank card. Deprivation deciles are computed against each nation's own
index and denominator.

An **AI summary** is optional and off by default. There is no server here to
keep an API key in, so it uses one you paste yourself, stored in your own
browser and sent to nothing but `api.anthropic.com`. The model is given only
the computed facts, and every number it writes back is checked against them —
anything untraceable is flagged rather than shown quietly. Without a key there
is a "copy the prompt" button, and the report is complete either way.

Local development (both pages fetch `data/registry.json`, which `file://`
blocks):

```bash
python3 -m http.server 8000   # then http://localhost:8000/report.html?postcode=SW111AA
```

## MCP server

[`mcp/`](mcp/README.md) exposes all of this to AI agents over the Model Context
Protocol — five tools: a full postcode report, a fast geography lookup, a
side-by-side comparison of up to five postcodes, and search/fetch over the
registry itself.

```json
{
  "mcpServers": {
    "uk-postcode": { "command": "npx", "args": ["-y", "uk-postcode-mcp-server"] }
  }
}
```

It runs the **same** provider modules as `report.html` rather than a
reimplementation, so a threshold, a coverage gate or a caveat is written once
and both surfaces agree. stdio by default; `--http` for a streamable HTTP
endpoint. See [`mcp/README.md`](mcp/README.md).

## Schema

```json
{
  "id": "police-street-crime",
  "dataset": "Street-level crime, outcomes and stop & search",
  "publisher": "Home Office / UK police forces (data.police.uk)",
  "link": "https://data.police.uk/",
  "api": "https://data.police.uk/api/crimes-street/all-crime?lat={lat}&lng={lng}&date={YYYY-MM}",
  "api_docs": "https://data.police.uk/docs/",
  "format": "JSON REST API (no key required); CSV bulk downloads",
  "licence": "Open Government Licence v3",
  "coverage": "England, Wales & Northern Ireland",
  "update_frequency": "Monthly",
  "questions": [
    "How safe is this postcode / street compared with the borough or national average?",
    "What are the most common offence types here (burglary, ASB, drugs, vehicle crime)?",
    "Is crime trending up or down over the last 12-36 months?",
    "Where are the local crime hotspots and what happened to each case (outcomes)?"
  ],
  "category": "Crime"
}
```

## Datasets by category

### Crime

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Street-level crime, outcomes and stop & search](https://data.police.uk/) | Home Office / UK police forces (data.police.uk) | `https://data.police.uk/api/crimes-street/all-crime?lat={lat}&lng={lng}&date={YYYY-MM}` | Open Government Licence v3 |

### Demographics

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Census 2021 (ethnicity, religion, age, household composition, tenure, occupation, qualifications)](https://www.ons.gov.uk/census) | Office for National Statistics | `https://api.beta.ons.gov.uk/v1/population-types` | Open Government Licence v3 |

### Demographics / Overview

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Output Area Classification (OAC 2021) & London Output Area Classification (LOAC)](https://data.london.gov.uk/dataset/london-area-classification) | ONS / Greater London Authority (London Datastore) | `https://data.london.gov.uk/api/action/package_show?id=london-area-classification` | Open Government Licence v3 |

### Affluence

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Small area model-based income estimates (MSOA) + approximated social grade & qualifications (Census tables TS062/TS067)](https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales) | Office for National Statistics | `https://www.nomisweb.co.uk/api/v01/dataset/def.sdmx.json` | Open Government Licence v3 |

### Affluence (Deprivation)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [English Indices of Multiple Deprivation (IMD 2019)](https://www.gov.uk/government/statistics/english-indices-of-deprivation-2019) | MHCLG (Ministry of Housing, Communities & Local Government) | `https://opendatacommunities.org/sparql` | Open Government Licence v3 |

### Property prices

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Price Paid Data (every residential sale) + UK House Price Index](https://www.gov.uk/government/collections/price-paid-data) | HM Land Registry | `https://landregistry.data.gov.uk/landregistry/query` | Open Government Licence v3 (address fields have extra conditions) |

### Property prices (Rents)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Price Index of Private Rents & private rental market summary statistics](https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/latest) | Office for National Statistics / Valuation Office Agency | `https://api.beta.ons.gov.uk/v1/datasets` | Open Government Licence v3 |

### Ownership & tenure

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [INSPIRE Index Polygons](https://use-land-property-data.service.gov.uk/datasets/inspire) | HM Land Registry | `https://use-land-property-data.service.gov.uk/datasets/inspire/download` | Open Government Licence v3 (INSPIRE end-user licence) |
| [CCOD / OCOD](https://use-land-property-data.service.gov.uk/datasets/ccod) | HM Land Registry | `https://use-land-property-data.service.gov.uk/api/v1/datasets/ccod` | Free for non-commercial use; commercial licence available |
| [Companies House](https://find-and-update.company-information.service.gov.uk/) | Companies House | `https://api.company-information.service.gov.uk/search/companies?q={name}` | Open Government Licence v3 |
| [Council Tax valuation bands (per-property band A–H) and VOA band statistics](https://www.gov.uk/council-tax-bands) | Valuation Office Agency / GOV.UK | `https://www.tax.service.gov.uk/check-council-tax-band/search` | Open Government Licence v3 |
| [Council tax levels set by local authorities (Band D charge by council & parish)](https://www.gov.uk/government/collections/council-tax-statistics) | MHCLG | `CSV/ODS releases on GOV.UK` | Open Government Licence v3 |

### Planning & constraints

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Planning Data platform](https://www.planning.data.gov.uk/dataset/) | MHCLG (planning.data.gov.uk) | `https://www.planning.data.gov.uk/entity.json?dataset=conservation-area&latitude={lat}&longitude={lng}` | Open Government Licence v3 |
| [National Heritage List for England](https://historicengland.org.uk/listing/the-list/) | Historic England | `https://opendata-historicengland.hub.arcgis.com/` | Open Government Licence v3 |
| [Planning applications aggregated from every UK local authority register](https://www.planit.org.uk/) | PlanIt (open aggregator of LA planning portals) | `https://www.planit.org.uk/api/applics/json?lat={lat}&lng={lng}&krad=1&recent=200` | Source records are OGL LA data; aggregator has its own terms |

### Ground risk

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [BGS GeoSure (subsidence, shrink–swell clay, landslide, soluble rocks) and Radon Potential](https://www.bgs.ac.uk/datasets/geosure/) | British Geological Survey | `https://map.bgs.ac.uk/arcgis/services` | Open viewing under BGS OpenGeoscience; commercial licence for full datasets |
| [Mining Reporting Areas and coal mining hazards](https://www.gov.uk/government/organisations/the-coal-authority) | The Coal Authority (Mining Remediation Authority) | `https://opendata-coalauthority.hub.arcgis.com/` | Open Government Licence v3 |

### Noise

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Strategic noise mapping Round 4 (2022)](https://www.gov.uk/government/publications/strategic-noise-mapping-2022) | Defra / Environment Agency (Data Services Platform) | `https://environment.data.gov.uk/dataset/562c9d56-7c2d-4d42-83bb-578d6e97a517` | Open Government Licence v3 |

### Transport

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [NaPTAN](https://beta-naptan.dft.gov.uk/) | Department for Transport | `https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv` | Open Government Licence v3 |

### Transport (London)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [TfL Unified API](https://tfl.gov.uk/info-for/open-data-users/) | Transport for London | `https://api.tfl.gov.uk/` | TfL open data licence (free) |

### Transport (Connectivity score)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [PTAL](https://data.london.gov.uk/dataset/public-transport-accessibility-levels) | Transport for London / GLA (London Datastore) | `https://data.london.gov.uk/api/action/package_show?id=public-transport-accessibility-levels` | Open Government Licence / TfL terms |

### Transport (extended)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Bus Open Data Service](https://data.bus-data.dft.gov.uk/) | Department for Transport | `https://data.bus-data.dft.gov.uk/api/v1/dataset/?api_key={key}` | Open Government Licence v3 |
| [Rail Data Marketplace / Darwin](https://raildata.org.uk/) | Rail Delivery Group / National Rail | `https://raildata.org.uk/` | Free for registered users (National Rail terms) |
| [Journey Time Statistics](https://www.gov.uk/government/collections/journey-time-statistics) | Department for Transport | `CSV/ODS bulk on GOV.UK, keyed by LSOA` | Open Government Licence v3 |
| [STATS19 road safety data](https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-safety-data) | Department for Transport | `CSV bulk` | Open Government Licence v3 |
| [National Chargepoint Registry](https://www.national-charge-point-registry.uk/) | Department for Transport / OZEV | `https://chargepoints.dft.gov.uk/api/retrieve/registry/format/json` | Open Government Licence v3 |

### Amenities

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Food Hygiene Rating Scheme](https://ratings.food.gov.uk/) | Food Standards Agency | `https://api.ratings.food.gov.uk/Establishments?latitude={lat}&longitude={lng}&maxDistanceLimit={miles}` | Open Government Licence v3 |
| [Active Places Power](https://www.activeplacespower.com/) | Sport England | `https://www.activeplacespower.com/API` | Open (registration; attribution) |

### Amenities (Health)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [NHS Organisation Data Service](https://www.odsdatasearchandexport.nhs.uk/) | NHS England | `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?PostCode={postcode}&PrimaryRoleId=RO177` | Open Government Licence v3 |

### Amenities / Noise point-sources

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [OpenStreetMap via Overpass API](https://www.openstreetmap.org/) | OpenStreetMap contributors | `https://overpass-api.de/api/interpreter` | ODbL 1.0 |

### Health & care

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [CQC ratings and locations](https://www.cqc.org.uk/about-us/transparency/using-cqc-data) | Care Quality Commission | `https://api.service.cqc.org.uk/public/v1/locations?postalCode={postcode}` | Open Government Licence v3 |
| [Ofsted childcare providers register](https://www.gov.uk/government/statistical-data-sets/childcare-providers-and-inspections-management-information) | Ofsted | `CSV/ODS monthly management information on GOV.UK` | Open Government Licence v3 |

### Schools

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Get Information about Schools (GIAS)](https://get-information-schools.service.gov.uk/) | Department for Education | `https://get-information-schools.service.gov.uk/Downloads` | Open Government Licence v3 |

### Schools (Ratings)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Ofsted inspection outcomes (management information, monthly)](https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes) | Ofsted | `CSV/ODS monthly files on GOV.UK` | Open Government Licence v3 |

### Schools (Results)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [School performance tables (KS2 results, Progress 8, Attainment 8, A-level) + Explore Education Statistics](https://www.compare-school-performance.service.gov.uk/) | Department for Education | `https://www.compare-school-performance.service.gov.uk/download-data` | Open Government Licence v3 |

### Environment (Air quality)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Defra UK-AIR modelled background pollution maps (annual NO2, PM10, PM2.5 on 1km grid) + monitoring network](https://uk-air.defra.gov.uk/data/pcm-data) | Defra | `https://uk-air.defra.gov.uk/data/pcm-data` | Open Government Licence v3 |

### Environment (Air quality, London)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [London Air Quality Network](https://www.londonair.org.uk/) | Imperial College London ERG | `https://api.erg.ic.ac.uk/AirQuality/` | Free to use with attribution |

### Environment (Flood risk)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Risk of Flooding from Rivers and Sea + Risk of Flooding from Surface Water (likelihood categories: very low to high)](https://check-long-term-flood-risk.service.gov.uk/) | Environment Agency | `https://environment.data.gov.uk/dataset/bad20199-6d39-4aad-8564-26a46778fd94` | Open Government Licence v3 |

### Environment (Greenspace)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [OS Open Greenspace + Natural England green infrastructure / access to greenspace](https://www.ordnancesurvey.co.uk/products/os-open-greenspace) | Ordnance Survey / Natural England | `https://osdatahub.os.uk/downloads/open/OpenGreenspace` | Open Government Licence v3 |

### Environment (Designations)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [MAGIC / Defra designations](https://magic.defra.gov.uk/) | Natural England / Defra | `https://naturalengland-defra.opendata.arcgis.com/` | Open Government Licence v3 |

### Geography backbone (all tabs)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [ONS Postcode Directory (ONSPD/NSPL) + Open Geography Portal boundaries](https://geoportal.statistics.gov.uk/) | ONS Geography | `https://api.postcodes.io/postcodes/{postcode}` | Open Government Licence v3 (postcode data contains Royal Mail/OS derived IP with permitted use) |
| [OS Data Hub](https://osdatahub.os.uk/) | Ordnance Survey | `https://api.os.uk/search/places/v1/postcode?postcode={postcode}&key={key}` | OS OpenData (OGL) for open products; premium plan for Places/NGD |

### Extras (property-level, same ecosystem)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Energy Performance Certificates (EPC)](https://epc.opendatacommunities.org/) | DLUHC / MHCLG | `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode={postcode}` | OGL-style terms (attribution required) |

### Extras (connectivity)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Ofcom Connected Nations](https://www.ofcom.org.uk/research-and-data/multi-sector-research/infrastructure-research) | Ofcom | `https://api.ofcom.org.uk/` | Ofcom open terms / OGL |

### Extras (market & listings)

| Dataset | Publisher | API | Licence |
| --- | --- | --- | --- |
| [Live for-sale / to-let listings](https://propertydata.co.uk/) | Various commercial providers | `https://api.propertydata.co.uk/` | Commercial — check terms; scraping portals breaches their T&Cs |

## Usage

```bash
curl -s https://raw.githubusercontent.com/asturksever/agentic-house-search-data-registry/main/data/registry.json \
  | jq '.sources[] | select(.category=="Planning & constraints") | {dataset, api}'
```

Local development (both pages fetch `data/registry.json`, which `file://` blocks):

```bash
python3 -m http.server 8000   # then http://localhost:8000/report.html?postcode=SW111AA
```

## Caveats

Endpoints were verified against publisher documentation as of 2 August 2026. Government APIs move; treat `api` as a starting point and check `api_docs` before depending on it. Some entries require a free API key (Ofcom, BODS, EPC, OS Data Hub, CQC, Companies House, Land Registry CCOD). One entry — live for-sale listings — is explicitly **not** open data and is included so builders know where the wall is.

## Licence

This compilation is released under [CC0 1.0](LICENSE) (public domain). The underlying datasets remain © their publishers; most are Open Government Licence v3, and each entry records its own licence.

## Contributing

Missing a dataset, or spotted a dead endpoint? Open an issue or a PR editing `data/registry.json` — `index.html` and `data/registry.csv` are regenerated from it.
