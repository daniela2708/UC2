# Weis · Profitability Tracking (UC2 prototype)

A clickable prototype of Use Case 2, Profitability Tracking, for Weis Markets fresh departments. It follows the layout and style of the approved UC1 prototype (Weekly Sales Forecast): a dark header, a disclaimer strip, a two-row filter card, section headings with a narrative, key-figure tiles, hierarchical tables and a bottom tab bar.

The requirements workbook is the source of truth for view names, KPI names, formulas and filters. The business interviews (Weis IT, Produce and Deli category managers) set the focus: **the problem is cost, not loss**.
- Produce's true cost lives in purchase orders in Biceps.
- Deli composite PLU costs are typed into Retalix from Excel about once a year.
- UPC average cost already works.

BCG named two MVP priorities, and the prototype shows both: ingredient cost flowing through recipes (Ingredients View) and period-based PO cost (Item Cost Over Time).

> **Prototype disclaimer:** all data is simulated. Names of stores and districts follow the real Weis structure, but every figure is generated and must not be used for business decisions.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (password: BC2demo)
npm test           # Vitest unit and data tests
npm run test:e2e   # builds, serves dist and clicks through the app in headless Chrome
npm run build      # type-check + production build
npm run lint       # zero warnings allowed
```

The client-side password gate uses `VITE_ACCESS_PASSWORD` (default `BC2demo`). It only keeps casual visitors out of a demo; it is not security.

The end-to-end check needs no extra packages: it drives a local Chrome or Chromium over the DevTools protocol (set `CHROME_PATH` if it is not in the usual place). It enters the password, then opens the cost change simulator from Category-Item Summary, Cost Watch and Item Cost Over Time and checks the item is prefilled. `BASE_URL=https://… node scripts/e2e.mjs` runs the same check against a deployed URL.

[DEMO.md](DEMO.md) has a 10-minute demo path.

## Deploy on Vercel

1. Import the GitHub repository in Vercel. `vercel.json` sets the framework (Vite), `npm ci`, `npm run build` and the `dist` output. It also sets security headers (CSP, `frame-ancestors 'none'`, HSTS, nosniff) and long caching for hashed assets.
2. Optional: under **Project Settings → Environment Variables** set `VITE_ACCESS_PASSWORD` (defaults to `BC2demo`) and redeploy.
3. Node 20 or newer is required (`engines` in `package.json`).

## Views

The tab bar starts with the five views the workbook requires. Cost Watch follows after a divider labelled *Additional views (proposed)* and carries a `Proposed` chip.

| View | What it answers | Drill-down |
|---|---|---|
| **Category-Item Summary** | Which items make money once cost and loss are counted? | Department › Category › Subcategory › SKU Number; click an item for its stores |
| **Item Cost Over Time** | What does this item really cost us, and since when? One SKU at a time. | PO cost by week or fiscal period; purchase order lines |
| **Ingredients View** | What does each ingredient add to a PLU's cost, and what happens when a base ingredient changes? | Ingredient table; "Where used" across every recipe |
| **Fresh Report** | Which stores and districts are behind on fresh margin? | Region › District › Store Number |
| **Known Loss Report** | Where does known loss come from, by item and store, and which entries should IT remove? | Department › Category › Item; one row per Store Num |
| Cost Watch *(proposed)* | Where is the cost in HQ out of date, and what does it do to margin? | PO vs HQ cost; recipe PLUs by family and ingredient |

### How each user story is satisfied

| # | User story (summary) | Metrics | Filters | View | Lowest grain | Refresh |
|---|---|---|---|---|---|---|
| 1 | Category manager / director evaluates item performance with accurate costs tied to recipes | Gross Sales, Net Sales, PO Costs, Purchase Cost per Unit, Net Sales per Unit, Gross Margin ($ / %), Total Loss | To Date, Rolling, Department, Category, Subcategory, SKU Number | Category-Item Summary | Item-Day | Daily sales |
| 2 | Real-time item cost for random-weight / PLU items, based on POs | PO Cost, PO Cost / Unit, Gross Sales, Gross Margin ($ / %) | To Date, Rolling, Department, Category, Subcategory, SKU Number | Item Cost Over Time; Category-Item Summary | Item-Day | Daily costs and sales |
| 3 | Simple store-level gross profit from sales and purchases, accounting for loss | Gross Sales, Purchases, Gross Profit ($ / %) | To Date, Rolling, Department, Category | Fresh Report | Category-Day | Daily sales and purchases |
| 4 | Review shrink impact on a category, spot fat-fingering errors and report them to IT for removal | Volume Sold, Sales ($), Known Loss (Units), Known Loss ($), High Loss Flag | Department, Category, Item, time | Known Loss Report (Report to IT, Export list for IT); Category-Item Summary | Item-Store-Week | Daily loss |
| 5 | Store or district manager sees where loss comes from, by store, region and district, with high loss flagged | Known Loss (Units / $), High Loss Flag | Region, District, Store Num, Department, Category, SKU Number | Known Loss Report (store table); Category-Item Summary | Item-Store-Week | Daily loss |
| 6 | Real-time cost of ingredient-based products; a change to a base ingredient flows to every recipe that uses it | Ingredient contribution, Cost / unit, Gross Profit ($ / %), Current and New PO Cost | Department, Category, PLU Number, time | Ingredients View ("Where used") | Item-Week | Daily PO cost |

