# Zone 1–3 Finder

A curated London housing tracker covering three routes to a home, kept deliberately separate:

| Route | What it holds |
|---|---|
| **Rent** | Self-contained studios & 1-beds to rent solo, plus 2-beds worth sharing. Zone 1–3. |
| **Part-buy & schemes** | Shared ownership (10%–100% shares), shared-ownership resales, Intermediate Rent, London Living Rent / Rent-to-buy, and full-ownership buys. Includes a live share calculator. |
| **Own outright** | 100% ownership, ≤£250k, within roughly 3–5 miles of SW1V. Ex-local-authority, period conversions, refurbishment projects and auction lots. |

Live site: **https://karimahmed315.github.io/flatfinder/**

## Features

- **Search** across area, postcode, street and keywords, with numeric and structural intents:
  `under 1100`, `max 250k`, `over 900`, `zone 2`, `2 bed`, `studio`, and combinations such as
  `zone 2 studio under 1100`.
- **Faceted filters** as dropdowns: zone, bedrooms, scheme, max price / max share cost,
  max monthly rent, status and sort order. A filter only ever applies on a route where its
  control is visible.
- **Share calculator** — pick 25 / 40 / 50 / 75 / 100% and every shared-ownership listing
  reprices: the cash for that share, and the rent on the remainder (~2.5%/yr of the unsold
  portion). At 100% the rent disappears. Cards also show what a £250k budget buys as a share.
- **Shortlist** — save any home with the heart. Stored in your own browser.
- **Add a home** — paste a link from any portal; it appears as a *pending* card and can be
  copied out as a formatted summary for someone else to fold in properly.
- **Sold / let tracking** — homes that have gone stay visible but greyed, struck through and
  annotated with the reason, so the history of the search is preserved.

## Project layout

```
index.html    document shell, icon sprite (inline SVG), no build step
styles.css    design tokens + components
app.js        search parser, facet engine, share calculator, shortlist store, rendering
data.js       the listings themselves — window.LISTINGS
```

There is no framework and no bundler; open `index.html` and it runs.

### The data layer

`data.js` is the single source of truth. Each entry looks like:

```js
{
  id: "91295076",              // stable id, used by the shortlist
  route: "rent",               // rent | buy | own
  addr: "Somerfield Road, Finsbury Park",
  area: "Finsbury Park · Zone 2",
  zone: "2",                   // parsed from area; "2-3" spans two zones
  type: "1bed",                // studio | 1bed | 2bed | 3bed
  price: 950,                  // pcm for rentals; share/full cost for purchases
  unit: "share",               // label shown under the price
  scheme: "so",                // so | intrent | rent2buy | direct | auction | outright | …
  mo: 316, moEst: 0,           // monthly rent on the unsold share; moEst flags an estimate
  fullVal: 330000,             // full market value — enables the share calculator
  src: "Zoopla", url: "…", img: "…",
  note: "…", tags: ["…"],
  star: 1, isNew: 1, added: "2026-07-25",
  gone: "let", goneOn: "26 Jul", goneWhy: "listing removed by the agent"
}
```

Only entries with `fullVal` can be repriced by the calculator; the rest display as listed.

### Images

Portals block hot-linked images from third-party domains, so thumbnails are routed through
the `wsrv.nl` image proxy, with a typographic placeholder as the fallback.

## Updating

Replace the changed file (usually `data.js`) in this repository and commit. GitHub Pages
redeploys within about a minute and the URL never changes.

## Caveats

- Prices, availability and share percentages move constantly — confirm everything with the
  agent or housing provider, including lease length, service charges and eligibility.
- Shared-ownership rent is **estimated** at ~2.5%/yr of the unsold share; providers vary
  (roughly 1.9%–2.75%), and service charges are additional.
- Saved and added homes live in `localStorage`, so they are per-browser and per-person.
  Genuine multi-user sync would need a hosted database.
- Not financial, mortgage or legal advice.
