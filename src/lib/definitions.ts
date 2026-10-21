import type { Status } from '../components/ui';

export type ViewName = 'Category-Item Summary' | 'Item Cost Over Time' | 'Ingredients View' | 'Fresh Report' | 'Known Loss Report' | 'Cost Watch';

export interface KpiDefinition {
  id: string;
  name: string;
  unit: string;
  definition: string;
  formula: string;
  source: string;
  reconciliation: string;
  status: Status;
  /** Workbook priority. */
  priority?: 'Must' | 'Should' | 'Nice to have' | 'Proposed';
  /** Views that show the KPI. */
  views: ViewName[];
  note?: string;
}

const EASS = 'EASS1048 Category Cost Report';
const FRESH = 'Fresh Report (Accounting, Excel)';
const KL = 'KL1011 Dept Known Loss by Item (WebFocus)';
const BICEPS = 'Biceps ordering system (purchase orders)';
const CI: ViewName = 'Category-Item Summary';
const IC: ViewName = 'Item Cost Over Time';
const FR: ViewName = 'Fresh Report';
const KLR: ViewName = 'Known Loss Report';
const IV: ViewName = 'Ingredients View';

export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    id: 'gross-sales',
    name: 'Total Gross Sales',
    unit: '$',
    definition: 'Sales prior to discounts.',
    formula: 'Σ sales before discounts',
    source: `${EASS} · Category Analyzer`,
    reconciliation: 'Department weekly gross sales match EASS1048 within ±0.5 %.',
    status: 'Draft',
    priority: 'Must',
    views: [CI, FR],
    note: 'Shared with UC1.',
  },
  {
    id: 'net-sales',
    name: 'Total Net Sales',
    unit: '$',
    definition: 'Sales after discounts. At item level, discounts are allocated pro rata to gross sales (provisional rule).',
    formula: 'Gross Sales + Discounts (discounts are negative)',
    source: EASS,
    reconciliation: 'Department net sales match EASS1048; item-level allocation is not yet reconciled.',
    status: 'Pending validation',
    priority: 'Must',
    views: [CI, FR],
  },
  {
    id: 'volume',
    name: 'Total Volume',
    unit: 'units or lb',
    definition: 'Total amount of units or weight sold. Each and pounds are never added together; tiles and aggregate rows show them separately.',
    formula: 'Σ units (ea) ; Σ pounds (lb)',
    source: 'Scan Data',
    reconciliation: 'Item units match Scan Data within ±1 %.',
    status: 'Proposed',
    priority: 'Must',
    views: [CI, FR],
  },
  {
    id: 'avg-retail',
    name: 'Average Retail Price per Unit',
    unit: '$',
    definition: 'Average selling price per unit before discounts, within one unit of measure ("Avg. Unit Retail" in the Fresh Report). Mixed scopes show one value per unit of measure.',
    formula: 'SUM(Gross Sales) ÷ SUM(Volume)',
    source: `${FRESH} · Category Analyzer`,
    reconciliation: 'Matches the Fresh Report Avg. Unit Retail.',
    status: 'Draft',
    priority: 'Must',
    views: [FR],
  },
  {
    id: 'net-sales-unit',
    name: 'Net Sales per Unit',
    unit: '$',
    definition: 'Average net price per unit after discounts, within one unit of measure.',
    formula: 'SUM(Net Sales) ÷ SUM(Volume)',
    source: EASS,
    reconciliation: 'Derived; no legacy equivalent.',
    status: 'Draft',
    priority: 'Must',
    views: [CI],
  },
  {
    id: 'total-purchases',
    name: 'Total Purchases',
    unit: '$',
    definition:
      'PO cost spent, from PO cost and volume in Biceps (landed: case cost + freight). Sources by item: Biceps PO for PLU and random-weight items; warehouse bill-out for UPC items (shipments to stores, used as a proxy for purchases); production cost (recipe) for composite PLUs = units produced (sold + known loss) × recipe cost, unknown loss not included. Store filters take the stores’ share of the category. The Fresh Report keeps its own store-level purchases (Whse, DSD, Packaging, Reclaim, Transfers, In transit, Donations, WC credit, Scan credit), labelled "Fresh Report purchases".',
    formula: 'Σ PO lines (cases × (case cost + freight)) in the period; Fresh Report: Σ purchase channels',
    source: `${BICEPS} · Warehouse bill-out · ${FRESH}`,
    reconciliation: 'Item PO spend ties to Biceps PO lines; the Fresh Report ties to Accounting per store and week. The two are different measures and do not add up to each other.',
    status: 'Draft',
    priority: 'Must',
    views: [CI, IC, FR],
    note: 'Aggregate rows note when sources are mixed.',
  },

  {
    id: 'purchase-cost-unit',
    name: 'Purchase Cost per Unit',
    unit: '$',
    definition: 'Total Purchases divided by the volume purchased from PO data (units purchased, not units sold). Composite PLUs: production cost ÷ units produced. Shown within one unit of measure.',
    formula: 'SUM(Total Purchases) ÷ SUM(volume purchased)',
    source: BICEPS,
    reconciliation: 'Matches Biceps PO spend ÷ PO quantity for the same items and period.',
    status: 'Draft',
    priority: 'Must',
    views: [CI, IC],
  },


  {
    id: 'po-cost',
    name: 'PO Cost / Unit',
    unit: '$',
    definition:
      'Period-based weighted average (BCG proposal): total PO spend in the period ÷ volume purchased in the period, freight included. A period without purchases has no PO cost: a gap in charts and "—" in tables; Gross Margin and Total Net Cost then use the most recent PO cost, marked "cost from W38". "Current PO Cost" is the cost held in HQ / Retalix today; "New PO Cost" is the PO cost of the last complete week (or the latest earlier week with purchases, marked "as of W41"). The same method feeds the PO cost source switch. Real-time cost comes from purchase orders in the ordering system (Biceps) and may change after invoice reconciliation.',
    formula: 'Σ PO spend in the period ÷ Σ volume purchased in the period (null when no volume)',
    source: `${BICEPS} · Retalix (HQ cost)`,
    reconciliation: 'PO lines tie to Biceps; HQ cost ties to Retalix.',
    status: 'Proposed',
    priority: 'Must',
    views: [CI, IC, 'Cost Watch'],
    note: 'Replaces the earlier 4-week recency weighting. UPC items keep the HQ average cost; composite PLUs use the recipe cost.',
  },

  {
    id: 'total-net-cost',
    name: 'Total Net Cost',
    unit: '$',
    definition: 'Cost of the units sold under the selected cost basis ("Cost includes").',
    formula: 'Σ units sold × net cost per unit (week by week, as costs change weekly)',
    source: EASS,
    reconciliation: 'Department cost of goods sold within ±1 % of EASS1048.',
    status: 'Proposed',
    priority: 'Must',
    views: [CI],
  },
  {
    id: 'net-cost-unit',
    name: 'Net Cost / Unit',
    unit: '$',
    definition: 'Average cost per unit sold under the selected cost basis: list cost less the allowances switched on; freight billed separately adds to it. Composite PLUs use the recipe cost.',
    formula: 'Total Net Cost ÷ Total Volume',
    source: `${EASS} · vendor allowance files · Deli recipe workbook`,
    reconciliation: 'With trade rates only, equals PO Cost / Unit for warehouse items.',
    status: 'Proposed',
    priority: 'Must',
    views: [CI],
  },
  {
    id: 'gm',
    name: 'Gross Margin $',
    unit: '$',
    definition: 'Total gross margin. In Category-Item Summary: Net Sales − Total Net Cost. In the Fresh Report: gross profit, Gross Sales − Total Purchases.',
    formula: 'Net Sales − Total Net Cost (item) ; Gross Sales − Total Purchases (Fresh)',
    source: `${EASS} · ${FRESH}`,
    reconciliation: 'Item: within ±1 % of EASS1048. Fresh: equals the Fresh Report gross profit.',
    status: 'Draft',
    priority: 'Must',
    views: [CI, FR],
  },
  {
    id: 'gm-rate',
    name: 'Gross Margin Rate',
    unit: '%',
    definition: 'Gross margin as a share of gross sales. Always a ratio of totals. A Net Sales denominator is available as a proposed option.',
    formula: 'SUM(Gross Margin) ÷ SUM(Gross Sales)',
    source: EASS,
    reconciliation: 'Department rate within ±0.3 pts of EASS1048.',
    status: 'Pending validation',
    priority: 'Must',
    views: [CI, FR],
  },
  {
    id: 'fresh-gm',
    name: 'Gross Margin Rate (Fresh method)',
    unit: '%',
    definition: "Accounting's Fresh Report gross profit rate. It includes loss and inventory timing by construction, so it reads 8–13 pts below item-level margin. Weekly values swing because purchases do not line up with sales; read it by week or period to date.",
    formula: '(Gross Sales − Total Purchases) ÷ Gross Sales',
    source: FRESH,
    reconciliation: "Equals Accounting's Fresh Report GP % per store and department.",
    status: 'Draft',
    priority: 'Must',
    views: [FR],
  },
  {
    id: 'budget-gp',
    name: 'Budget GP %',
    unit: '%',
    definition: 'Budgeted Fresh Report GP % by department, store and fiscal period, weighted by sales.',
    formula: 'Σ (Sales × Budget GP %) ÷ Σ Sales',
    source: `${FRESH} (budget tab)`,
    reconciliation: 'Matches the Fresh Report budget column.',
    status: 'Draft',
    views: [FR],
  },
  {
    id: 'total-loss',
    name: 'Total Loss',
    unit: '$ and Units',
    definition: 'Total loss recorded, in $ and units, at cost by default or at retail (about 1.8–2.0 × cost). Totals exclude flagged entries by default.',
    formula: 'Σ known loss $ ; Σ known loss units',
    source: KL,
    reconciliation: 'Matches KL1011 department totals once flagged entries are reviewed.',
    status: 'Pending validation',
    priority: 'Must',
    views: [CI, FR, KLR],
  },

  {
    id: 'known-loss-report',
    name: 'Volume Sold, Sales ($), Known Loss (Units), Known Loss ($)',
    unit: 'Units, $',
    definition: 'Known Loss Report measures by Department › Category › Item and by Store Num. Volume never adds ea and lb. Sales ($) is Gross Sales. Store rows add up to the item table.',
    formula: 'Σ units sold ; Σ Gross Sales ; Σ known loss units ; Σ known loss $',
    source: KL,
    reconciliation: 'Matches KL1011 by department, item and store once reported entry errors are removed.',
    status: 'Draft',
    priority: 'Must',
    views: [KLR],
  },
  {
    id: 'it-review-list',
    name: 'IT review list',
    unit: 'list',
    definition: 'Flagged entries a category manager reports to IT for removal. Session only: no backend and no email; "Export list for IT" (CSV or Excel) is the hand-off.',
    formula: 'Columns: item, SKU Number, store, district, week, known loss units, UoM, known loss $, reason. Text values starting with =, +, -, @, tab or carriage return are prefixed with a single quote in the CSV.',
    source: KL,
    reconciliation: 'IT confirms each removed entry against KL1011.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [KLR],
  },
  {
    id: 'high-loss-flag',
    name: 'High Loss Flag',
    unit: 'T / F',
    definition:
      'Loss higher than $1,000 in a given week, for an item in a store. Threshold basis: at cost, assumed, Pending validation (open question 3): nobody has confirmed whether the current $1,000 rule is at cost or at retail, and the Recon Map points to KL1011 "Known Loss Retail $". Proposed refinement, shown only as a secondary label: "Likely entry error" (loss units above 20× the item-store typical weekly loss units, or above the $100,000 plausibility cap) or "High loss to review". An optional 26-week rule (loss also more than 100 % above the item-store 26-week average) is available in the Flag rules popover, off by default.',
    formula: 'Weekly known loss $ at cost (item × store × week) > 1,000. Exactly $1,000.00 is not flagged.',
    source: KL,
    reconciliation: 'Category managers report likely entry errors to IT ("Report to IT", "Export list for IT") so they are removed from known loss.',
    status: 'Pending validation',
    priority: 'Must',
    views: [CI, KLR],
    note: 'Threshold basis: at cost, assumed, Pending validation. See open question 3.',
  },

  {
    id: 'ly',
    name: 'Last Year Gross Sales, Last Year Net Sales',
    unit: '$',
    definition: 'For and up to the current date (Day, WTD, PTD, QTD, 26-week rolling, YTD): the same weekdays 364 days earlier. Holiday periods compare to the same holiday last year.',
    formula: 'Value(day − 364)',
    source: 'All sources',
    reconciliation: 'Agreed in UC1.',
    status: 'Draft',
    priority: 'Should',
    views: [CI, FR],
  },
  {
    id: 'yoy',
    name: 'YoY Gross / Net Sales Growth ($ / %)',
    unit: '$ / %',
    definition: 'Change versus the same fiscal weeks last year, all stores.',
    formula: '(TY − LY) and (TY − LY) ÷ LY',
    source: 'Derived',
    reconciliation: 'Derived; no legacy equivalent.',
    status: 'Draft',
    priority: 'Should',
    views: [CI, FR],
  },
  {
    id: 'id-yoy',
    name: 'ID Stores YoY Gross / Net Sales Growth ($ / %)',
    unit: '$ / %',
    definition: 'YoY growth for comparable stores only: stores open for the whole range and the same range last year. Active when the ID stores toggle is on.',
    formula: '(TY − LY) and (TY − LY) ÷ LY over ID stores',
    source: 'Store master',
    reconciliation: 'Same rule as UC1.',
    status: 'Draft',
    priority: 'Nice to have',
    views: [CI, FR],
  },
];

