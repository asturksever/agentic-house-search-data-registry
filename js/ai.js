// Optional AI summary, using the visitor's own Anthropic key.
//
// This page is static — there is no server to hold a key in — so the only
// honest options are "bring your own" or "no LLM". The deterministic narrative
// above every card is the real report; this is an addition that can be ignored
// entirely, and every figure it produces is checked back against the facts
// before it is shown.

import { forPrompt } from './facts.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const KEY_STORAGE = 'ahs.anthropic_key';
const MODEL_STORAGE = 'ahs.anthropic_model';

// One constant, so a model change is a one-line edit.
const DEFAULT_MODEL = 'claude-opus-5';
const MODELS = [
  ['claude-opus-5', 'Claude Opus 5 — best quality'],
  ['claude-sonnet-5', 'Claude Sonnet 5 — cheaper'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5 — cheapest'],
];

const SYSTEM = `You are summarising a neighbourhood report for someone considering buying a home there.

You will be given JSON: a place, and one entry per category with facts already
computed from UK open data.

Rules:
- Use only numbers that appear in the JSON. Never compute a new statistic, a
  ratio, an average or a projection from them.
- Do not add outside knowledge about the area, the town or the market.
- Where a category is "unavailable" or "out_of_coverage", say so briefly and why;
  do not speculate about what the missing data might have shown.
- Describe what the data says. Do not advise whether to buy, and do not call the
  area good, bad, desirable or up-and-coming.
- UK English. No headings, no bullet points, no markdown.
- Write one short paragraph (up to about 100 words) per category that has facts,
  each starting with the category label followed by a colon. Then one final
  paragraph of at most three sentences pulling the picture together.
- Prefer the comparisons already present in the JSON (the "comparison" field)
  over inventing your own framing.`;

const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const getKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } };
const getModel = () => { try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; } };

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
  return `${SYSTEM}\n\n---\n\n${JSON.stringify(payload(place, results), null, 2)}`;
}

/* --------------------------------------------------------------- guardrails */

// Any figure in the summary must be traceable to a fact. Model arithmetic is
// exactly the failure this report cannot afford, so an untraceable number
// downgrades the summary to "unverified" rather than being quietly shown.
export function unverifiedNumbers(text, results) {
  const allowed = new Set();
  const add = v => {
    if (typeof v !== 'number' || !isFinite(v)) return;
    allowed.add(Math.abs(v));
    allowed.add(Math.abs(Math.round(v)));
    allowed.add(Math.abs(Number(v.toFixed(1))));
  };

  for (const res of results) {
    for (const f of res.facts) {
      add(f.value);
      for (const b of f.benchmarks) add(b.value);
      // Numbers that only appear inside a formatted string ("£508,945 vs
      // £926,387", "3 of 10") are legitimate too.
      for (const m of String(f.display).matchAll(/\d[\d,]*\.?\d*/g)) {
        add(Number(m[0].replace(/,/g, '')));
      }
      for (const b of f.benchmarks) {
        for (const m of String(b.display ?? '').matchAll(/\d[\d,]*\.?\d*/g)) {
          add(Number(m[0].replace(/,/g, '')));
        }
      }
    }
    for (const note of [...res.notes, ...res.facts.map(f => f.note || '')]) {
      for (const m of String(note).matchAll(/\d[\d,]*\.?\d*/g)) {
        add(Number(m[0].replace(/,/g, '')));
      }
    }
  }

  const close = n => [...allowed].some(a =>
    a === n || (a !== 0 && Math.abs(a - n) / Math.max(a, 1) <= 0.01));

  const bad = [];
  for (const m of text.matchAll(/\d[\d,]*\.?\d*/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!isFinite(n)) continue;
    if (n <= 12) continue;                       // "three of the four operators"
    if (n >= 1900 && n <= 2100 && Number.isInteger(n)) continue;  // years
    if (!close(n)) bad.push(m[0]);
  }
  return [...new Set(bad)];
}

/* ------------------------------------------------------------------ request */

async function callAnthropic(key, model, place, results) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Required for a browser to call the API directly at all.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload(place, results)) }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
  return {
    text: (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
    usage: body.usage || null,
    stopReason: body.stop_reason,
  };
}

function explain(err) {
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

/* --------------------------------------------------------------------- view */

export function resetAI(mount) {
  mount.innerHTML = '';
}

export function mountAI(mount, place, results) {
  const usable = results.filter(r => r.facts.length);
  if (!usable.length) return resetAI(mount);

  mount.innerHTML = `<div class="ai">
    <h3>AI summary <span class="chip">optional</span></h3>
    <p class="pub">The report above is complete without this. If you have an Anthropic API key you can have a model read the same figures back as prose — the key is stored in this browser only and sent to nothing but api.anthropic.com.</p>
    <div class="toolbar">
      <select id="ai-model" aria-label="Model">
        ${MODELS.map(([id, label]) => `<option value="${esc(id)}"${id === getModel() ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <button class="btn" id="ai-go" type="button">Generate summary</button>
      <button class="btn ghost" id="ai-copy" type="button">Copy the prompt instead</button>
      ${getKey() ? '<button class="btn ghost" id="ai-forget" type="button">Forget my key</button>' : ''}
    </div>
    <div id="ai-out"></div>
  </div>`;

  const out = mount.querySelector('#ai-out');
  const modelSelect = mount.querySelector('#ai-model');

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
      out.innerHTML = '<p class="pub">Prompt copied — paste it into claude.ai or any other assistant.</p>';
    } catch {
      out.innerHTML = `<p class="pub">Clipboard access was blocked, so here is the prompt to copy by hand:</p>
        <textarea readonly>${esc(text)}</textarea>`;
    }
  });

  mount.querySelector('#ai-go').addEventListener('click', async () => {
    let key = getKey();
    if (!key) {
      out.innerHTML = `<p class="pub">Paste an Anthropic API key. <strong>A key in a browser is readable by any script on the page</strong> — use one with a low spend cap that you can rotate, and forget it when you are done.</p>
        <div class="toolbar">
          <input id="ai-key" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
          <button class="btn" id="ai-save" type="button">Save and generate</button>
        </div>`;
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
    out.innerHTML = '<p class="pub">Asking the model…</p>';

    let answer;
    try {
      answer = await callAnthropic(key, modelSelect.value, place, usable);
    } catch (err) {
      out.innerHTML = `<p class="err">${esc(explain(err))}</p>`;
      button.disabled = false;
      return;
    }

    const bad = unverifiedNumbers(answer.text, usable);
    const usage = answer.usage
      ? `<p class="pub">${answer.usage.input_tokens} input + ${answer.usage.output_tokens} output tokens.</p>`
      : '';
    const warning = bad.length
      ? `<p class="warn"><strong>Unverified figures:</strong> ${esc(bad.join(', '))} ${bad.length === 1 ? 'does' : 'do'} not appear in the data above. Treat this summary with suspicion — the tables are the record.</p>`
      : '';
    const truncated = answer.stopReason === 'max_tokens'
      ? '<p class="warn">The response was cut off at the token limit.</p>' : '';

    out.innerHTML = warning + truncated +
      answer.text.split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('') + usage;
    button.disabled = false;
  });
}
