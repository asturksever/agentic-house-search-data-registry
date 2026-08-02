// Orchestrator: postcode in, one card per category out.
//
// Providers run concurrently and each card fills in as its own sources settle,
// so a slow census query never holds up crime.

import { loadRegistry, registryAnchor } from './registry.js';
import { lookup, normalise, pretty, PostcodeError } from './geo.js';
import { STATUS } from './facts.js';
import { narrate, headlineFact } from './narrate.js';
import { worstTone } from './thresholds.js';
import { PROVIDERS } from './providers/index.js';
import { mountAI, resetAI } from './ai.js';

const el = {
  form: document.getElementById('form'),
  pc: document.getElementById('pc'),
  hint: document.getElementById('hint'),
  place: document.getElementById('place'),
  tiles: document.getElementById('tiles'),
  anchors: document.getElementById('anchors'),
  progress: document.getElementById('progress'),
  cards: document.getElementById('cards'),
  ai: document.getElementById('ai'),
  copylink: document.getElementById('copylink'),
};

let registry = null;
let currentRun = 0;

const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Four distinct shapes, so status survives greyscale, print and colour
// blindness. Colour is a reinforcement, never the only channel.
const GLYPH = { good: '▲', neutral: '●', watch: '◆', poor: '▼' };

const glyph = tone => `<span class="glyph" aria-hidden="true">${GLYPH[tone] || GLYPH.neutral}</span>`;

/* ---------------------------------------------------------------- rendering */

function badgeFor(res) {
  if (res.status === STATUS.OK || res.status === STATUS.PARTIAL) {
    return res.mode === 'pack' ? 'pre-built extract' : 'live';
  }
  return { [STATUS.UNAVAILABLE]: 'no data', [STATUS.OUT_OF_COVERAGE]: 'not covered here',
           [STATUS.ERROR]: 'no data' }[res.status];
}

/** The line every fact in this card shares, hoisted out of the rows. */
function scopeLine(res) {
  const geos = new Set(res.facts.map(f => f.geography
    ? `${f.geography.level}: ${f.geography.name || f.geography.code}` : null).filter(Boolean));
  const periods = new Set(res.facts.map(f => f.period).filter(Boolean));
  const parts = [];
  if (geos.size === 1) parts.push([...geos][0]);
  if (periods.size === 1) parts.push([...periods][0]);
  return parts.join(' · ');
}

// A thin track with the value's position and a tick where the benchmark sits.
// Only drawn when there is a benchmark to sit against — a bar with nothing to
// compare to is decoration.
function meter(f) {
  const c = f.comparison;
  if (!c || !c.ratio) return '';
  // The tick is the benchmark; it is already named in the band pill beside the
  // value, so the track carries no label of its own.
  const mid = 50;
  const pos = Math.max(3, Math.min(100, (c.ratio / 2) * 100));
  return `<div class="meter t-${esc(c.tone)}">
    <b style="width:${pos.toFixed(1)}%"></b>
    <i style="left:${mid}%"></i>
  </div>`;
}