/** Proposed measures added after the business interviews (cost is the problem, not loss). */
KPI_DEFINITIONS.push(
  {
    id: 'cost-type',
    name: 'Cost type · Cost reliability',
    unit: 'class',
    definition:
      'UPC: packaged items with a manufacturer barcode; average cost in HQ is reliable. PLU: sold by the unit without a barcode (avocados, Deli composite items). Random weight: sold by the pound (meat, Deli meats, seafood). The cost logic changes only for PLU and random-weight items, which show "Under review".',
    formula: 'Item master attribute',
    source: 'Retalix item master',
    reconciliation: 'Matches the item master PLU / UPC flag.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, IC, 'Cost Watch'],
  },
  {
    id: 'cost-source',
    name: 'Cost source (PO vs HQ)',
    unit: 'switch',
    definition: 'PLU and random-weight items use the real-time PO cost by default: each week’s period-based PO cost (PO spend ÷ volume purchased, freight included), or the most recent one when nothing was bought that week. Switching to HQ shows margins on the cost held in HQ / Retalix. UPC items always use the HQ average cost. The switch shows how many points the margin moves.',
    formula: 'Net cost from the weekly period-based PO cost or the HQ default cost',
    source: `${BICEPS} · Retalix`,
    reconciliation: 'Pending Biceps access (open question 2).',
    status: 'Pending validation',
    priority: 'Proposed',
    views: [CI],
  },
  {
    id: 'margin-after-loss',
    name: 'Margin After Loss %',
    unit: '%',
    definition: 'Gross Margin Rate less a loss rate: actual known loss ÷ sales, or the expected total loss rate the Deli team uses today (12 %). Expected rates are editable assumptions (Deli 12 %, Meat 4 %, Produce 8 %, Bakery 9 %, Seafood 8 %, Floral 8 %, clamped 0–30 %).',
    formula: 'Gross Margin Rate − loss rate',
    source: `${EASS} · ${KL}`,
    reconciliation: 'Matches the Deli team’s gross profit after expected loss.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, FR],
  },
  {
    id: 'sell-through',
    name: 'Units shipped · Sell-through % · Shipped value $',
    unit: 'units · % · $',
    definition: 'Warehouse bill-out (Whse) against units sold, to see whether a low-margin week came from shipping too much. Shipments through outside vendors such as C&S and DSD are not included yet.',
    formula: 'Sell-through % = units sold ÷ units shipped',
    source: 'Warehouse bill-out',
    reconciliation: 'Shipped value equals the Whse line of the Fresh Report.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, FR],
  },
  {
    id: 'target-bands',
    name: 'Margin target bands',
    unit: '%',
    definition: 'Target range for item-level Gross Margin Rate by category: Produce 45–50 %, Meat 30–35 %, Deli 53–58 %, Bakery 56–61 %, Seafood 33–38 %, Floral 58–66 %. Items below the band get a "Below target" chip.',
    formula: 'Gross Margin Rate < band low',
    source: 'Category team targets',
    reconciliation: 'To confirm with each category team.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, IC, 'Cost Watch'],
  },

  {
    id: 'simulator',
    name: 'Cost change simulator',
    unit: 'what-if',
    definition: 'Read-only what-if that replicates the Deli team’s spreadsheet: margin at the new cost, retail needed to hold the margin (rounded to a .x9 ending), and the annual gross margin impact on trailing 52-week units. Nothing is saved or sent to any system.',
    formula: 'Retail to hold = new cost ÷ (1 − current margin), rounded up to .x9',
    source: 'Simulation only',
    reconciliation: 'Matches the Deli cost-change spreadsheet.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, IC, 'Cost Watch'],
  },
  {
    id: 'ingredients-gp',
    name: 'Ingredients View totals (Gross Profit $ and %)',
    unit: '$, %',
    definition:
      'Totals for one PLU over the period: Total units = units sold; Cost / unit = Σ ingredient contributions (units per item × cost per unit); Total unit cost = recipe cost × units sold, week by week; Gross Profit ($) = Gross Sales − (recipe cost × units sold); Gross Profit (%) = Gross Profit ÷ Gross Sales, consistent with Gross Margin Rate. Retail price is shown as a reference only.',
    formula: 'GP $ = Gross Sales − Σ (recipe cost × units sold); GP % = GP $ ÷ Gross Sales',
    source: 'Pizza Ingredients.xlsx · Scan Data',
    reconciliation: 'Matches the Pizza Ingredients workbook for the same recipe and costs.',
    status: 'Pending validation',
    priority: 'Should',
    views: [IV],
  },
  {
    id: 'ingredient-contribution',
    name: 'Ingredient contribution',
    unit: '$',
    definition: 'What one ingredient adds to a PLU’s unit cost: units per item (e.g. 6 oz) × the ingredient’s cost per unit of costing. Contributions add up to the recipe cost per unit. Ingredient costs come from ingredient purchase orders.',
    formula: 'units per item × cost per unit',
    source: 'Pizza Ingredients.xlsx · ingredient POs',
    reconciliation: 'Σ contributions = recipe cost per unit.',
    status: 'Draft',
    priority: 'Should',
    views: [IV],
  },
  {
    id: 'where-used',
    name: 'Where used',
    unit: 'what-if',
    definition:
      'Every PLU whose recipe uses an ingredient (e.g. pizza dough ball, shredded mozzarella, pizza sauce), with current cost, new cost, Gross Profit % before and after, and annual impact. A new ingredient cost flows through every recipe that uses it. Read-only: nothing is saved or sent to HQ.',
    formula: 'Annual impact = (new PLU cost − current PLU cost) × units produced (units sold + known loss units) over the trailing 52 weeks',
    source: 'Simulation only',
    reconciliation: 'Recipe costs match the Ingredients View for the same week.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [IV],
  },
);

export interface OpenQuestion {
  id: string;
  question: string;
  context: string;
}

/** Open questions from the requirements workbook. */
export const OPEN_QUESTIONS: OpenQuestion[] = [
  { id: 'q1', question: 'Source for Gross Sales in the Fresh Report: 1048 or Category Analyzer?', context: 'Affects Total Gross Sales and Gross Margin Rate in the Fresh Report.' },
  { id: 'q2', question: 'Access to PO cost in Biceps, and how it links to Retalix.', context: 'Needed for PO Cost / Unit, New PO Cost and the cost source switch.' },
  {
    id: 'q3',
    question: 'Threshold to flag high loss, for both data entry errors and high real loss.',
    context: 'The prototype uses $1,000 per item, store and week, at cost (assumed; the Recon Map points to KL1011 "Known Loss Retail $"). Rules are editable and Pending validation.',
  },
  {
    id: 'q4',
    question: 'Tracking of cases sent through outside vendors (DSD and C&S). WMBI receives all receiving types and combines them.',
    context: 'Purchases from outside vendors are a known gap in Total Purchases.',
  },
];
