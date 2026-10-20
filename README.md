# Weis · Profitability Tracking (UC2 prototype)

A clickable prototype of Use Case 2, Profitability Tracking, for Weis Markets fresh departments. It follows the layout and style of the approved UC1 prototype (Weekly Sales Forecast): a dark header, a disclaimer strip, a two-row filter card, section headings with a narrative, key-figure tiles, hierarchical tables and a bottom tab bar.

> **Prototype disclaimer:** all data is simulated. Names of stores and districts follow the real Weis structure, but every figure is generated and must not be used for business decisions.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (password: BC2demo)
npm test           # Vitest: KPI formulas, fiscal calendar, filters, generator and planted stories
npm run build      # type-check + production build
npm run lint
```

The client-side password gate uses `VITE_ACCESS_PASSWORD` (default `BC2demo`). It only keeps casual visitors out of a demo; it is not security.

## Deploy on Vercel

1. Import the GitHub repository in Vercel. `vercel.json` already sets the framework (Vite), `npm ci`, `npm run build` and the `dist` output, plus security headers (CSP, `frame-ancestors 'none'`, HSTS, nosniff) and long caching for hashed assets.
2. Optional: under **Project Settings → Environment Variables** set `VITE_ACCESS_PASSWORD` (defaults to `BC2demo` when unset) and redeploy.
3. Node 20 or newer is required (`engines` in `package.json`).

## Tabs

| Tab | User story | Question |
|---|---|---|
| Category-Item Summary | 1 | Which items make money once cost and loss are counted? |
| Fresh Report | 2 | Which stores and districts are behind on fresh margin? |
| Shrink Review | 3 | Where is loss real, and where is it an entry error? |
| Store Loss View | 4 | Which stores and categories drive loss this week? |
| PLU Cost Watch | 5 (read-only) | Which composite PLU costs are out of date? |

Each tab has a row of charts under its key figures (Recharts): trends this year vs last year, a sales-to-margin bridge, an item map of margin vs loss, district gaps to budget, purchases mix, loss by week and type, top stores and departments by loss, and composite cost drift. Every chart has a hover tooltip and a `Table` toggle that shows the same numbers as a table. Charts, the main tables, the flagged list, the top-10 table and the purchases breakdown have an `Excel` button that downloads a real `.xlsx` (built in the browser by `src/lib/xlsx.ts`, no extra dependency). Amounts, percentages and points arrive as numbers with Excel formats, and hierarchical tables export every row, not only the expanded ones. Series colors (blue, orange, aqua, with gray for last year) were checked for color-blind separation with a palette validator.

Filters apply to every tab. A tab that cannot use a filter greys it out with a tooltip (Fresh Report ignores category, subcategory and SKU; PLU Cost Watch ignores time). The full filter state is kept in the URL query string, so any view can be shared by copying the address.

## Where things live

```
src/data/calendar.ts     Weis fiscal calendar (Sun–Sat weeks, 4-4-5 periods, LY = −364 days, holidays)
src/data/stores.ts       200 stores, 3 regions, 12 districts, size factors, openings/closings
src/data/catalog.ts      fresh product catalog source (≈570 items with retail, UoM and seasonal tags)
src/data/products.ts     product master: codes, margins, allowances, composite recipes and cost dates
src/data/generate.ts     seeded generator and the purchases / budget model
src/data/planted.ts      the six demo stories
src/lib/kpis.ts          every KPI formula (pure, typed, null-guarded)
src/lib/filters.ts       filter state, URL sync, period resolution, cascades, input hygiene
src/lib/filterStore.tsx  React context for the filter state
src/lib/selectors.ts     memoised aggregations per tab and the loss-flag engine
src/lib/definitions.ts   KPI definitions shown in the drawer
src/components/          Header, FilterCard, HierTable, KeyFigures, Banner, toggles, drawer
src/views/               one file per tab
```

All rates are ratios of totals (for example GM % = Σ Gross Margin ÷ Σ Net Sales). Any zero or missing denominator returns `null` and shows as `—`. Volume never adds `ea` and `lb`; `sumVolume` throws if asked to.

## How the data is generated

Everything is generated in the browser at startup (about 150 ms) from a fixed seed, **`20261018`** (`src/data/prng.ts`). Sequential draws use mulberry32; per-cell noise uses a stateless integer hash of (seed, item, store, week). The same filters therefore always show the same numbers. No data files are shipped.

Rather than storing every item × store × day row (≈120 M), the generator builds compact typed arrays at the grains the views need:

| Cube | Grain | Used for |
|---|---|---|
| Item × week (chain) | 572 × 147 | sales, units, retail, PO cost, deal weeks, known loss, donations, salvage, recall, markdown |
| Item × day (chain) | 572 × 1,023 | daily ranges in Category-Item Summary |
| Category × store × week | 24 × 200 × 147 | each store's share of chain sales and known loss |
| Department × week | 6 × 147 | discount rate |

Store values are the chain value × the store's share. A single item × store × week cell (needed for loss flags, the 26-week average and the store top-10) is derived on demand from the same inputs plus a bounded hash, so it never needs storing. Fresh Report purchases are computed per department × store × week from channel fractions. Aggregations are memoised by filter key; filter changes recompute in under 80 ms on a laptop.

Horizon: FY2024 (starts Sun 12/31/2023) to FY2026 to date, as of **Sun 10/18/2026 (FY2026 W43)**. Weekly sources stop at the last complete week, W42.

Magnitudes follow the 2024 Fresh Report and Fresh Shrink report, grown about 3 % a year. Weekly chain sales are Meat ≈ $8.2M, Produce ≈ $6.9M, Deli ≈ $4.0M, Bakery ≈ $2.4M, Seafood ≈ $1.5M and Floral ≈ $0.8M before seasonality. Known loss at cost runs 1.9 / 2.8 / 5.5 / 1.8 / 4.6 / 6.0 % of sales, and known loss at retail is 1.8–2.0 × the cost value. The calendar adds holiday lifts (Thanksgiving, Christmas, Easter, July 4, Memorial Day, Labor Day, Halloween, Super Bowl, Valentine's Day ×3 and Mother's Day ×2.5 for Floral). Item costs drift weekly (±10–20 % for berries, tomatoes, peppers and fresh seafood) and step quarterly for packaged items.

## Planted demo stories

| # | Story | Where to see it |
|---|---|---|
| 1 | **Fat-finger loss:** Atlantic Salmon Fillet, store 152, FY2026 W38. 1,110 lb was keyed instead of about 10 lb, worth $11,700 at cost. | Shrink Review: #1 in Flagged items, with a "Likely entry error" chip. |
| 2 | **Extreme error:** Strawberries 1 lb Clamshell, store 217, FY2026 W29, worth $8.9M. | A banner on Category-Item Summary and Shrink Review. In the flagged list it sits apart under "Above plausibility cap". Totals exclude flagged entries by default; switch to `Incl. flagged` to see the distortion. |
| 3 | **Stale composite cost:** 16 in. Pepperoni Pizza, cost last updated 03/2025. Cheese and pepperoni are +12 %, dough +18 % and boxes +32 %, so the displayed margin is about 9 pts too high. | Top row of PLU Cost Watch. In Category-Item Summary under Deli › Prepared foods › Pizza, the cost date shows in amber. |
| 4 | **Seafood squeeze:** shrimp cost +18 % from FY2026 P8 with retail frozen; Seafood GM % is about −2.7 pts vs LY over the same weeks. | The "Cost pressure" banner on Category-Item Summary. `Show Seafood since P8` applies the filter. |
| 5 | **Store outlier:** store 154 (D01) Meat GP % runs about 8 pts below budget in W39–W42, driven by DSD at 9 % of sales. | The "Below budget" banner on Fresh Report (default Period-to-Date). `Show store` filters to D01 and opens the purchases breakdown. |
| 6 | **Incomplete reporting:** stores 213, 386 and 290 posted no known loss for W42. | The "Incomplete reporting" banner on Store Loss View (default W42) and Shrink Review. |

`src/data/generate.test.ts` asserts each story, so a change to the generator that breaks a story fails the tests.

## Conventions and decisions

- **Last year** means the same weekdays 364 days earlier (agreed in UC1). Holiday periods compare to the same holiday last year.
- **Tab default periods:**
  - Category-Item Summary and Shrink Review default to Year-to-Date.
  - Fresh Report defaults to Period-to-Date.
  - Store Loss View defaults to the last complete week (W42).
  - Once you change the time filter, your choice applies to every tab until `Reset filters`.
- **Holiday periods** are an option of `Fiscal Calendar › Period`, so the UC1 time control keeps its four segments.
- **Fresh Report week columns** show the fiscal period that contains the end of the selected range.
- **Cost includes:** the default basis is list cost − trade rates. Each allowance switched on lowers net cost; "Freight billed separately" adds to it.
- **Flags:** the rule (weekly loss > $1,000 AND more than 100 % above the item-store 26-week average) can be tuned live. Dollars are clamped to 250–100,000 and percent to 0–1,000. Entries above $100,000 are listed separately as implausible.

## Security and hygiene

- No secrets or API keys.
- No `eval`, `new Function` or `dangerouslySetInnerHTML`. All text renders through React.
- URL parameters, search text, dates and thresholds are validated and clamped.
- `index.html` carries a strict Content-Security-Policy (`self` plus Google Fonts). The dev server relaxes it only to allow Vite's inline HMR code (`vite.config.ts`).
- Errors show a generic message in the UI; details go to the console only.
