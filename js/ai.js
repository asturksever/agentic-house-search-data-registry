// Optional AI area brief, using the visitor's own Anthropic key.
//
// This page is static — there is no server to hold a key in — so the only
// honest options are "bring your own" or "no LLM". The deterministic report
// above is the record; the brief is a reading of it, laid out the way a local
// estate agent would walk a buyer through an area: headline, the picture at a
// glance, category by category, what to check elsewhere, bottom line.
//
// The model writes only the words. Every figure chip and every good / watch /
// poor tone in the brief is taken from the computed facts, never from the
// model, and every number the model does write is checked back against the
// data it was given before the brief is shown.
//
// A finished brief can be shared: it is compressed into the link's #fragment,
// which browsers never send to a server, so the recipient sees it without a
// key and with its figures re-checked against freshly loaded data.

import { forPrompt } from './facts.js';
import { headlineFact } from './narrate.js';
import { worstTone } from './thresholds.js';
import { PROVIDERS } from './providers/index.js';
import { shareLink, savePdf } from './share.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const KEY_STORAGE = 'ahs.anthropic_key';
const MODEL_STORAGE = 'ahs.anthropic_model';

// One table, so a model change is a one-line edit. `fallbacks` marks models
// that accept the server-side refusal fallback (`fallbacks: "default"`); Haiku
// has none, so a declined request there simply reports the refusal.
const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'best quality', fallbacks: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'cheaper', fallbacks: true },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'cheapest', fallbacks: false },
];
const DEFAULT_MODEL = MODELS[0].id;
const modelInfo = id => MODELS.find(m => m.id === id);

// Fixed across requests, so the structured-output schema below is identical
// every time and stays in the API's schema cache.
const CATEGORY_IDS = PROVIDERS.map(p => p.id);

const RULES = `You are writing an area brief for someone thinking of buying or renting a home at one UK postcode, the way a well-informed local estate agent would walk a client through a neighbourhood: plain, direct and specific, in short sentences. You may address the reader as "you".

You will be given JSON: a place, and one entry per category with facts already computed from UK open data.

Rules:
- Use only numbers that appear in the JSON. Never compute a new statistic, ratio, average, difference or projection from them.
- Do not add outside knowledge about the area, the town or the market.
- Describe what the data says. Do not advise whether to buy, and do not call the area good, bad, desirable, up-and-coming or anything similar.
- No estate-agent sales language: no "sought-after", "vibrant", "stunning", "boasts", "perfect for".
- Prefer the comparisons already present in the JSON (the "comparison" field) over your own framing.
- When it changes the meaning of a figure, say what area it describes (a neighbourhood of about 1,500 people, a whole local authority, a 1 km square).
- Where a category is "unavailable" or "out_of_coverage", do not speculate about what it would have shown.
- UK English. No markdown.`;

const API_FORMAT = `Fill in the JSON structure you are given:
- headline: one sentence of at most 25 words capturing the overall picture.
- at_a_glance: one entry for each category that has facts, in the order given; "point" is one plain sentence of at most 15 words built around that category's most telling figure.
- sections: one entry for each category that has facts, in the order given; "text" is two or three sentences, at most 60 words, on what the figures mean for someone living there.
- worth_checking: two to four short items naming what this data cannot settle and should be checked another way, such as a category with no data here, or a figure that describes a much wider area than the address. Phrase each as something to check, not as advice on whether to buy.
- bottom_line: at most three sentences pulling the picture together.`;

const COPY_FORMAT = `Lay the brief out under these headings, in plain text:
1. A one-sentence headline of at most 25 words.
2. "At a glance": one line per category that has facts, at most 15 words each.
3. One short section per category that has facts: its name, then two or three sentences (at most 60 words) on what the figures mean for someone living there.
4. "Worth checking": two to four things this data cannot settle and that should be checked another way.
5. "Bottom line": at most three sentences.`;

const SYSTEM = `${RULES}\n\n${API_FORMAT}`;

