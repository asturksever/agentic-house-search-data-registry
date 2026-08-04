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

| | Self-hosted (free, forever) | Hosted (if it ever launches) |
| --- | --- | --- |
| Transport | stdio, or `--http` on your own box | `--http` behind a gateway |
| Tools | all five | all five |
| Limits | none | tiered per API key |
| Data | public site, or your own via `AHS_BASE_URL` | same, plus anything needing a key we hold |
| Support | GitHub issues | whatever is promised in writing |

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

## Status

Boundary in place, nothing behind it. No billing, no hosted deployment, no
pricing. Deliberate: the free and open version is what builds the audience that
would eventually buy anything, and it is worth more right now as proof of work
than as revenue.
