// Where this code is running, and where its data lives.
//
// The provider layer is shared by two very different hosts: the browser report,
// where everything is relative to the page, and the MCP server, where there is
// no page at all. Rather than fork the providers, both resolve their URLs
// through here.

// In a browser this is the directory the page was served from. Under Node
// there is no document, so the host calls setBase() before using anything.
let base = typeof document !== 'undefined' && document.baseURI
  ? document.baseURI
  : null;

/** Point the data layer at a site root. Node hosts must call this first. */
export function setBase(url) {
  base = String(url).endsWith('/') ? String(url) : `${url}/`;
}

export function getBase() {
  if (!base) {
    throw new Error(
      'No base URL is set. In a browser this comes from the page; under Node, ' +
      'call setBase(<site root>) before using the registry or any pack.');
  }
  return base;
}

/** Resolve a repo-relative path (data/registry.json, packs/…) against the base. */
export function resolve(path) {
  return new URL(path, getBase()).toString();
}
