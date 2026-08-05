// Publishes the sticky masthead's real height as --topbar-h.
//
// The report page has a second sticky strip (the category anchors) that has to
// dock directly beneath the bar, and deep-linked cards on every page need a
// scroll margin clearing it. That height is not a constant: the nav wraps onto
// its own row on narrow screens, and the serif wordmark changes height when the
// webfont lands after first paint. Measuring beats guessing at a breakpoint —
// a stale value here shows up as a heading hidden under the bar, which is
// exactly the kind of bug that only appears at one window width.

const bar = document.querySelector('.topbar');

// Held at module scope on purpose. An observer referenced only by its own
// observation can be collected, and the failure is silent: the variable simply
// stops tracking and keeps whatever height it last saw.
let observer = null;

if (bar) {
  const publish = () => {
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--topbar-h', `${h}px`);
  };

  publish();

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(publish);
    observer.observe(bar);
  }
  // The resize listener is not redundant. The observer alone was measured going
  // stale across a viewport change — leaving the bar reported as three wrapped
  // rows tall while it was actually one — and a wrong value here pushes the
  // report's anchor strip into empty space.
  window.addEventListener('resize', publish, { passive: true });
  // Newsreader swapping in re-flows the lockup, usually after the first measure.
  document.fonts?.ready.then(publish);
}