### Filters

Every filter in the workbook is available:
- **Time:** Date Range, Time Spans to Date (Current Day, WTD, PTD, QTD, YTD), Rolling (6, 13, 26, 52 weeks), Year, Quarter, Period, Week Beginning, Day, and Holiday Periods aligned with last year's same holiday. Dates are always mm/dd/yyyy.
- **Business:** Department, Category, Subcategory, SKU Number, Region, District, Store Number and ID Stores, plus a proposed Cost type filter.

A view greys out the filters it does not use, with a tooltip:
- Fresh Report has no SKU filter.
- Item Cost Over Time and Ingredients View are chain level (POs and recipes are the same in every store). The business filters narrow their pickers.
- Cost Watch uses neither time nor store filters.

The full state, including column choices and assumptions, lives in the URL query string, so any view can be shared by copying the address.

### Proposed extras

Every large table has a **Columns** chooser with groups (Sales, Cost, Margin, Loss, Sell-through, YoY), presets, *Show all* and *Workbook default*. Presets:
- Category-Item Summary: *Loss focus*.
- Fresh Report: *Budget focus* and *Loss focus*.
- Cost Watch: *Gap explained*.

Every large table also has a sticky hierarchy column and a pinned Total row. **Export to Excel always includes every column.**

| Proposed measure | Where |
|---|---|
| Period-based PO Cost / Unit (`Cost period: Week \| Fiscal period`) | Item Cost Over Time, Category-Item Summary, Cost Watch |
| Cost source switch `PO (real-time) \| HQ (current)` with the margin change in pts | Category-Item Summary (Pending validation) |
| Cost type (UPC, PLU, Random weight), Cost reliability, purchase source chip | Item rows, Cost type filter |
| Margin After Loss % with `Loss basis: Actual known loss \| Expected rate` and editable expected rates (0–30 %) | Category-Item Summary, Fresh Report |
| Units shipped, Units sold, Sell-through %, Shipped value $ | Category-Item Summary, Fresh Report (column chooser) |
| YoY and ID Stores YoY Gross / Net Sales growth | Column chooser and tile sub-lines |
| Margin target bands (`src/data/targets.ts`) with a `Below target` chip | Category-Item Summary, Item Cost Over Time, Ingredients View, Cost Watch, simulator |
| Cost change simulator and Where used (read-only, nothing is saved or sent) | Item rows, Item Cost Over Time, Cost Watch; Ingredients View |
| Reason labels on the High Loss Flag, 26-week rule, `Excl. errors \| Incl. errors` | Flag rules popover, loss columns |
| New items watch (first 12 weeks on sale) | Known Loss Report |

## KPIs

Every formula lives in `src/lib/kpis.ts` (pure, typed, null-guarded) and uses the workbook names everywhere: tiles, headers, the definitions drawer and exports. All rates are ratios of totals, and a zero or missing denominator shows `—`. Volume never adds `ea` and `lb`; per-unit values at aggregate rows show one line per unit of measure.

- **Gross Margin Rate** = SUM(Gross Margin) ÷ SUM(**Gross Sales**). A `Margin on: Gross Sales | Net Sales` toggle offers Net Sales as a proposed option.
- **Total Purchases** is PO cost spent (Biceps), with three sources:
  - **Warehouse bill-out** for UPC items: shipments to stores, used as a proxy for purchases.
  - **Production cost (recipe)** for composite PLUs: units produced × recipe cost; unknown loss is not included.
  - **Fresh Report purchases**: the Fresh Report keeps its own store-level purchase channels. These are a different measure.