// Structured outputs: the response is guaranteed to parse against this.
// Length limits are not expressible here (no minLength/maxLength), so they live
// in the prompt and cleanBrief() trims anything over the top.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'at_a_glance', 'sections', 'worth_checking', 'bottom_line'],
  properties: {
    headline: { type: 'string' },
    at_a_glance: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['category', 'point'],
        properties: { category: { type: 'string', enum: CATEGORY_IDS }, point: { type: 'string' } },
      },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['category', 'text'],
        properties: { category: { type: 'string', enum: CATEGORY_IDS }, text: { type: 'string' } },
      },
    },
    worth_checking: { type: 'array', items: { type: 'string' } },
    bottom_line: { type: 'string' },
  },
};

const GLYPH = { good: '▲', neutral: '●', watch: '◆', poor: '▼' };

const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const getKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
// A model saved by an older version of this page may no longer be offered.
const getModel = () => {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE);
    return modelInfo(saved) ? saved : DEFAULT_MODEL;
  } catch { return DEFAULT_MODEL; }
};

const longDate = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/* ------------------------------------------------------------------- prompt */

function payload(place, results) {
  return {
    place: {
      postcode: place.postcode,
      localAuthority: place.district.name,
      region: place.region || place.country,
      country: place.country,
      neighbourhood: place.lsoa.name,
      ruralUrban: place.ruc,
    },
    categories: results.map(forPrompt),
  };
}

function promptText(place, results) {
  return `${RULES}\n\n${COPY_FORMAT}\n\n---\n\n${JSON.stringify(payload(place, results), null, 2)}`;
}

/* --------------------------------------------------------------- guardrails */

const NUMBER = /\d[\d,]*\.?\d*/g;
const toNumber = s => Number(s.replace(/,/g, ''));

// Any figure in the brief must be traceable to the input it was written from.
// That input is the whole prompt payload, names and labels included: the
// neighbourhood "Haringey 028A", the "300 Mbit/s" in a broadband threshold and
// the count in "the last 22 sales" are all legitimate, and checking only the
// numeric fields flagged them as invented. Model arithmetic is still exactly
// the failure this report cannot afford, so a number found nowhere in the
// payload downgrades the brief to "unverified" rather than being quietly shown.
export function unverifiedNumbers(text, place, results) {
  const allowed = new Set();
  const add = v => {
    if (!isFinite(v)) return;
    allowed.add(Math.abs(v));
    allowed.add(Math.abs(Math.round(v)));
    allowed.add(Math.abs(Number(v.toFixed(1))));
  };
  for (const m of JSON.stringify(payload(place, results)).matchAll(NUMBER)) add(toNumber(m[0]));

  const close = n => [...allowed].some(a =>
    a === n || (a !== 0 && Math.abs(a - n) / Math.max(a, 1) <= 0.01));

  const bad = [];
  for (const m of text.matchAll(NUMBER)) {
    const n = toNumber(m[0]);
    if (!isFinite(n)) continue;
    if (n <= 12) continue;                                        // "three of the four operators"
    if (n >= 1900 && n <= 2100 && Number.isInteger(n)) continue;  // years
    if (!close(n)) bad.push(m[0]);
  }
  return [...new Set(bad)];
}

/** Keep only the fields and category ids we know, trimmed to sane lengths. */
function cleanBrief(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ids = new Set(CATEGORY_IDS);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const brief = {
    headline: str(raw.headline, 300),
    at_a_glance: list(raw.at_a_glance, 20)
      .filter(x => x && ids.has(x.category))
      .map(x => ({ category: x.category, point: str(x.point, 300) }))
      .filter(x => x.point),
    sections: list(raw.sections, 20)
      .filter(x => x && ids.has(x.category))
      .map(x => ({ category: x.category, text: str(x.text, 1200) }))
      .filter(x => x.text),
    worth_checking: list(raw.worth_checking, 8).map(x => str(x, 400)).filter(Boolean),
    bottom_line: str(raw.bottom_line, 800),
  };
  return brief.headline || brief.sections.length ? brief : null;
}

