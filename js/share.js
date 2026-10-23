// Sharing and PDF export for the postcode report.
//
// Both work without a server. A link carries the postcode in the query string
// and, when there is one, the AI brief compressed into the #fragment (see
// ai.js). A fragment is never sent to any server, this site's included, so a
// shared brief travels only between the two people's browsers.
//
// "PDF" is the browser's own print-to-PDF. The page's CSP allows scripts from
// this origin only, so a PDF library from a CDN is not an option, and the
// print path gives selectable text and real links rather than a picture of
// the page. report.css carries the print layout; theme.js switches to the
// light theme for the duration of printing.

/** Share a URL: the native share sheet where there is one, else the clipboard. */
export async function shareLink(button, url, title) {
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  const done = text => {
    button.textContent = text;
    setTimeout(() => { button.textContent = label; }, 2000);
  };

  // navigator.share needs a user gesture and rejects with AbortError when the
  // person closes the sheet, which is not a failure worth reporting.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, url }); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    done('Link copied');
  } catch {
    // Clipboard refused (permissions, insecure context). The URL bar already
    // holds the same link, because callers replaceState it before sharing.
    done('Copy it from the address bar');
  }
}

/** Open the print dialog with a filename-friendly title, then put it back. */
export function savePdf(title) {
  const before = document.title;
  document.title = title;
  const restore = () => { document.title = before; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}
