// Property prices — HM Land Registry Price Paid Data and the UK House Price Index.
//
// Price Paid is exact-address truth but sparse: plenty of postcodes have had no
// sale for years. UKHPI at local-authority level always answers, so the card
// leads with whichever it has and says which geography each figure describes.

import { getJSON } from '../fetchx.js';
import { fact, result, finish, fmt } from '../facts.js';
import { noteFailure } from './_util.js';

const SOURCE = 'land-registry-ppd';
const BASE = 'https://landregistry.data.gov.uk/data';

const slug = name => name.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const label = node => node?.prefLabel?.[0]?._value || node?.label?.[0]?._value || null;

// Price Paid carries two kinds of record. Category B ("additional price paid")
// covers repossessions, buy-to-lets sold at auction, transfers to a company and
// commercial units — a £6m office in a residential postcode will wreck a median
// if you leave it in. Only standard residential sales are used.
const isStandardSale = item =>
  String(item.transactionCategory?._about || '').includes('standardPricePaidTransaction');

function ukhpiMonths() {
  // The index publishes roughly two months in arrears; try the three most
  // recent plausible months rather than guessing one.
  const out = [];
  for (let back = 2; back <= 4; back++) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - back);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function ukhpi(region) {
  for (const month of ukhpiMonths()) {
    try {
      const data = await getJSON(`${BASE}/ukhpi/region/${region}/month/${month}.json`, { retry: 0 });
      const t = data?.result?.primaryTopic;
      if (t && t.averagePrice) return { month, ...t };
    } catch { /* month not published yet — try the next one back */ }
  }
  return null;
}

export default {
  id: 'prices',
  label: 'Property prices',
  registryIds: [SOURCE],

  coverage(place) {
    if (place.country === 'England' || place.country === 'Wales') return { ok: true };
    const alt = place.country === 'Scotland'
      ? { label: 'Registers of Scotland house price statistics', url: 'https://www.ros.gov.uk/data-and-statistics' }
      : { label: 'NI house price index (NISRA)', url: 'https://www.nisra.gov.uk/statistics/housing-community-and-regeneration/northern-ireland-house-price-index' };
    return {
      ok: false,
      why: `HM Land Registry Price Paid Data covers England and Wales. ${place.country} keeps its own land register.`,
      alt,
    };
  },

  async run(place) {
    const res = result(this.id, this.label, { sources: [SOURCE], mode: 'live' });

    const [sales, district, national] = await Promise.all([
      getJSON(`${BASE}/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(place.postcode)}&_pageSize=25&_sort=-transactionDate`, { timeout: 12000 })
        .then(d => d?.result?.items || [])
        .catch(err => { noteFailure(res, SOURCE, 'Price Paid Data', err); return null; }),
      ukhpi(slug(place.district.name))
        .catch(err => { noteFailure(res, SOURCE, 'UK House Price Index', err); return null; }),
      ukhpi(place.country === 'Wales' ? 'wales' : 'england').catch(() => null),
    ]);

    if (district) {
      const benchmarks = national ? [{
        scope: 'england', name: place.country === 'Wales' ? 'Wales' : 'England',
        value: national.averagePrice, display: fmt.money(national.averagePrice),
      }] : [];
      res.facts.push(fact({
        key: 'prices.avg_price_district', label: 'Average price paid',
        value: district.averagePrice, display: fmt.money(district.averagePrice), kind: 'money',
        geography: { level: 'Local authority', code: place.district.code, name: place.district.name },
        period: district.month, benchmarks, sourceId: SOURCE,
      }));
      if (typeof district.percentageAnnualChange === 'number') {
        res.facts.push(fact({
          key: 'prices.annual_change', label: 'Change over the last 12 months',
          value: district.percentageAnnualChange,
          display: `${district.percentageAnnualChange > 0 ? '+' : ''}${fmt.pct(district.percentageAnnualChange, 1)}`,
          kind: 'percent',
          geography: { level: 'Local authority', code: place.district.code, name: place.district.name },
          period: district.month, sourceId: SOURCE,
        }));
      }
      if (district.averagePriceFlatMaisonette && district.averagePriceTerraced) {
        res.facts.push(fact({
          key: 'prices.by_type', label: 'Flat vs terraced average',
          value: district.averagePriceFlatMaisonette,
          display: `${fmt.money(district.averagePriceFlatMaisonette)} vs ${fmt.money(district.averagePriceTerraced)}`,
          kind: 'money',
          geography: { level: 'Local authority', code: place.district.code, name: place.district.name },
          period: district.month, sourceId: SOURCE,
        }));
      }
    }

    const residential = sales ? sales.filter(isStandardSale) : null;

    if (residential && residential.length) {
      const prices = residential.map(s => s.pricePaid).filter(Boolean).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      const latest = residential[0];
      const benchmarks = district ? [{
        scope: 'local_authority', name: place.district.name,
        value: district.averagePrice, display: fmt.money(district.averagePrice),
      }] : [];
      res.facts.push(fact({
        key: 'prices.median_paid', label: 'Median price paid in this postcode',
        value: median, display: fmt.money(median), kind: 'money',
        geography: { level: 'Postcode', code: place.compact, name: place.postcode },
        period: `last ${prices.length} recorded sale${prices.length === 1 ? '' : 's'}`,
        benchmarks, sourceId: SOURCE,
      }));
      const when = latest.transactionDate ? String(latest.transactionDate).slice(0, 10) : null;
      const type = label(latest.propertyType);
      res.facts.push(fact({
        key: 'prices.last_sale', label: 'Most recent sale', value: latest.pricePaid,
        display: `${fmt.money(latest.pricePaid)}${when ? ` on ${when}` : ''}`, kind: 'money',
        geography: { level: 'Postcode', code: place.compact, name: place.postcode },
        period: when || null, sourceId: SOURCE,
        note: type ? `Property type: ${type}.` : null,
      }));
    } else if (sales && sales.length) {
      res.notes.push('Every sale recorded in this postcode is a non-standard transaction — a commercial unit, a repossession or a transfer to a company — so no residential price is shown. The figures above describe the wider local authority.');
    } else if (sales) {
      res.notes.push('No sales are recorded in Price Paid Data for this exact postcode, so the figures above describe the wider local authority.');
    }

    return finish(res);
  },
};
