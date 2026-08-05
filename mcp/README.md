# agentic-house-search

An MCP server for UK neighbourhood research. Give it a postcode, get back what
the government's own open data says about that place — demographics, crime,
deprivation, prices, fibre, 5G, noise, transport, amenities, schools and
planning constraints — plus a searchable registry of the 45 datasets underneath.

It is the [postcode report](https://asturksever.github.io/agentic-house-search-data-registry/report.html)
with an agent-shaped front door. Both run the *same* provider modules, so a
threshold or a caveat is written once and shows up in both.

## Connect

Nothing to install, no account, no API key. Paste this URL wherever your client
asks for a connector, custom integration or MCP server URL:

```
https://agentic-house-search.vercel.app/mcp
```

The [connect page](https://asturksever.github.io/agentic-house-search-data-registry/connect.html)
has a copy button, one-click buttons for Cursor and VS Code, and the same
instructions per client.

**Claude Code:**

```bash
claude mcp add --transport http agentic-house-search https://agentic-house-search.vercel.app/mcp
```

**Anything that connects by editing JSON** — Claude Desktop
(`claude_desktop_config.json`), a project `.mcp.json`, and most others:

```json
{
  "mcpServers": {
    "agentic-house-search": {
      "type": "http",
      "url": "https://agentic-house-search.vercel.app/mcp"
    }
  }
}
```

`GET /health` says whether the endpoint is up, which is more useful than a
client that only reports "connection failed".

### Or run it yourself

Free, ungated and with no dependency on the hosted deployment. Requires Node 20+.

```bash
npx -y agentic-house-search              # stdio
npx -y agentic-house-search --http       # streamable HTTP on 127.0.0.1:8848
```

```json
{
  "mcpServers": {
    "agentic-house-search": {
      "command": "npx",
      "args": ["-y", "agentic-house-search"]
    }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `postcode_report` | Eleven categories for one postcode. Filter with `categories` to keep responses small. |
| `postcode_lookup` | Geography only — coordinates, local authority, ward, constituency, LSOA/MSOA/OA codes, police force, deprivation rank. One fast call. |
| `postcode_compare` | Two to five postcodes side by side on chosen categories, with comparability caveats. |
| `postcode_search_datasets` | Search the 45-dataset registry by text or category, paginated. |
| `postcode_get_dataset` | One registry entry in full: endpoint, API docs, licence, coverage, cadence. |

### Examples

```
"What's SW11 1AA like?"
  → postcode_report(postcode="SW11 1AA")

"Which of these three has the best broadband and transport?"
  → postcode_compare(postcodes=[...], categories=["broadband","transport"])

"Where would I get EPC data for a property?"
  → postcode_search_datasets(query="EPC") → postcode_get_dataset(id="epc")
```

## What the numbers mean

The point of this server is that every figure states what it actually describes.
Agents summarising it should carry that through:

- **Geography varies by source.** A census figure describes an LSOA — a
  neighbourhood of roughly 1,500 people, not an address. A crime count describes
  a 1 km square. Ofcom **mobile** coverage describes an entire local authority,
  because that is the finest grain Ofcom publishes; two postcodes in the same
  authority will always show identical mobile figures. Ofcom **broadband** is
  per postcode.
- **Coverage varies by UK nation, and is stated rather than hidden.** Census
  tables are England & Wales; `data.police.uk` excludes Scotland; the Planning
  Data platform, Defra noise and the DfE school register are England-only. Those categories come
  back as `out_of_coverage` with the reason and a link to the devolved
  equivalent — never as a zero or an empty result.
- **Deprivation ranks are not comparable across nations.** England, Wales,
  Scotland and Northern Ireland each rank their own areas against their own
  index over a different number of areas. The index and its size are always
  returned; `postcode_compare` refuses to let a cross-nation comparison pass
  without a caveat.
- **Police data depends on each force submitting.** A very low count in a
  built-up area is more likely a gap than a quiet street, and the report says so
  when the count is implausibly low.
- **`unavailable` means not built yet**, not "none" — currently the Defra noise
  extract, which needs a polygon join that has not been run.

This is not a survey, a valuation or a conveyancing search.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AHS_BASE_URL` | the published Pages site | Where to read the registry and pack extracts. Point it at `http://localhost:8000/` to develop against a local checkout. |
| `AHS_JS_ROOT` | next to the compiled output | Where the shared `js/` provider modules live. Only needed when a bundler has moved the compiled server away from them, which is what the hosted deployment does. |
| `ALLOWED_ORIGINS` | none | Comma-separated `Origin` allowlist for HTTP mode. Requests carrying any other `Origin` are rejected with 403. |
| `API_KEYS` | unset | HTTP mode only. Comma-separated `key` or `key:pro`. Unset means every caller is anonymous and nothing is rejected. |
| `RATE_LIMIT_ANONYMOUS` | 60/hour | HTTP mode only. A courtesy limit so one runaway agent cannot burn the upstream fair-use budgets. |
| `RATE_LIMIT_PRO` | 1000/hour | HTTP mode only. |

HTTP mode binds to `127.0.0.1` by default and is stateless: a fresh server per
request, so it scales horizontally with no session affinity.

**Running it yourself is free and ungated, and stays that way.** stdio has no
limits at all, and `--http` with no `API_KEYS` set is open. The rate limiting
exists so that a *shared* deployment is a good neighbour to the government APIs
underneath, not to nudge you toward a paid tier. There isn't one. See
[COMMERCIAL.md](COMMERCIAL.md) for where that boundary sits and what would have
to be true before any of it were sold.

## The hosted endpoint

`https://agentic-house-search.vercel.app/mcp` is this same package, built from
this repository, deployed as a serverless function
([`api/mcp.mjs`](../api/mcp.mjs), [`vercel.json`](../vercel.json)). It exists so
that connecting takes a URL rather than a config file. It is unauthenticated
because there is nothing to authenticate: every source is public open data and
the server holds no per-user state.

Both HTTP hosts share [`src/http.ts`](src/http.ts), so the hosted endpoint and
your own `--http` cannot drift apart in how they speak the protocol.

### Deploying it

**This repository is the deployment.** Vercel builds from GitHub: connect the
repo once, and every push to `main` redeploys the endpoint. There is no CLI step,
no separate copy of the source and nothing to remember to run — the same push
that updates the Pages site updates the MCP server, and a revert reverts both.

Setup is once, in Vercel's *Add New → Project → Import Git Repository*. Two
things matter:

- **Name the project `agentic-house-search`.** `vercel.json` carries every other
  setting, but not the project name, and the project name is what the URL is
  made of. Any other name and the documented URL is a lie — change it in
  `connect.html`, `server.json`, both READMEs and `index.html`, or alias a
  domain onto it.
- **Leave the framework preset on "Other."** The build command and output are
  already in `vercel.json`; a preset would override them.

The build runs `npm ci && npm run build` in `mcp/`, and `AHS_JS_ROOT=js` tells
the bundled function where the provider modules landed. `.vercelignore` keeps
the website's own files out of the upload, since Pages serves those and `/` here
redirects there.

`npm run smoke:http` drives the same entrypoint locally and runs in CI on every
push, so a deployment that would break should go red in Actions first.

[`server.json`](../server.json) is the entry for the official MCP registry,
which is how a client can offer this server by name rather than by URL. Publish
it with the registry's own CLI, from the repository root:

```bash
mcp-publisher login github
mcp-publisher publish
```

## Development

```bash
npm install
npm run build      # tsc, then copy ../js into dist/js
npm run smoke      # drives the built server over stdio and checks every tool
npm run smoke:http # drives the serverless entrypoint the hosted endpoint uses
npm run inspect    # MCP Inspector
```

`npm run build` copies the repo's `js/` provider modules into `dist/js`. That
copy is deliberate: the alternative is reimplementing eleven providers, their
thresholds and their coverage gates in TypeScript, which is exactly how the
website and the server would start disagreeing about the same postcode.

`evaluation.xml` holds ten verified questions for testing whether a model can
actually use these tools. Every answer comes from fixed geography, a dated
statistical release or the registry — never a live figure that moves monthly.

## Licence and attribution

This server is CC0. The data is not: it is public sector information under the
Open Government Licence v3.0, plus OS and Royal Mail rights in the postcode
geography, and OpenStreetMap contributors (ODbL) for amenities. Every response
carries the attribution — please keep it attached.
