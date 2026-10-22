// Light by default, dark on request.
//
// Loaded as a classic, blocking script in <head> on every page, before the
// stylesheets, so the saved theme is on <html> before first paint and a dark
// visitor never sees a flash of light. It is an external file rather than an
// inline snippet because report.html's CSP is script-src 'self'.
//
// The site deliberately ignores prefers-color-scheme: light is the designed
// default, and dark is a choice the visitor makes with the toggle in the top
// bar, remembered in localStorage. Storage can be unavailable (private modes,
// blocked site data), so every access is guarded and the page simply falls
// back to light.

(function () {
  var KEY = 'ahs-theme';
  var root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }

  // The browser chrome colour follows the theme, matching each mode's --bg.
  var CHROME = { light: '#ffffff', dark: '#151311' };

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', CHROME[theme]);
  }

  apply(saved());

  // Phosphor icons (regular weight, MIT), copied from @phosphor-icons/core
  // 2.1.1 rather than drawn. The button shows where it will take you: a moon
  // in light mode, a sun in dark.
  var MOON = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z"/></svg>';
  var SUN = '<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>';

  function render(btn) {
    var dark = root.getAttribute('data-theme') === 'dark';
    btn.innerHTML = dark ? SUN : MOON;
    // A toggle button: the name stays fixed and aria-pressed carries the state.
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function mount() {
    var bar = document.querySelector('.topbar');
    if (!bar || bar.querySelector('.theme-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.setAttribute('aria-label', 'Dark mode');
    render(btn);
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* not remembered; still applied */ }
      render(btn);
    });
    bar.appendChild(btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // Another tab changed the theme: follow it, so two open pages never disagree.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    apply(saved());
    var btn = document.querySelector('.theme-toggle');
    if (btn) render(btn);
  });
})();
