// Orchestrator: postcode in, one card per category out.
//
// Providers run concurrently and each card fills in as its own sources settle,
// so a slow census query never holds up crime.

import { loadRegistry, registryAnchor } from './registry.js';
import { lookup, normalise, pretty, PostcodeError } from './geo.js';
import { STATUS } from './facts.js';
import { narrate } from './narrate.js';
import { PROVIDERS } from './providers/index.js';
import { mountAI, resetAI } from './ai.js';

const el = {
  form: document.getElementById('form'),
  pc: document.getElementById('pc'),
  hint: document.getElementById('hint'),
  place: document.getElementById('place'),
  anchors: document.getElementById('anchors'),
  progress: document.getElementById('progress'),
  cards: document.getElementById('cards'),
  ai: document.getElementById('ai'),
  copylink: document.getElementById('copylink'),
};

let registry = null;
let currentRun = 0;

const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------- rendering */

function badgeFor(res) {
  if (res.status === STATUS.OK || res.status === STATUS.PARTIAL) {
    return res.mode === 'pack' ? 'pre-built extract' : 'live';
  }
  return { [STATUS.UNAVAILABLE]: 'unavailable', [STATUS.OUT_OF_COVERAGE]: 'not covered here',
           [STATUS.ERROR]: 'unavailable' }[res.status];
}

// A thin bar showing where the value sits relative to its benchmark. Purely
// supplementary — the number and the benchmark are both in the row already.
function barFor(f) {
  if (!f.comparison || !f.comparison.ratio) return '';
  const pos = Math.max(0, Math.min(1, f.comparison.ratio / 2)); // 1.0x sits mid-bar
  return `<span class="bar" aria-hidden="true"><b style="width:${(pos * 100).toFixed(0)}%"></b><i style="left:50%"></i></span>`;
}