function factRow(f, hideScope) {
  const c = f.comparison;
  const long = String(f.display).length > 14;
  const shared = hideScope ? '' : [
    f.geography ? `${f.geography.level}: ${f.geography.name || f.geography.code}` : '',
    f.period || '',
  ].filter(Boolean).join(' · ');
  const meterHTML = meter(f);
  return `<div class="fact${meterHTML ? ' has-meter' : ''}">
    <div class="flabel">${esc(f.label)}</div>
    <div class="fvalue${long ? ' long' : ''}">${esc(f.display)}</div>
    ${shared || f.note ? `<div class="fmeta">${esc([shared, f.note].filter(Boolean).join(' · '))}</div>` : ''}
    ${c?.band ? `<div class="fband"><span class="pill t-${esc(c.tone)}">${glyph(c.tone)}${esc(c.band)}${c.vs ? ` ${esc(c.vsName || c.vs)}` : ''}</span></div>` : ''}
    ${meterHTML}
  </div>`;
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

function notesBlock(res) {
  const notes = [...res.notes];
  if (res.status === STATUS.PARTIAL) {
    notes.unshift(`Some figures are missing: ${res.errors.map(e => e.label || e.sourceId).join(', ')} did not respond.`);
  }
  if (!notes.length || res.status === STATUS.OUT_OF_COVERAGE) return '';
  return `<details class="notes"><summary>Notes and caveats (${notes.length})</summary>
    ${notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>`;
}

// A provider may name the geography it actually describes (Ofcom publishes
// mobile coverage by local authority, not by postcode).
const titleOf = (provider, place) =>
  (place && provider.labelFor ? provider.labelFor(place) : provider.label);

function cardHTML(provider, res, place) {
  const shared = scopeLine(res);
  const tone = worstTone(res.facts);
  const summary = narrate(res, place, { skipNotes: true });

  // Geography and period are stated once above the rows when every fact shares
  // them, instead of repeating under each one.
  const rows = res.facts.map(f => factRow(f, Boolean(shared))).join('');

  return `<div class="card cat" id="cat-${esc(provider.id)}">
    <div class="head">
      <h2>${esc(titleOf(provider, place))}</h2>
      <span class="badge ${esc(res.status === STATUS.PARTIAL ? 'live' : res.status)}">${esc(badgeFor(res))}</span>
      ${tone ? `<span class="pill t-${esc(tone)}">${glyph(tone)}${esc({ good: 'looks good', watch: 'worth a look', poor: 'needs attention' }[tone])}</span>` : ''}
    </div>
    ${shared ? `<p class="scope">${esc(shared)}</p>` : ''}
    <p class="narr">${esc(summary)}</p>
    ${rows}
    ${notesBlock(res)}
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

function tileHTML(provider, res) {
  const name = provider.short || provider.label;
  if (!res) {
    return `<a class="tile t-off" href="#cat-${esc(provider.id)}">
      <span class="cat-name">${esc(name)}</span>
      <span class="figure small">…</span></a>`;
  }
  const head = headlineFact(res);
  const c = head?.comparison;
  const tone = c?.tone || worstTone(res.facts);
  const off = !res.facts.length;
  const status = off
    ? { [STATUS.OUT_OF_COVERAGE]: 'not covered here', [STATUS.UNAVAILABLE]: 'no data yet' }[res.status] || 'no data'
    : (c?.band ? `${c.band}${c.vs ? ` ${c.vsName || c.vs}` : ''}` : head?.label || '');
  const figure = off ? '—' : head.display;
  return `<a class="tile ${off ? 't-off' : `t-${esc(tone || 'neutral')}`}" href="#cat-${esc(provider.id)}">
    <span class="cat-name">${esc(name)}</span>
    <span class="figure${String(figure).length > 12 ? ' small' : ''}">${esc(figure)}</span>
    <span class="status">${tone && !off ? glyph(tone) : ''}${esc(status)}</span>
  </a>`;
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

function clear() {
  el.place.innerHTML = '';
  el.tiles.innerHTML = '';
  el.tiles.hidden = true;
  el.cards.innerHTML = '';
  el.ai.innerHTML = '';
  el.anchors.hidden = true;
  el.progress.textContent = '';
  el.copylink.hidden = true;
}

function showPostcodeError(err) {
  const sugg = (err.suggestions || []).slice(0, 5);
  el.hint.innerHTML = `<span class="err">${esc(err.message)}</span>` +
    (sugg.length ? ` Did you mean ${sugg.map(s => `<a data-eg="${esc(s)}">${esc(s)}</a>`).join(', ')}?` : '');
  clear();
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
  el.hint.textContent = 'Each section is fetched independently and appears as it arrives.';
  history.replaceState(null, '', `?postcode=${encodeURIComponent(place.compact)}`);
  el.copylink.hidden = false;
  renderPlace(place);

  const active = PROVIDERS;
  el.anchors.hidden = false;
  el.anchors.innerHTML = active.map(p => `<a class="pill" href="#cat-${esc(p.id)}">${esc(p.short || p.label)}</a>`).join('');
  el.tiles.hidden = false;
  el.tiles.innerHTML = active.map(p => tileHTML(p, null)).join('');
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
    el.tiles.children[i].outerHTML = tileHTML(provider, res);
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