- **Purchase Cost per Unit** = SUM(Total Purchases) ÷ SUM(volume purchased).
- **PO Cost / Unit:**
  - **Period-based:** PO spend in the period ÷ volume purchased in the period. A period without purchases is a gap; margins then carry the latest PO cost and say so ("cost from W38").
  - It equals Purchase Cost per Unit for PLU and random-weight items (open question 5).
  - **Current PO Cost** is the cost in HQ / Retalix.
  - **New PO Cost** is the last complete week's PO cost ("as of W41" when that week had no purchases).
- **Fresh Report Gross Margin** is gross profit: Gross Sales − Total Purchases.
- **Ingredients View:**
  - Contribution = units per item × ingredient cost per unit.
  - Gross Profit ($) = Gross Sales − recipe cost × units sold.
  - Gross Profit (%) = Gross Profit ÷ Gross Sales (Pending validation).
- **High Loss Flag** = known loss higher than **$1,000** for an item in a store in a week. Exactly $1,000.00 is not flagged.
  - Threshold basis: at cost, assumed, Pending validation (open question 3).
  - "Likely entry error" and "High loss to review" are proposed secondary labels.
- **Loss valuation:** every loss column says "at cost" or "at retail". Cost vs retail is Pending validation; the Recon Map points to KL1011 "Known Loss Retail $".
- **Sign convention:** a cost increase is a margin loss. "Annual cost change +$X" reads with "Margin impact −$X", both red; the reverse is green. This applies in Where used, the simulator and Cost Watch.

The **KPI definitions** modal lists each KPI with its business definition, calculation, legacy source, reconciliation target, the views that use it, workbook priority and status (Draft, Proposed, Pending validation). It ends with the open questions:
1. Gross Sales source for the Fresh Report.
2. Biceps PO access and its link to Retalix.
3. High-loss thresholds and their basis.
4. Outside-vendor (C&S, DSD) tracking.
5. Whether PO Cost / Unit and Purchase Cost per Unit are the same KPI.

## How the data is generated

Everything is generated in the browser at startup from a fixed seed, **`20261018`** (`src/data/prng.ts`). The same filters always show the same numbers, and no data files are shipped.

| Cube / model | Grain | Used for |
|---|---|---|
| Item × week (chain) | 586 × 147 | sales, units, retail, market cost, deal weeks, known loss, donations, salvage, recall, markdown |
| Item × day (chain) | 586 × 1,023 | daily ranges |
| Category × store × week | 24 × 200 × 147 | each store's share of chain sales and known loss |
| Item × store × week corrections | sparse | planted store-level stories (store 116 soup) that every total derives from |
| Purchase orders (`src/data/purchasing.ts`) | item × vendor × delivery day | PO spend and volume, landed cost, HQ cost |
| Recipes and ingredients (`src/data/products.ts`) | PLU × ingredient × week | recipe quantities, ingredient cost per unit of costing |
| Fresh Report purchases | department × store × week, split to category | Fresh Report channels |

**Cost and purchases.**
- **PLU and random-weight items:** bought from 1 to 3 vendors, with 2 to 3 deliveries a week. Stores reorder up to par in whole cases, so stock never runs out and slow seasonal items skip weeks. Each PO line has cases, a case pack (for example 25 lb for Roma tomatoes), a case cost and freight.
- **HQ:** keeps one default cost per item, without freight, last updated 3 to 14 months ago.
  - Most items cost more on POs than in HQ, partly because of freight (Cost Watch "of which freight").
  - About 27 % cost less, because HQ was set at a seasonal or commodity high.
- **UPC items:** come from the Weis distribution center at their average cost.
- **Composite PLUs:** costed from recipes in real quantities.
  - Pizza dough ball, shredded mozzarella and pizza sauce are shared by every pizza and stromboli; pepperoni by seven PLUs. Slices take the pie's recipe ÷ 8.
  - The HQ standard cost is the recipe at ingredient costs in the month it was last costed.
  - About 60 % of recipes are older than 6 months and about one in ten older than a year.

**Calibration.**

| Department | Item-level Gross Margin Rate (target band) | Fresh Report Gross Margin Rate |
|---|---|---|
| Meat | 32 % (30–35 %) | 27–30 % |
| Produce | 47 % (45–50 %) | 37–40 % |
| Deli | 56 % (53–58 %) | 42–44 % |
| Bakery | 58 % (56–61 %) | 49–51 % |
| Seafood | 35 % (33–38 %) | 25–32 % |
| Floral | 63 % (58–66 %) | 50–60 % |

**Realism.**
- Stores buy ahead of selling (holiday stock the week before), so weekly Fresh Report margin moves about 4–12 pts and settles by period.
- Districts range about −3 to +3 pts versus budget.
- Each store has its own loss factor by department (0.6–1.6×).
- Loss spikes after holidays.
- About 30 % of flags are likely entry errors.

