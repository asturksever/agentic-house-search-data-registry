// Landing page figures, category index and coverage strip.
//
// Everything here is counted from data/registry.json at load rather than typed
// into the HTML. A landing page that hardcodes "45 datasets" starts lying the
// day someone merges the 46th, and this repo's whole claim is that it does not
// overstate what it has.

import { loadRegistry, GROUPS, groupOf } from './registry.js';
import { resolve } from './config.js';
import { getJSON } from './fetchx.js';

const NATIONS = ['England', 'Wales', 'Scotland', 'Northern Ireland'];

/* Which nations a source's coverage statement includes.
   `coverage` is deliberately free text — "England (LSOA level); separate indices
   for Wales, Scotland, NI" says more than any enum would — so this reads it
   rather than replacing it. It is a claim about what the publisher says it
   covers, not a promise about resolution, which is why the strip prints that
   caveat underneath. */
function nationsOf(coverage) {
  const c = coverage.toLowerCase();
  const out = new Set();
  if (/\buk\b/.test(c) || c.includes('worldwide')) NATIONS.forEach(n => out.add(n));
  if (c.includes('great britain')) ['England', 'Wales', 'Scotland'].forEach(n => out.add(n));
  // Greater London, PTAL and the LAQN are England entries that never say "England".
  if (c.includes('england') || c.includes('london')) out.add('England');
  if (c.includes('wales')) out.add('Wales');
  if (c.includes('scotland')) out.add('Scotland');
  if (c.includes('northern ireland') || /\bni\b/.test(c)) out.add('Northern Ireland');
  return out;
}

const fmt = n => n.toLocaleString('en-GB');
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function figure(n, cap) {
  return `<div class="fig"><span class="n">${esc(n)}</span><span class="cap">${esc(cap)}</span></div>`;
}

function renderFigures(sources, packs) {
  const questions = sources.reduce((t, s) => t + s.questions.length, 0);
  const ogl = sources.filter(s => /open government licence|OGL/i.test(s.licence)).length;
  const groups = new Set(sources.map(groupOf)).size;

  const out = [
    figure(fmt(sources.length), 'open datasets and APIs, each with its endpoint, licence and cadence'),
    figure(fmt(groups), 'categories, from crime and deprivation to ground risk and noise'),
    figure(fmt(questions), 'worked example questions the registry says these sources can answer'),
    figure(`${fmt(ogl)} of ${fmt(sources.length)}`, 'under the Open Government Licence or an OGL variant'),
  ];
  // The packs are a nice-to-have: if the manifest is missing the band simply
  // renders four figures instead of six.
  if (packs?.packs?.broadband?.postcodes) {
    out.push(figure(fmt(packs.packs.broadband.postcodes), 'postcodes of Ofcom fibre coverage, pre-joined into this repo'));
  }
  if (packs?.packs?.schools?.schools) {
    out.push(figure(fmt(packs.packs.schools.schools), 'schools from the DfE register, sharded by postcode area'));
  }
  document.getElementById('figures').innerHTML = out.join('');
}

function renderIndex(sources) {
  const counts = new Map();
  sources.forEach(s => counts.set(groupOf(s), (counts.get(groupOf(s)) || 0) + 1));
  document.getElementById('idx').innerHTML = GROUPS
    .filter(g => g !== 'All' && counts.get(g))
    .map(g => `<li><a href="registry.html?group=${encodeURIComponent(g)}">
        <span class="nm">${esc(g)}</span><span class="dots"></span>
        <span class="n">${counts.get(g)}</span></a></li>`)
    .join('');
}

function renderCoverage(sources) {
  const counts = Object.fromEntries(NATIONS.map(n => [n, 0]));
  sources.forEach(s => nationsOf(s.coverage).forEach(n => counts[n]++));
  const max = Math.max(...Object.values(counts));

  document.getElementById('cov').innerHTML = NATIONS.map(n => {
    const c = counts[n];
    const pct = Math.round((c / max) * 100);
    return `<tr>
      <td class="nation">${esc(n)}</td>
      <td class="n">${c} of ${sources.length}</td>
      <td class="barcell"><div class="bar"><i style="width:${pct}%"></i></div></td>
    </tr>`;
  }).join('');
}

try {
  const data = await loadRegistry();
  // A missing pack manifest must not take the whole band down with it.
  const packs = await getJSON(resolve('packs/manifest.json')).catch(() => null);
  renderFigures(data.sources, packs);
  renderIndex(data.sources);
  renderCoverage(data.sources);
} catch (err) {
  // Same failure mode as the catalogue: opening this file from disk blocks the
  // fetch, and saying so beats three empty sections.
  document.getElementById('live').innerHTML = `<div class="card">
    <h2>Could not load the registry</h2>
    <p class="pub err">${esc(err.message)}</p>
    <p class="pub">This page counts its figures from <code>data/registry.json</code>, which browsers
    block on <code>file://</code> URLs. Serve the folder over HTTP instead —
    <code>python3 -m http.server 8000</code> — or use the
    <a class="src" href="https://agentic-house-search.vercel.app/">published site</a>.</p>
  </div>`;
}
