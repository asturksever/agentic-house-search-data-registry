# gh-pages — forwarding only

This branch is not the site. It holds one page, served by GitHub Pages as both
`index.html` and `404.html`, which forwards any old `asturksever.github.io`
link to the same path on the host that now serves everything:

<https://agentic-house-search.vercel.app/>

The site, the registry, the postcode report and the MCP endpoint moved onto a
single host, because GitHub Pages cannot serve the `POST` that the Model
Context Protocol requires. This branch exists so that links shared before the
move keep working. It is deliberately tiny and should stay that way — the real
site lives on `main`.