Horizon: FY2024 (starts Sun 12/31/2023) to FY2026 to date, as of **Sun 10/18/2026 (FY2026 W43)**. Weekly sources stop at the last complete week, W42. Filter changes re-render in under 300 ms on a laptop; the first load builds the purchase orders and takes about half a second.

## Planted demo stories

| Story | Where to see it |
|---|---|
| **Roma tomatoes 25 lb case:** $19.95 normally; a glut drops it to $4.95 in FY2026 W35, a spike takes it to $44.95 in W36, and it is back to normal by W39. HQ holds $19.45. | Default item in Item Cost Over Time (Week and Fiscal period). |
| **Pie pumpkin bins:** $150 per bin in HQ, $250 per bin on POs in season (W36–W42). | #1 in Cost Watch, PO vs HQ cost. |
| **16 in. Pepperoni Pizza:** recipe last costed 03/2025 at $4.85. The same recipe at today's ingredient costs is $5.66 (box +32 %, dough +18 %, mozzarella and pepperoni +12 %), so margin is about 8 pts too high. | Default PLU in the Ingredients View; #1 in Cost Watch › Recipe PLUs. |
| **Where used:** pizza dough ball is in 13 PLUs. At $0.85 / lb instead of $0.70, the annual cost change is +$439K and the margin impact −$439K. | Ingredients View › Where used. |
| **Deli soup:** store 116 sold 1 unit and scanned out 4,000 in FY2026 W40. It is a likely entry error. | Known Loss Report (flagged entries, store table with the SKU); Report to IT and Export list for IT. |
| **Salmon fat-finger:** store 152, W38, 1,110 lb instead of about 15 lb, worth $11,700. | Known Loss Report, flagged entries. |
| **Strawberries $8.9M:** store 217, W29, above the $100,000 plausibility cap. | Banner; excluded from totals by default. |
| **Store 154 DSD:** Meat about 7 pts below budget over W39–W42, with DSD at 9 % of sales. | "Below budget" banner in the Fresh Report. |
| **Shrimp cost squeeze:** cost up about 20 % since FY2026 P8 with retail flat. | "Cost pressure" banner in Category-Item Summary (Seafood). |
| **Incomplete reporting:** stores 213, 386 and 290 posted no known loss for W42. | Known Loss Report banner. |

The tests (`src/data/generate.test.ts`, `src/lib/workbook.test.ts`) assert each story.

## Where things live

```
src/data/calendar.ts     Weis fiscal calendar (Sun–Sat weeks, 4-4-5 periods, LY = −364 days, holidays)
src/data/stores.ts       200 stores, 3 regions, 12 districts, size factors, openings/closings
src/data/catalog.ts      fresh product catalog source with retail, UoM and seasonal tags
src/data/products.ts     product master: codes, cost type, margins, ingredients and recipes, launches
src/data/generate.ts     seeded generator: sales, loss, events, store corrections, Fresh purchases, budget
src/data/purchasing.ts   vendors, purchase orders, period-based PO cost, HQ cost, recipe lines
src/data/targets.ts      margin target bands (Proposed)
src/data/planted.ts      planted demo stories
src/lib/kpis.ts          every KPI formula (pure, typed, null-guarded) and the sign convention
src/lib/filters.ts       filter state, URL sync, period resolution, cascades, input hygiene
src/lib/selectors.ts     memoised aggregations and the loss-flag engine
src/lib/ingredients.ts   Ingredients View: contributions, totals, where used
src/lib/itReport.ts      IT review list and its export rows
src/lib/csv.ts           CSV export with formula-injection guard
src/lib/xlsx.ts          dependency-free .xlsx writer for Excel export
src/lib/definitions.ts   KPI definitions and workbook open questions
src/components/          Header, FilterCard, HierTable (column chooser), charts, simulator, IT list, drawers
src/views/               one file per view
scripts/e2e.mjs          end-to-end check in headless Chrome (no dependencies)
```

## Security and hygiene

- No secrets or API keys.
- No `eval`, `new Function` or `dangerouslySetInnerHTML`. All text renders through React.
- URL parameters, search text, dates, thresholds, simulator inputs, ingredient costs and assumptions are validated and clamped.
- CSV exports prefix text that starts with `=`, `+`, `-`, `@`, tab or carriage return with a single quote; numbers stay numeric.
- `index.html` carries a strict Content-Security-Policy (`self` plus Google Fonts). The dev server relaxes it only to allow Vite's inline HMR code (`vite.config.ts`).
- Errors show a generic message in the UI; details go to the console only.