const briefText = b => [
  b.headline, ...b.at_a_glance.map(x => x.point), ...b.sections.map(x => x.text),
  ...b.worth_checking, b.bottom_line,
].join('\n');

/* ------------------------------------------------------------------ request */

// Raw fetch rather than the Anthropic SDK: this site has no build step and its
// CSP only allows scripts from its own origin, so there is no SDK to import.
async function callAnthropic(key, model, place, results) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Required for a browser to call the API directly at all.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload(place, results)) }],
    // Summarising given figures is not hard reasoning; medium keeps it quick.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
  };
  if (modelInfo(model)?.fallbacks) {
    // On a safety-classifier decline, the API re-runs the request on a
    // recommended fallback model inside the same call.
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
  if (json.stop_reason === 'refusal') {
    const err = new Error('refusal');
    err.refusal = true;
    throw err;
  }
  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  let brief = null;
  try { brief = cleanBrief(JSON.parse(text)); } catch { /* handled below */ }
  if (!brief) {
    const err = new Error(json.stop_reason === 'max_tokens'
      ? 'The brief was cut off before it was complete.'
      : 'The model did not return a brief in the expected shape.');
    err.shape = true;
    throw err;
  }
  return { brief, usage: json.usage || null, model: json.model || model };
}

function explain(err) {
  if (err.refusal) return 'The model declined to write this brief. Try again, or pick another model.';
  if (err.shape) return `${err.message} Try again.`;
  if (err.status === 401) return 'That key was rejected. Check it and try again.';
  if (err.status === 400 && /model/i.test(err.message)) {
    return `The API did not recognise that model: ${err.message}. Pick another one above.`;
  }
  if (err.status === 429 || err.status === 529) {
    return `Rate limited or overloaded${err.retryAfter ? `; try again in ${err.retryAfter}s` : ', try again shortly'}.`;
  }
  if (err.status) return `The API returned an error: ${err.message}`;
  return `Could not reach api.anthropic.com: ${err.message}. Check the key and your connection.`;
}

/* ------------------------------------------------------------------ sharing */

// Brief -> deflate -> base64url, in the #fragment. A typical brief is about
// 3 KB of JSON and 1.5 KB once packed, well inside any URL limit.
const SHARE_PREFIX = '#brief=';
const MAX_PACKED = 24_000;
const MAX_UNPACKED = 120_000;

