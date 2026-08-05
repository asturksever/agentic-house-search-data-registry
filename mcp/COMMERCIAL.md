# Open core: where the line is, and what has to clear before it moves

This file records a decision so that future work does not quietly redraw it.

## The line

**Running the server yourself is free, ungated, and stays that way.** That is
the npm package: stdio or your own HTTP, unlimited, no key, no account, reading
public data. It is the whole product, not a crippled sample. If a paid tier ever
tempts a feature out of the free one, that is the mistake this file exists to
prevent.

**A hosted endpoint is the only thing that could ever be sold**, because a
hosted endpoint is the only thing that costs money to run. The split is drawn
where the cost is, not where the value is.

| | Self-hosted (free, forever) | Hosted free (running today) | Hosted paid (if it ever launches) |
| --- | --- | --- | --- |
| Transport | stdio, or `--http` on your own box | one URL, streamable HTTP | same behind a gateway |
| Tools | all five | all five | all five |
| Limits | none | a courtesy rate limit | tiered per API key |
| Auth | none | none | API key |
| Data | public site, or your own via `AHS_BASE_URL` | same | same, plus anything needing a key we hold |
| Support | GitHub issues | GitHub issues | whatever is promised in writing |

The middle column exists because installation friction was the thing actually
keeping people out, not price. It is unauthenticated on purpose: every source is
public open data and the server holds no per-user state, so a sign-in step would
protect nothing and cost a step. It is not a funnel and there is nothing behind
it to funnel anyone into.

## What a paid tier would actually be selling

Not the data. The data is open government data and anyone can rebuild it, which
is the honest reason this is open core and not a closed product. A hosted tier
would sell the things that genuinely cost money or carry risk:

- **Batch and bulk** lookups, hundreds of postcodes per call, which is where
  compute and upstream fair-use budgets get consumed.
- **Sources needing a key somebody has to hold and pay for**, EPC being the
  obvious one, which is deliberately absent today because a static site cannot
  hold a secret.
- **History and change alerts**, which need storage and a scheduler rather than
  a static file.
- **A commercial-use licence and an SLA**, which is what a business is really
  buying. See the blockers below before selling either.

## Where the boundary lives in code

All of it is in `src/services/access.ts`, wired into HTTP mode only in
`src/index.ts`. Nothing else in the codebase knows tiers exist.

The hosted free endpoint (`../api/mcp.mjs`) deliberately does **not** use
`access.ts`. It has no keys and no tiers, only a best-effort per-instance
courtesy limit, so none of the defects listed at the bottom of this file apply
to it — and it cannot quietly grow a paid tier by having one configured.

| Variable | Default | Effect |
| --- | --- | --- |
| `API_KEYS` | unset | Comma-separated `key` or `key:pro`. Unset means every caller is anonymous and nothing is rejected. |
| `RATE_LIMIT_ANONYMOUS` | 60/hour | Courtesy limit. Its job is stopping one runaway agent burning the upstream fair-use budgets, not metering. |
| `RATE_LIMIT_PRO` | 1000/hour | |
| `RATE_LIMIT_WINDOW_MS` | 3600000 | |

The limiter is in-memory and per-process on purpose. It is a good neighbour
policy, not billing infrastructure. Anything that actually charges money needs a
real gateway in front, and that is the point at which this stops being a
weekend's work.

## Blockers: three things to settle before charging anyone

Open Government Licence v3 explicitly permits commercial exploitation with
attribution, so most of the stack is fine. Three parts are not obviously fine,
and all three should be confirmed in writing before an invoice exists.

1. **Ofcom Connected Nations.** Published under Ofcom's own terms rather than
   OGL. Redistribution of derived postcode values was confirmed for the free,
   open case. Commercial redistribution is a separate question and has not been
   confirmed. This affects `packs/broadband` and `packs/mobile`.
2. **Postcode geography (OS and Royal Mail).** ONSPD and postcodes.io carry OS
   and Royal Mail derived intellectual property with permitted-use conditions.
   Commercial use of postcode data specifically is the usual trap in UK
   geospatial products, and it touches everything here because a postcode is the
   input.
3. **OpenStreetMap, via Overpass, is ODbL.** Producing a report is a "produced
   work" and relatively permissive. Building and distributing a derived database
   is not, and share-alike would attach. This affects the amenities and transport
   categories.

Also worth knowing rather than discovering: **GitHub Pages terms prohibit using
it to run a commercial service.** The free product reads from Pages quite
happily. A paid tier has to move that data hosting somewhere else first.

None of the above is legal advice. It is the list of questions to put to a
solicitor, and the reason the answer to "can I charge for this yet" is currently
"not until these three are answered".

## If and when a paid tier is built

Designed, costed and deliberately not built. This section exists so the thinking
does not have to be redone, and so nobody redraws the boundary by accident.

