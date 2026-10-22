// Recapture the landing page's "Three ways in" screenshots (assets/shots/) of
// the report, connect and registry pages, in light and dark, at 3x density.
//
// Drives headless Chrome over the DevTools Protocol with Node's built-in
// WebSocket, so it needs no dependencies. It sets the saved theme the way the
// toggle does (localStorage on the site's origin), waits for every report tile
// to resolve from the live APIs, and clips to the element rather than to
// guessed pixel offsets. Rerun it whenever one of those pages changes visibly.
//
//   python3 -m http.server 8795                      # serve the repo root
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless=new --remote-debugging-port=9333 \
//     --user-data-dir=/tmp/ahs-capture about:blank &
//   node scripts/capture-shots.mjs 9333 http://localhost:8795 assets/shots
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [port, origin, outDir] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// 760 CSS px wide at 3x: 2280 real pixels, enough for the lead card's zoomed
// crop on a retina screen.
await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 1400, deviceScaleFactor: 3, mobile: false });
await send('Page.enable');

const SHOTS = [
  // name, path, how long live data needs, clip: element top -> fixed height
  { name: 'report', path: '/report.html?postcode=SW1A1AA', wait: 12000, from: '#place', height: 540 },
  { name: 'connect', path: '/connect.html', wait: 1500, from: '.steps', height: null },
  { name: 'registry', path: '/registry.html', wait: 2500, from: '.toolbar', height: 540 },
];

for (const theme of ['light', 'dark']) {
  // Same origin as the site, so the saved choice is what js/theme.js reads.
  await send('Page.navigate', { url: origin + '/index.html' });
  await sleep(1500);
  await evaluate(`localStorage.setItem('ahs-theme', '${theme}')`);

  for (const s of SHOTS) {
    await send('Page.navigate', { url: origin + s.path });
    await sleep(s.wait);
    // The report fills in tile by tile from live APIs. Wait until no tile is
    // still showing the "…" placeholder, so the shot shows a finished report.
    if (s.name === 'report') {
      for (let t = 0; t < 45; t++) {
        const pending = await evaluate(`[...document.querySelectorAll('.tile .figure')].filter(f => f.textContent.trim() === '…').length`);
        if (pending === 0) break;
        await sleep(1000);
      }
    }
    const rect = await evaluate(`(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = document.querySelector('${s.from}');
      const r = el.getBoundingClientRect();
      return { y: r.top + scrollY, h: r.height, theme: document.documentElement.dataset.theme };
    })()`);
    if (rect.theme !== theme) throw new Error(`${s.name}: expected ${theme}, page is ${rect.theme}`);
    // Full content width, from 24px gutter to gutter, so the shot reads as a page.
    const clip = { x: 0, y: Math.max(0, rect.y - 12), width: 760, height: (s.height ?? rect.h) + 36, scale: 1 };
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 86, clip, captureBeyondViewport: true });
    const file = join(outDir, `${s.name}-${theme}.webp`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(theme, s.name, Math.round(clip.width * 3) + 'x' + Math.round(clip.height * 3), Math.round(data.length * 0.75 / 1024) + 'KB');
  }
}
ws.close();