async function pack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unpack(text) {
  if (text.length > MAX_PACKED) throw new Error('too long');
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  // Read with a ceiling: a hand-made link must not be able to inflate into
  // something huge.
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) { await reader.cancel(); throw new Error('too large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

const canShare = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/**
 * The brief carried by this page's link, if any. Everything in it came from
 * whoever made the link, so it is validated here and escaped when rendered.
 */
export async function readSharedBrief(hash = location.hash) {
  if (!canShare || !hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const raw = await unpack(hash.slice(SHARE_PREFIX.length));
    const brief = cleanBrief(raw?.b);
    if (raw?.v !== 1 || typeof raw.pc !== 'string' || !brief) return null;
    return {
      postcode: raw.pc.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      model: modelInfo(raw.m) ? raw.m : null,
      at: isNaN(new Date(raw.at)) ? null : raw.at,
      brief,
    };
  } catch {
    return null;   // a damaged link shows the report without the brief
  }
}

/* --------------------------------------------------------------------- view */

function categoryView(results) {
  const byId = new Map(results.map(r => [r.id, r]));
  return id => {
    const res = byId.get(id);
    if (!res) return null;
    const head = headlineFact(res);
    const tone = head?.comparison?.tone || worstTone(res.facts) || 'neutral';
    // Up to three figures, headline first, straight from the computed facts.
    const figs = [head, ...res.facts.filter(f => f !== head)].filter(Boolean).slice(0, 3);
    return { res, tone, figs };
  };
}

function briefHTML({ brief, model, at, shared, bad, place, results }) {
  const view = categoryView(results);
  const modelName = modelInfo(model)?.name || 'a Claude model';
  const date = longDate(at);

  const glance = brief.at_a_glance.map(x => {
    const v = view(x.category);
    if (!v) return '';
    return `<li><span class="pill t-${esc(v.tone)}"><span class="glyph" aria-hidden="true">${GLYPH[v.tone]}</span>${esc(v.res.label)}</span><span>${esc(x.point)}</span></li>`;
  }).join('');

  const sections = brief.sections.map(x => {
    const v = view(x.category);
    if (!v) return '';
    return `<div class="bsec">
      <h5><a href="#cat-${esc(x.category)}">${esc(v.res.label)}</a></h5>
      ${v.figs.length ? `<p class="figs">${v.figs.map(f => `<span class="fig-chip">${esc(f.label)} <b>${esc(f.display)}</b></span>`).join('')}</p>` : ''}
      <p>${esc(x.text)}</p>
    </div>`;
  }).join('');

  const warning = bad.length
    ? `<p class="warn brief-warn"><strong>Unverified figures:</strong> ${esc(bad.join(', '))} ${bad.length === 1 ? 'does' : 'do'} not appear in the data ${shared ? 'loaded for this report just now' : 'this brief was written from'}. Treat the brief with suspicion; the report cards are the record.</p>`
    : '';

  return `<article class="brief" aria-labelledby="brief-headline">
    <header class="brief-top">
      <div>
        <p class="brief-kicker">${shared ? 'Shared area brief' : 'Area brief'} · ${esc(place.postcode)}</p>
        <h4 class="brief-headline" id="brief-headline">${esc(brief.headline)}</h4>
        <p class="brief-meta">${shared
          ? `Prepared${date ? ` on ${esc(date)}` : ''} with ${esc(modelName)} by whoever shared this link. Its figures have been re-checked against the data loaded just now.`
          : `Prepared${date ? ` on ${esc(date)}` : ''} with ${esc(modelName)} from the figures in this report.`}</p>
      </div>
      <div class="brief-actions">
        ${canShare ? '<button class="btn ghost" type="button" data-act="share">Share link</button>' : ''}
        <button class="btn ghost" type="button" data-act="pdf">Save as PDF</button>
      </div>
    </header>
    ${warning}
    ${glance ? `<section class="brief-block"><h5 class="brief-label">At a glance</h5><ul class="glance">${glance}</ul></section>` : ''}
    ${sections ? `<section class="brief-block brief-sections"><h5 class="brief-label">Area by area</h5>${sections}</section>` : ''}
    ${brief.worth_checking.length ? `<section class="brief-block"><h5 class="brief-label">Worth checking</h5><ul class="check">${brief.worth_checking.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
    ${brief.bottom_line ? `<section class="brief-block brief-bottom"><h5 class="brief-label">Bottom line</h5><p>${esc(brief.bottom_line)}</p></section>` : ''}
    <p class="brief-foot">Written by ${esc(modelName)} from the open-data figures in this report and checked number by number against them. It describes the area, not the property: it is not a survey, a valuation or financial advice.</p>
  </article>`;
}

export function resetAI(mount) {
  mount.innerHTML = '';
}

export function mountAI(mount, place, results, shared = null) {
  const usable = results.filter(r => r.facts.length);
  if (!usable.length) return resetAI(mount);

  mount.innerHTML = `<section class="ai" aria-labelledby="ai-title">
    <div class="ai-head">
      <h3 id="ai-title">Area brief <span class="chip">optional</span></h3>
      <p class="pub">The report is complete without this. With an Anthropic API key, a model turns these figures into a short brief, the way a local estate agent would walk you through the area. Your key stays in this browser and is sent only to api.anthropic.com.</p>
      <div class="toolbar ai-controls">
        <select id="ai-model" aria-label="Model">
          ${MODELS.map(m => `<option value="${esc(m.id)}"${m.id === getModel() ? ' selected' : ''}>${esc(`${m.name} · ${m.note}`)}</option>`).join('')}
        </select>
        <button class="btn" id="ai-go" type="button">Generate brief</button>
        <button class="btn ghost" id="ai-copy" type="button">Copy the prompt instead</button>
        ${getKey() ? '<button class="btn ghost" id="ai-forget" type="button">Forget my key</button>' : ''}
      </div>
    </div>
    <div id="ai-out"></div>
  </section>`;

  const section = mount.querySelector('.ai');
  const out = mount.querySelector('#ai-out');
  const modelSelect = mount.querySelector('#ai-model');

  async function show(data) {
    const bad = unverifiedNumbers(briefText(data.brief), place, usable);
    out.innerHTML = briefHTML({ ...data, bad, place, results: usable });
    section.classList.add('has-brief');

    let url = `${location.pathname}?postcode=${encodeURIComponent(place.compact)}`;
    if (canShare) {
      try {
        url += SHARE_PREFIX + await pack({ v: 1, pc: place.compact, m: data.model, at: data.at, b: data.brief });
      } catch { /* the link still reproduces the report, just not the brief */ }
    }
    // The address bar becomes the share link, so a plain copy of the URL works too.
    history.replaceState(null, '', url);

    out.querySelector('[data-act="share"]')?.addEventListener('click', e =>
      shareLink(e.currentTarget, location.href, `Area brief: ${place.postcode}`));
    out.querySelector('[data-act="pdf"]').addEventListener('click', () =>
      savePdf(`Area brief ${place.postcode}`));
  }

  // A brief that arrived in the link, for this same postcode.
  if (shared && shared.postcode === place.compact) {
    show({ brief: shared.brief, model: shared.model, at: shared.at, shared: true });
  }

  modelSelect.addEventListener('change', () => {
    try { localStorage.setItem(MODEL_STORAGE, modelSelect.value); } catch { /* ignore */ }
  });

  mount.querySelector('#ai-forget')?.addEventListener('click', () => {
    try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
    mountAI(mount, place, results);
  });

  mount.querySelector('#ai-copy').addEventListener('click', async () => {
    const text = promptText(place, usable);
    try {
      await navigator.clipboard.writeText(text);
      out.innerHTML = '<p class="pub">Prompt copied. Paste it into claude.ai or any other assistant.</p>';
    } catch {
      out.innerHTML = `<p class="pub">Clipboard access was blocked, so here is the prompt to copy by hand:</p>
        <textarea readonly>${esc(text)}</textarea>`;
    }
    section.classList.remove('has-brief');
  });

  mount.querySelector('#ai-go').addEventListener('click', async () => {
    const key = getKey();
    if (!key) {
      out.innerHTML = `<p class="pub">Paste an Anthropic API key. <strong>A key in a browser is readable by any script on the page</strong>, so use one with a low spend cap that you can rotate, and forget it when you are done.</p>
        <div class="toolbar">
          <input id="ai-key" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" aria-label="Anthropic API key">
          <button class="btn" id="ai-save" type="button">Save and generate</button>
        </div>`;
      section.classList.remove('has-brief');
      mount.querySelector('#ai-save').addEventListener('click', () => {
        const value = mount.querySelector('#ai-key').value.trim();
        if (!value) return;
        try { localStorage.setItem(KEY_STORAGE, value); } catch { /* ignore */ }
        mountAI(mount, place, results);
        mount.querySelector('#ai-go').click();
      });
      return;
    }

    const button = mount.querySelector('#ai-go');
    button.disabled = true;
    section.classList.remove('has-brief');
    out.innerHTML = '<p class="pub" role="status">Writing the brief…</p>';

    try {
      const answer = await callAnthropic(key, modelSelect.value, place, usable);
      await show({ brief: answer.brief, model: answer.model, at: new Date().toISOString(), shared: false });
      if (answer.usage) {
        out.insertAdjacentHTML('beforeend',
          `<p class="pub brief-usage">${answer.usage.input_tokens} input + ${answer.usage.output_tokens} output tokens.</p>`);
      }
    } catch (err) {
      out.innerHTML = `<p class="err">${esc(explain(err))}</p>`;
    }
    button.disabled = false;
  });
}