### Tiers

| Tier | Price | What it is |
| --- | --- | --- |
| **Self-hosted** | free, forever | The npm package. All five tools, all eleven categories, no key, no limits. Unchanged. |
| **Hosted free** | £0, key required | The funnel and the abuse boundary, not a product. Low daily cap, single postcode, best effort. |
| **Pro** | ~£29/mo | 10k requests/month, batch up to 100 postcodes, EPC, PDF output, webhooks, email support. |
| **Team** | ~£149/mo | Higher limits, async batch, history and change alerts, white-label PDF (attribution footer stays), 99.5% SLA. |
| **Embedded** | from ~£500/mo | A **support and updates subscription** plus a private pack mirror. Not a licence: the code is CC0 and selling permission already granted is a good way to lose a customer who reads `LICENSE.md`. |

### What is actually being sold

Compute, secrets held on your behalf, storage, uptime and attention. Never data
redistribution. That is not a slogan, it is what keeps revenue possible while
the licensing questions below are open, and it means each answer gates one
feature rather than the whole product.

| Feature | Exposed to the blockers? |
| --- | --- |
| Higher limits, SLA, support, webhooks | No. Sells compute and attention. |
| EPC | No. Sells a key you hold and its rate budget. Its own terms still need reading. |
| PDF output, attributed | Mostly no. Keep Ofcom categories out until blocker 1 clears. |
| Batch and bulk | **Yes.** Bulk postcode processing is exactly the pattern the OS and Royal Mail conditions target. |
| History and change alerts | **Yes.** A time series of Ofcom values is a derived database. |
| A commercial-use licence, private pack mirror | **Fully.** You can only grant what you hold. Ship last, if ever. |

Three mitigations make the exposed set survivable: return produced works
(`Fact` objects with `display`, `band` and narrative) and **never raw pack rows
or a bulk postcode table**; put a no-redistribution term in the contract; and
stop leaning on the public postcodes.io instance for commercial traffic, either
by building a geography pack from ONSPD or by taking an OS Data Hub plan.

### Structure

A **separate private repo depending on the public npm package**. The free
package gains zero dependencies and never grows a commercial branch, which is
the only version of "the free tier must not degrade" that is enforced by
construction rather than by good intentions.

That needs one small change here when the time comes: `createServer()` takes an
options bag (`enabledTools`, `extraTools`, `instructionsSuffix`) and
`package.json` gains an `exports` map, making this a library as well as a
binary. Defaults must preserve today's behaviour exactly.

### Smallest sellable increment

> Hosted Pro, ~£29/mo: a warm, authenticated endpoint at 10,000 requests/month,
> batch up to 100 postcodes, and email support. Keys issued by hand against a
> Stripe Payment Link.

No EPC, no history, no PDF, no billing automation. It sells compute and
reliability exclusively, and every licensing blocker is either untouched or
handled by output shape. Graduate from hand-issued keys at roughly ten
customers, not before: building billing automation for three customers is how a
solo product dies.

### Before the first invoice

1. Packs served from somewhere other than GitHub Pages, whose terms forbid
   commercial use. `js/config.js` makes this an environment variable, not a
   rewrite.
2. The cache TTL work (done, see `js/fetchx.js`) proven over a multi-day soak
   with flat memory.
3. Auth that **fails closed**. See the defects below.
4. Metering that survives a restart. Test it by killing the process mid-month.
5. A written position on bulk postcode processing.
6. Terms of service with no-redistribution and no-warranty-on-upstream-data
   clauses, and the `ATTRIBUTION` string on every paid output.

### Defects in `access.ts` that only matter once money is involved

Recorded so they are not rediscovered the hard way. None of them affect the free
product, which is why they are still here.

- **Keys are parsed once at startup.** Adding or revoking a customer needs a
  restart, which also wipes every rate-limit counter.
- **An unknown tier string silently becomes `anonymous`.** `key:Pro` downgrades
  a paying customer with no error, which is the exact failure the unknown-key
  branch was written to avoid.
- **Rate-limit counters are per-process and in memory.** Two instances behind a
  load balancer give every caller double their quota, and a deploy resets
  everyone.
- **`trust proxy` is never set**, so behind a proxy every anonymous caller
  shares one `req.ip` bucket.
- **Unauthenticated requests fall through to `anonymous`** even when keys are
  configured. A hosted deployment must reject instead.

## Status

Boundary in place, nothing behind it. There is a hosted deployment, but it is
the free one: no billing, no keys, no pricing, no tier to upgrade to. It exists
because "install this npm package and edit a JSON file" was losing people who
would have used the thing. Deliberate: the free and open version is what builds
the audience that would eventually buy anything, and it is worth more right now
as proof of work than as revenue.