function factsTable(res) {
  if (!res.facts.length) return '';
  return `<table class="facts">
    <thead><tr><th>Measure</th><th>Value</th><th>Benchmark</th><th>Period</th></tr></thead>
    <tbody>${res.facts.map(f => {
      const bench = f.benchmarks[0];
      return `<tr>
        <td>${esc(f.label)}${f.geography ? `<span class="note">${esc(f.geography.level)}: ${esc(f.geography.name || f.geography.code)}</span>` : ''}${f.note ? `<span class="note">${esc(f.note)}</span>` : ''}</td>
        <td class="val">${esc(f.display)}${barFor(f)}</td>
        <td class="bench">${bench ? `${esc(bench.display ?? bench.value)}<span class="note">${esc(bench.name || bench.scope)}</span>` : '—'}</td>
        <td class="bench">${esc(f.period || '—')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function sourceLines(res) {
  return res.sources.map(id => {
    const s = registry.byId[id];
    if (!s) return '';
    return `<p class="srcline">${esc(s.publisher)} · ${esc(s.licence)} · updated ${esc(s.update_frequency)}
      · <a href="${esc(registryAnchor(id))}">registry entry ↗</a></p>`;
  }).join('');
}

function altLink(res) {
  if (!res.alt) return '';
  return `<p class="srcline"><a href="${esc(res.alt.url)}" target="_blank" rel="noopener">${esc(res.alt.label)} ↗</a></p>`;
}

function cardHTML(provider, res, place) {
  return `<div class="card cat" id="cat-${esc(provider.id)}">
    <div class="head">
      <h2>${esc(provider.label)}</h2>
      <span class="badge ${esc(res.status === STATUS.PARTIAL ? 'partial' : res.status)}">${esc(badgeFor(res))}</span>
    </div>
    <p class="narr">${esc(narrate(res, place))}</p>
    ${factsTable(res)}
    ${altLink(res)}
    ${sourceLines(res)}
  </div>`;
}

function skeleton(provider) {
  return `<div class="card cat skeleton" id="cat-${esc(provider.id)}">
    <div class="head"><h2>${esc(provider.label)}</h2><span class="badge">loading</span></div>
    <div class="line"></div><div class="line"></div><div class="line short"></div>
  </div>`;
}

function renderPlace(place) {
  const bits = [place.district.name, place.region || place.country].filter(Boolean);
  const meta = [
    place.lsoa.name && `Neighbourhood: ${place.lsoa.name}`,
    place.ward.name && `Ward: ${place.ward.name}`,
    place.constituency && `Constituency: ${place.constituency}`,
    place.ruc,
  ].filter(Boolean).join(' · ');
  el.place.innerHTML = `<div class="place">
    <h2>${esc(place.postcode)} · ${esc(bits.join(' · '))}</h2>
    <p class="meta">${esc(meta)}</p>
  </div>`;
}

/* ------------------------------------------------------------------- errors */

function showPostcodeError(err) {
  const sugg = (err.suggestions || []).slice(0, 5);
  el.hint.innerHTML = `<span class="err">${esc(err.message)}</span>` +
    (sugg.length ? ` Did you mean ${sugg.map(s => `<a data-eg="${esc(s)}">${esc(s)}</a>`).join(', ')}?` : '');
  el.place.innerHTML = '';
  el.cards.innerHTML = '';
  el.ai.innerHTML = '';
  el.anchors.hidden = true;
  el.progress.textContent = '';
  el.copylink.hidden = true;
}

/* ------------------------------------------------------------------ the run */

async function run(input) {
  const runId = ++currentRun;
  el.hint.textContent = 'Looking up postcode…';

  let place;
  try {
    place = await lookup(input);
  } catch (err) {
    if (err instanceof PostcodeError) return showPostcodeError(err);
    el.hint.innerHTML = `<span class="err">Postcode lookup failed: ${esc(err.message)}</span>`;
    return;
  }
  if (runId !== currentRun) return;

  el.pc.value = place.postcode;
  el.hint.textContent = 'Each section below is fetched independently and appears as it arrives.';
  history.replaceState(null, '', `?postcode=${encodeURIComponent(place.compact)}`);
  el.copylink.hidden = false;
  renderPlace(place);

  const active = PROVIDERS;
  el.anchors.hidden = false;
  el.anchors.innerHTML = active.map(p => `<a class="pill" href="#cat-${esc(p.id)}">${esc(p.label)}</a>`).join('');
  el.cards.innerHTML = active.map(skeleton).join('');
  resetAI(el.ai);

  let done = 0;
  const settled = new Array(active.length);
  el.progress.textContent = `0 of ${active.length} sections loaded`;

  await Promise.all(active.map(async (provider, i) => {
    let res;
    try {
      const gate = provider.coverage ? provider.coverage(place) : { ok: true };
      res = gate.ok
        ? await provider.run(place)
        : { id: provider.id, label: provider.label, status: STATUS.OUT_OF_COVERAGE,
            facts: [], notes: [gate.why], errors: [], sources: provider.registryIds,
            alt: gate.alt || null };
    } catch (err) {
      // A provider is supposed to handle its own failures; this is the backstop.
      res = { id: provider.id, label: provider.label, status: STATUS.ERROR, facts: [],
              notes: [`This section failed unexpectedly: ${err.message}`], errors: [],
              sources: provider.registryIds };
    }
    if (runId !== currentRun) return;
    settled[i] = res;
    document.getElementById(`cat-${provider.id}`).outerHTML = cardHTML(provider, res, place);
    el.progress.textContent = `${++done} of ${active.length} sections loaded`;
  }));

  if (runId !== currentRun) return;
  el.progress.textContent = `${active.length} sections loaded`;
  mountAI(el.ai, place, settled.filter(Boolean));
}

/* -------------------------------------------------------------------- wiring */

el.form.addEventListener('submit', e => {
  e.preventDefault();
  run(el.pc.value);
});

el.hint.addEventListener('click', e => {
  const eg = e.target.dataset?.eg;
  if (!eg) return;
  e.preventDefault();
  el.pc.value = eg;
  run(eg);
});

el.copylink.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    el.copylink.textContent = 'Link copied';
    setTimeout(() => { el.copylink.textContent = 'Copy link'; }, 2000);
  } catch { /* clipboard blocked — the URL bar already has it */ }
});

registry = await loadRegistry().catch(err => {
  el.hint.innerHTML = `<span class="err">Could not load the registry: ${esc(err.message)}.</span>
    This page needs to be served over HTTP — try <code>python3 -m http.server 8000</code>.`;
  return null;
});

if (registry) {
  const fromUrl = new URLSearchParams(location.search).get('postcode');
  if (fromUrl && normalise(fromUrl)) {
    el.pc.value = pretty(normalise(fromUrl));
    run(fromUrl);
  }
}
