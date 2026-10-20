# Weis · Profitability Tracking (UC2 prototype)

A clickable prototype of Use Case 2, Profitability Tracking, for Weis Markets fresh departments. It follows the layout and style of the approved UC1 prototype (Weekly Sales Forecast): a dark header, a disclaimer strip, a two-row filter card, section headings with a narrative, key-figure tiles, hierarchical tables and a bottom tab bar.

The requirements workbook is the source of truth for view names, KPI names, formulas and filters. The business interviews (Weis IT, Produce and Deli category managers) set the focus: **the problem is cost, not loss**. Produce's true cost lives in purchase orders in Biceps, Deli composite PLU costs are typed into Retalix from Excel about once a year, and UPC average cost already works.

> **Prototype disclaimer:** all data is simulated. Names of stores and districts follow the real Weis structure, but every figure is generated and must not be used for business decisions.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (password: BC2demo)
npm test           # Vitest
npm run build      # type-check + production build
npm run lint
```

The client-side password gate uses `VITE_ACCESS_PASSWORD` (default `BC2demo`). It only keeps casual visitors out of a demo; it is not security.

## Deploy on Vercel

1. Import the GitHub repository in Vercel. `vercel.json` sets the framework (Vite), `npm ci`, `npm run build` and the `dist` output. It also sets security headers (CSP, `frame-ancestors 'none'`, HSTS, nosniff) and long caching for hashed assets.
2. Optional: under **Project Settings → Environment Variables** set `VITE_ACCESS_PASSWORD` (defaults to `BC2demo`) and redeploy.
3. Node 20 or newer is required (`engines` in `package.json`).

## Views

The tab bar starts with the three views the workbook requires. Two additional views follow after a divider labelled *Additional views (proposed)*, and each carries a `Proposed` chip.

| View | What it answers | Drill-down |
|---|---|---|
| **Category-Item Summary** | Which items make money once cost and loss are counted? | Department › Category › Subcategory › SKU Number; click an item for its stores |
| **Item Cost Over Time** | What does this item really cost us, and since when? One SKU at a time. | Purchase orders; recipe components for composite PLUs |
| **Fresh Report** | Which stores and districts are behind on fresh margin? | Region › District › Store Number |
| Loss Review *(proposed)* | Where is loss real, where is it an entry error, and what drives it? | Flagged items, new items watch, store ranking |
| Cost Watch *(proposed)* | Where is the cost in HQ out of date, and what does it do to margin? | PO vs HQ cost; recipe PLUs by family |

### How each user story is satisfied

| # | User story (summary) | Metrics | Filters | View | Lowest grain | Refresh |
|---|---|---|---|---|---|---|
| 1 | Category manager / director evaluates item performance with accurate costs tied to recipes | Gross Sales, Net Sales, PO Costs, Purchase Cost per Unit, Net Sales per Unit, Gross Margin ($ / %), Total Loss | To Date, Rolling, Department, Category, Subcategory, SKU Number | Category-Item Summary | Item-Day | Daily sales |
| 2 | Real-time item cost for random-weight / PLU items, based on POs | PO Cost, PO Cost / Unit, Gross Sales, Gross Margin ($ / %) | To Date, Rolling, Department, Category, Subcategory, SKU Number | Category-Item Summary; Item Cost Over Time | Item-Day | Daily costs and sales |
| 3 | Simple store-level gross profit from sales and purchases, accounting for loss | Gross Sales, Purchases, Gross Profit ($ / %) | To Date, Rolling, Department, Category | Fresh Report | Category-Day | Daily sales and purchases |
| 4 | Review shrink impact on a category and spot fat-fingering errors | Total Loss, High Loss Flag | Department, Category, SKU Number | Category-Item Summary | Item-Day | Daily loss |
| 5 | Store or district manager sees where loss comes from, by store, region and district, with high loss flagged | Total Loss, High Loss Flag | Region, District, Store, Department, Category, SKU Number | Category-Item Summary | Item-Store-Day | Daily loss |
| 6 | Real-time cost of ingredient-based products and how ingredient costs change | Current PO Cost, New PO Cost | Department, Category, PLU Number | Item Cost Over Time (recipe components panel) | Item | Daily PO cost |

### Filters

Every filter in the workbook is available:
- **Time:** Date Range, Time Spans to Date (Current Day, WTD, PTD, QTD, YTD), Rolling (6, 13, 26, 52 weeks), Year, Quarter, Period, Week Beginning, Day, and Holiday Periods aligned with last year's same holiday.
- **Business:** Department, Category, Subcategory, SKU Number, Region, District, Store Number and ID Stores, plus a proposed Cost type filter.

A view greys out the filters it does not use, with a tooltip:
- Fresh Report has no SKU filter.
- In Item Cost Over Time, store filters do not apply (purchase orders are chain level) and the business filters only narrow the SKU picker.
- Cost Watch uses neither time nor store filters.

The full state, including column choices and assumptions, lives in the URL query string, so any view can be shared by copying the address.

### Proposed extras (hidden by default)

Every table has a **Columns** chooser (groups Sales, Cost, Margin, Loss, Sell-through, YoY), a sticky hierarchy column and a pinned Total row. The required columns show by default. **Export to Excel always includes every column.**

| Proposed measure | Where |
|---|---|
| Cost type (UPC, PLU, Random weight) and Cost reliability | Item chips, Cost type filter, hidden column |
| Cost source switch `PO (real-time) \| HQ (current)` with the margin change in pts | Category-Item Summary (Pending validation) |
| Margin After Loss % with `Loss basis: Actual known loss \| Expected rate` and editable expected rates (0–30 %) | Category-Item Summary, Fresh Report |
| Units shipped, Units sold, Sell-through %, Shipped value $ (warehouse bill-out; C&S and DSD not included yet) | Category-Item Summary, Fresh Report |
| YoY and ID Stores YoY Gross / Net Sales growth | Hidden columns and tile sub-lines |
| Purchase Cost per Unit Purchased | Hidden column |
| Margin target bands (`src/data/targets.ts`) with a `Below target` chip and a quick filter | Gross Margin Rate bars, Item Cost Over Time |
| Cost change simulator (read-only: nothing is saved or sent) | Item rows in Category-Item Summary and Cost Watch, button in Item Cost Over Time |

## KPIs

Every formula lives in `src/lib/kpis.ts` (pure, typed, null-guarded) and uses the workbook names everywhere: tiles, headers, the definitions drawer and exports. All rates are ratios of totals, and a zero or missing denominator shows `—`. Volume never adds `ea` and `lb`; per-unit values at aggregate rows show one line per unit of measure.

- **Gross Margin Rate** = SUM(Gross Margin) ÷ SUM(**Gross Sales**). A `Margin on: Gross Sales | Net Sales` toggle offers Net Sales as a proposed option.
- **Purchase Cost per Unit** = SUM(Total Purchases) ÷ SUM(Volume sold), as the workbook defines it. Wizeline asked whether volume should be units purchased; that version is a hidden column.
- **PO Cost / Unit:**
  - Landed PO cost (freight included), weighted by units sold.
  - **Current PO Cost** is the cost in HQ / Retalix.
  - **New PO Cost** is the last 4 weeks of POs weighted 0.4 / 0.3 / 0.2 / 0.1 (newest first) × quantity.
- **Fresh Report Gross Margin** is gross profit: Gross Sales − Total Purchases.
- **High Loss Flag** has two tiers:
  - **Likely entry error:** loss units above 20× the item-store typical weekly units, or above $100,000.
  - **High loss to review:** weekly loss above $1,000 and more than 100 % above the item-store 26-week average.
  - Totals exclude likely entry errors by default and show both figures side by side.

The **KPI definitions** modal lists each KPI with its business definition, calculation, legacy source, reconciliation target, the views that use it, workbook priority and status (Draft, Proposed, Pending validation). It ends with the workbook's four open questions:
- Gross Sales source for the Fresh Report.
- Biceps PO access and its link to Retalix.
- High-loss thresholds.
- Outside-vendor (C&S, DSD) tracking.

## How the data is generated

Everything is generated in the browser at startup from a fixed seed, **`20261018`** (`src/data/prng.ts`). The same filters always show the same numbers, and no data files are shipped.

| Cube / model | Grain | Used for |
|---|---|---|
| Item × week (chain) | 586 × 147 | sales, units, retail, market cost, deal weeks, known loss, donations, salvage, recall, markdown |
| Item × day (chain) | 586 × 1,023 | daily ranges (Category-Item Summary, Fresh Report Day) |
| Category × store × week | 24 × 200 × 147 | each store's share of chain sales and known loss |
| Purchasing (`src/data/purchasing.ts`) | item × vendor × delivery day | purchase orders, landed PO cost, HQ cost, recipe components |
| Fresh Report purchases | department × store × week, split to category and item | Total Purchases by channel |

**Cost.** Every item has a cost type:
- **PLU and random-weight items** are bought from 1 to 3 vendors, with 2 to 3 deliveries a week. Each PO line has cases, a case pack (for example 25 lb for Roma tomatoes), a case cost and freight.
- **HQ** keeps one default cost per item, last updated 3 to 14 months ago, without freight.
- **UPC items** come from the Weis distribution center at their average cost.
- **Composite PLUs** are costed from recipe components. Each component has a quantity, a unit of costing and a cost index; slices cost the pie divided by the slice count, and discontinued components show in grey.

**Purchases.**
- **Stores buy ahead of selling.** About 55 % of a week's buying is for next week's sales. Holiday stock is bought the week before, capped at 1.8× this week's sales (3.2× for Floral), and deliveries arrive unevenly. Weekly Fresh Report margin therefore moves about 4–12 pts week to week (Floral more) and settles when read by period.
- **Department split.** Department purchases split to categories and items: merchandise channels (Whse, DSD, Reclaim, Transfers, In transit) by cost of goods plus loss, following the same one-week lead; packaging, donations and credits by sales share. Categories sum exactly to the department, items reconcile to department merchandise, and simulated inventory never goes negative.
- **Daily purchases** follow each store's delivery days.

**Calibration.**

| Department | Item-level Gross Margin Rate | Fresh Report Gross Margin Rate |
|---|---|---|
| Meat | 31–33 % | 27–30 % |
| Produce | 44–48 % | 37–40 % |
| Deli | 55–56 % | 42–44 % |
| Bakery | 58–60 % | 49–51 % |
| Seafood | 34–37 % | 25–32 % |
| Floral | 60–65 % | 50–60 % |

Known loss stays at its usual share of sales. The gap between the two methods is unknown loss and inventory timing.

**Realism.**
- Districts range about −3 to +3 pts versus budget.
- Each store has its own loss factor by department (0.6–1.6×) and a slightly different category mix.
- Loss spikes after Thanksgiving, Christmas and Easter, after Valentine's and Mother's Day (Floral), and in late summer (Produce).
- About 30 % of flags are likely entry errors. The rest are real high loss, including post-holiday overstock.

Horizon: FY2024 (starts Sun 12/31/2023) to FY2026 to date, as of **Sun 10/18/2026 (FY2026 W43)**. Weekly sources stop at the last complete week, W42. Filter changes re-render in under 300 ms on a laptop; the first load of a view takes up to about 250 ms.

## Planted demo stories

| Story | Where to see it |
|---|---|
| **Roma tomatoes 25 lb case:** one vendor's cost jumps from $19.95 to $44.95 in FY2026 W36. Margin on PO cost falls below the Produce band. | Default item in Item Cost Over Time; #2 in Cost Watch. |
| **Pie pumpkin bins:** Current PO Cost (HQ) $150 per bin, New PO Cost $250 per bin in season (Labor Day to W42). | #1 in Cost Watch (largest estimated impact). |
| **16 in. Pepperoni Pizza:** recipe last costed 03/2025. Mozzarella and pepperoni are up about 12 % since then, so margin is about 9 pts too high. | Item Cost Over Time recipe panel; Cost Watch › Recipe PLUs. |
| **Deli soup:** store 116 sold 1 unit and scanned out 4,000 in FY2026 W40. | Likely entry error in Loss Review; click the item in Category-Item Summary for its stores. |
| **Salmon fat-finger:** store 152, W38, 1,110 lb instead of about 10 lb, worth $11,700. | #1 in Loss Review's flagged list. |
| **Strawberries $8.9M:** store 217, W29, a likely entry error above the plausibility cap. | Banners; listed apart in the flagged list; excluded from totals by default. |
| **Shrimp cost squeeze:** +18 % from P8 with retail frozen. | "Cost pressure" banner in Category-Item Summary. |
| **Store 154 DSD:** Meat about 8 pts below budget over W39–W42, with DSD at 9 % of sales. | "Below budget" banner in Fresh Report. |
| **Incomplete reporting:** stores 213, 386 and 290 posted no known loss for W42. | Loss Review banner. |

The tests (`src/data/generate.test.ts`, `src/lib/workbook.test.ts`) assert each story.

## Where things live

```
src/data/calendar.ts     Weis fiscal calendar (Sun–Sat weeks, 4-4-5 periods, LY = −364 days, holidays)
src/data/stores.ts       200 stores, 3 regions, 12 districts, size factors, openings/closings
src/data/catalog.ts      fresh product catalog source with retail, UoM and seasonal tags
src/data/products.ts     product master: codes, cost type, margins, allowances, recipes, launches
src/data/generate.ts     seeded generator: sales, loss, events, purchases timing, budget
src/data/purchasing.ts   vendors, purchase orders, landed PO cost, HQ cost, recipe components
src/data/targets.ts      margin target bands (Proposed)
src/data/planted.ts      planted demo stories
src/lib/kpis.ts          every KPI formula (pure, typed, null-guarded)
src/lib/filters.ts       filter state, URL sync, period resolution, cascades, input hygiene
src/lib/selectors.ts     memoised aggregations, purchases allocation and the loss-flag engine
src/lib/itemCost.ts      Item Cost Over Time picker and default item
src/lib/definitions.ts   KPI definitions and workbook open questions
src/lib/xlsx.ts          dependency-free .xlsx writer for Excel export
src/components/          Header, FilterCard, HierTable (column chooser), charts, simulator, drawers
src/views/               one file per view
```

## Security and hygiene

- No secrets or API keys.
- No `eval`, `new Function` or `dangerouslySetInnerHTML`. All text renders through React.
- URL parameters, search text, dates, thresholds, simulator inputs and assumptions are validated and clamped.
- `index.html` carries a strict Content-Security-Policy (`self` plus Google Fonts). The dev server relaxes it only to allow Vite's inline HMR code (`vite.config.ts`).
- Errors show a generic message in the UI; details go to the console only.
