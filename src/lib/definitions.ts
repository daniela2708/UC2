import type { Status } from '../components/ui';

export type ViewName = 'Category-Item Summary' | 'Item Cost Over Time' | 'Ingredients View' | 'Fresh Report' | 'Known Loss Report';

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
/** Meat is out of scope for UC2; the legacy reports include it. */
const NO_MEAT =
  'Meat (02-MEAT) is out of scope for UC2, while EASS1048 and the legacy Fresh Report include it, so company totals will not tie to them: an expected difference. Compare by department.';
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
    reconciliation: `Department weekly gross sales match EASS1048 within ±0.5 %. ${NO_MEAT}`,
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
    reconciliation: `Department net sales match EASS1048; item-level allocation is not yet reconciled. ${NO_MEAT}`,
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
    id: 'net-customer-sales-unit',
    name: 'Net Customer Sales per Unit',
    unit: '$',
    definition: 'Average net price per unit after discounts, within one unit of measure. Shown as Net Customer Sales per Unit, as in the workbook; Net Sales is the app’s short name for Net Customer Sales.',
    formula: 'SUM(Net Sales) ÷ SUM(Volume)',
    source: EASS,
    reconciliation: 'Derived; no legacy equivalent.',
    status: 'Draft',
    priority: 'Must',
    views: [CI],
  },
  {
    id: 'warehouse-dsd-purchases',
    name: 'Warehouse & DSD Purchases',
    unit: '$',
    definition:
      'Estimated purchases at item, store and day. Warehouse purchases are the DC-to-store bills from the internal billing application, at point-in-time average cost. DSD purchases are the receipts recorded in Retalix HQ, at the amount owed to the vendor. Refreshed daily. Packaging, transfers, credits and other GL adjustments are not included, so it will not equal the Fresh Report’s Total Purchases (#5). Replaces Total Purchases in Category-Item Summary. In the prototype the values are simulated: DSD items from DSD receipts, other items from PO spend or, for composite PLUs, production cost; store filters take the stores’ share of the category. Margins do not use it: they use Total Net Cost.',
    formula: 'Σ warehouse bills (billing application) + Σ DSD receipts (Retalix HQ) for the items, stores and period',
    source: 'Internal billing application (DC-to-store bills) · Retalix HQ (DSD receipts)',
    reconciliation: 'DSD part equals the DSD receipts in Retalix HQ. Warehouse part to define once the billing application’s source is confirmed (#5). A different measure from the Fresh Report’s Total Purchases.',
    status: 'Proposed',
    priority: 'Must',
    views: [CI],
    note: 'Still to confirm which system or table holds the billing application’s data, to add it to the migration plan; WAREHOUSE_SHIPT_F is a candidate (#5). A DSD receipt can cover a week of product; the shortest period the dashboard shows is open (#49).',
  },
  {
    id: 'total-purchases',
    name: 'Total Purchases (Fresh Report)',
    unit: '$',
    definition:
      'Store-level purchases from the Workday general ledger, as in the legacy Fresh Report (#5): Whse, DSD, Packaging, Reclaim, Transfers, In transit, Donations, WC credit, Scan credit. Outside-vendor (C&S) cases are a known gap (#6).',
    formula: 'Σ purchase channels by store, department and week',
    source: `Workday general ledger · ${FRESH}`,
    reconciliation: `Equals the Fresh Report purchases per store, department and week. ${NO_MEAT}`,
    status: 'Draft',
    priority: 'Must',
    views: [FR],
  },

  {
    id: 'average-po-cost',
    name: 'HQ Average Cost',
    unit: '$',
    definition:
      'Called Average PO Cost in the workbook; shown as HQ Average Cost in the prototype. HQ’s average cost for inventory on hand: Biceps calculates it from received POs and feeds Retalix HQ several times a day, deals and trade rates included (#1, #21). It is per SKU, not per PLU, and leaves out DSD (#3). Item Cost Over Time shows it as the dashed line; the Cost source switch in Category-Item Summary uses it for HQ. UPC items always use it.',
    formula: 'Workbook: SUM(Total Purchases) ÷ SUM(Total Volume), volume on hand from Biceps PO data',
    source: `${BICEPS} · Retalix HQ`,
    reconciliation: 'Matches the Retalix HQ average cost for the same item and day.',
    status: 'Draft',
    priority: 'Must',
    views: [CI, IC],
    note: 'Which HQ field holds the average cost directors use, and the cost for PLU-based and random-weight items, are still to confirm (#3, #32).',
  },

  {
    id: 'po-cost',
    name: 'PO Cost / Unit',
    unit: '$',
    definition:
      'Period-based weighted average (BCG proposal): total PO spend in the period ÷ volume purchased in the period, freight included. A period without purchases has no PO cost: a gap in charts and "—" in tables; Gross Margin and Total Net Cost then use the most recent PO cost, marked "cost from W38". "HQ Average Cost" is the average cost in Retalix HQ, Weis’s back-office system: calculated in Biceps and refreshed several times a day, deals and trade rates included; "Historical PO Cost" is the weighted average PO cost for the filtered period; "Real-time PO Cost" is the PO cost of the last complete week (or the latest earlier week with purchases, marked "as of W41"). Which cost per unit values are most useful is to be aligned with the business team. The same method feeds the PO cost source switch. Real-time cost comes from purchase orders in the ordering system (Biceps) and may change after invoice reconciliation.',
    formula: 'Σ PO spend in the period ÷ Σ volume purchased in the period (null when no volume)',
    source: `${BICEPS} · Retalix HQ`,
    reconciliation: 'PO lines tie to Biceps; HQ cost ties to Retalix HQ.',
    status: 'Proposed',
    priority: 'Must',
    views: [CI, IC],
    note: 'Replaces the earlier 4-week recency weighting. UPC items keep the HQ average cost; composite PLUs use the recipe cost.',
  },

  {
    id: 'total-net-cost',
    name: 'Total Net Cost',
    unit: '$',
    definition: 'Cost of the units sold under the selected cost basis ("Cost includes").',
    formula: 'Σ units sold × net cost per unit (week by week, as costs change weekly)',
    source: EASS,
    reconciliation: `Department cost of goods sold within ±1 % of EASS1048. ${NO_MEAT}`,
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
    reconciliation: `Item: within ±1 % of EASS1048. Fresh: equals the Fresh Report gross profit. ${NO_MEAT}`,
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
    reconciliation: `Department rate within ±0.3 pts of EASS1048. ${NO_MEAT}`,
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
    reconciliation: `Equals Accounting's Fresh Report GP % per store and department. ${NO_MEAT}`,
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
    reconciliation: `Matches the Fresh Report budget column. ${NO_MEAT}`,
    status: 'Draft',
    views: [FR],
  },
  {
    id: 'total-loss',
    name: 'Known Loss',
    unit: '$ and Units',
    definition: 'Known loss recorded in KL1011 (not the Ops 300 report), in $ and units, at cost by default or at retail (about 1.8–2.0 × cost). Cost or retail is Pending validation (#50); the Recon Map points to KL1011 "Known Loss Retail $". Totals exclude flagged entries by default.',
    formula: 'Σ known loss $ ; Σ known loss units',
    source: KL,
    reconciliation: 'Matches KL1011 department totals once flagged entries are reviewed.',
    status: 'Pending validation',
    priority: 'Must',
    views: [CI, KLR],
    note: 'Called Total Loss in the workbook; labelled Known Loss because the source is KL1011 known loss only (#16). Removed from the Fresh Report after the prototype review.',
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
    note: 'Scope TBD: may move to a separate use case or a later wave; the MVP focuses on item cost; whether ingredient costing is in the MVP is to confirm with the business (#44). The High Loss Flag remains a required KPI in Category-Item Summary.',
  },
  {
    id: 'it-review-list',
    name: 'IT Review List',
    unit: 'list',
    definition: 'Flagged entries a category manager reports to IT for removal. Session only: no backend and no email; "Export list for IT" (CSV or Excel) is the hand-off.',
    formula: 'Columns: item, SKU Number, store, district, week, known loss units, UoM, known loss $, reason. Text values starting with =, +, -, @, tab or carriage return are prefixed with a single quote in the CSV.',
    source: KL,
    reconciliation: 'IT confirms each removed entry against KL1011.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [KLR],
    note: 'Scope TBD: may move to a separate use case or a later wave; the MVP focuses on item cost; whether ingredient costing is in the MVP is to confirm with the business (#44). The High Loss Flag remains a required KPI in Category-Item Summary.',
  },
  {
    id: 'high-loss-flag',
    name: 'High Loss Flag',
    unit: 'T / F',
    definition:
      'Loss higher than $1,000 in a given week, for an item in a store (#2). Threshold basis: at cost, assumed, Pending validation (#50): nobody has confirmed whether the current $1,000 rule is at cost or at retail, or whether it applies per item and store or per item across all stores, and the Recon Map points to KL1011 "Known Loss Retail $". Proposed refinement, shown only as a secondary label: "Likely entry error" (loss units above 20× the item-store typical weekly loss units, or above the $100,000 plausibility cap) or "High loss to review". An optional 26-week rule (loss also more than 100 % above the item-store 26-week average) is available in the Flag rules popover, off by default.',
    formula: 'Weekly known loss $ at cost (item × store × week) > 1,000. Exactly $1,000.00 is not flagged.',
    source: KL,
    reconciliation: 'Category managers report likely entry errors to IT ("Add to IT Review List", "Export list for IT") so they are removed from known loss.',
    status: 'Pending validation',
    priority: 'Must',
    views: [CI, KLR],
    note: 'Scope TBD: may move to a separate use case or a later wave; the MVP focuses on item cost; whether ingredient costing is in the MVP is to confirm with the business (#44). The High Loss Flag remains a required KPI in Category-Item Summary. Threshold basis and grain: at cost, per item and store, assumed, Pending validation (#50). Where the current $1,000 rule’s SQL lives is unknown (#26).',
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
      'UPC: packaged items with a manufacturer barcode; average cost in Retalix HQ is reliable. PLU: sold by the unit without a barcode (avocados, Deli composite items). Random weight: sold by the pound (meat, Deli meats, seafood). The cost logic changes only for PLU and random-weight items, which show "Under review".',
    formula: 'Item master attribute',
    source: 'Retalix HQ item master',
    reconciliation: 'Matches the item master PLU / UPC flag.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, IC],
  },
  {
    id: 'cost-source',
    name: 'Cost source (PO vs HQ)',
    unit: 'switch',
    definition: 'PLU and random-weight items use the real-time PO cost by default: each week’s period-based PO cost (PO spend ÷ volume purchased, freight included), or the most recent one when nothing was bought that week. Switching to HQ shows margins on the HQ Average Cost in Retalix HQ, Weis’s back-office system. UPC items always use the HQ average cost. The switch shows how many points the margin moves.',
    formula: 'Net cost from the weekly period-based PO cost or the HQ Average Cost',
    source: `${BICEPS} · Retalix HQ`,
    reconciliation: 'Pending access to PO cost in Biceps (#1).',
    status: 'Pending validation',
    priority: 'Proposed',
    views: [CI],
  },
  {
    id: 'margin-after-loss',
    name: 'Margin After Loss %',
    unit: '%',
    definition: 'Gross Margin Rate less a loss rate: actual known loss ÷ sales, or the expected total loss rate the Deli team uses today (12 %). Expected rates are editable assumptions (Deli 12 %, Produce 8 %, Bakery 9 %, Seafood 8 %, Floral 8 %, clamped 0–30 %).',
    formula: 'Gross Margin Rate − loss rate',
    source: `${EASS} · ${KL}`,
    reconciliation: 'Matches the Deli team’s gross profit after expected loss.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI],
  },
  {
    id: 'target-bands',
    name: 'Margin target bands',
    unit: '%',
    definition:
      'Target range for item-level Gross Margin Rate by department, centered on each department’s item-level margin (src/data/targets.ts): Produce 45–50 %, Deli 53–58 %, Bakery 56–61 %, Seafood 33–38 %, Floral 58–66 %. Items, PLUs and simulated costs below the band get a "Below target" chip.',
    formula: 'Gross Margin Rate < band low',
    source: 'Category team targets',
    reconciliation: 'To confirm with each category team.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, IC, IV],
  },

  {
    id: 'simulator',
    name: 'Cost change simulator',
    unit: 'what-if',
    definition:
      'Read-only what-if that replicates the Deli team’s spreadsheet: margin at the new cost, retail needed to hold the margin (rounded to a .x9 ending), the annual cost change and the margin impact on trailing 52-week units, and the target band. Sign convention: a cost increase is a margin loss, so "Annual cost change +$X" reads with "Margin impact −$X" (red), and the reverse in green. Composite PLUs change one ingredient and recompute the recipe. Nothing is saved or sent to any system.',
    formula: 'Retail to hold = new cost ÷ (1 − current margin), rounded up to .x9',
    source: 'Simulation only',
    reconciliation: 'Matches the Deli cost-change spreadsheet.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [CI, IC],
  },

  {
    id: 'recipe-age',
    name: 'Recipe cost age',
    unit: 'months',
    definition: 'Months since a composite PLU’s recipe cost was last updated in the Excel recipe file and Retalix HQ. The Deli team re-costs recipes about once a year; older than 6 months is highlighted on the item row in Category-Item Summary and counted in the stale-costs banner.',
    formula: 'as-of month − last update month',
    source: 'Deli recipe Excel files · Retalix HQ',
    reconciliation: 'Matches the update dates in the recipe files.',
    status: 'Draft',
    priority: 'Proposed',
    views: [CI, IC, IV],
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
      'Every PLU whose recipe uses an ingredient (e.g. pizza dough ball, shredded mozzarella, pizza sauce), with current cost, new cost, Gross Profit % before and after, and annual impact. A new ingredient cost flows through every recipe that uses it. Read-only: nothing is saved or sent to Retalix HQ.',
    formula: 'Annual impact = (new PLU cost − current PLU cost) × units produced (units sold + known loss units) over the trailing 52 weeks',
    source: 'Simulation only',
    reconciliation: 'Recipe costs match the Ingredients View for the same week.',
    status: 'Proposed',
    priority: 'Proposed',
    views: [IV],
  },
);

export type QuestionStatus = 'Open' | 'Partly answered' | 'Answered' | 'Superseded';

export interface OpenQuestion {
  id: string;
  /** Topic, as in the workbook. */
  title: string;
  status: QuestionStatus;
  question: string;
  context: string;
}

/** Open questions from the requirements workbook (UC #2 - Open Questions, 10 Nov 2026), by workbook number. Only the ones the prototype cites. */
export const OPEN_QUESTIONS: OpenQuestion[] = [
  {
    id: '1',
    title: 'Real-time PO Cost',
    status: 'Partly answered',
    question: 'How to access PO cost from Biceps, and how it links to Retalix HQ.',
    context: 'Biceps is a mainframe with no direct connection. A daily Biceps extract to SQL Server (location to confirm) and the existing Snowflake feed used by the DNP tool may carry PO-level cost. Purchase orders live only in Biceps.',
  },
  {
    id: '2',
    title: 'High Loss',
    status: 'Answered',
    question: 'Threshold to flag high loss, for both data entry errors and high real loss.',
    context: '$1,000 per week per item is the default. The prototype applies it per item, store and week, at cost; the valuation basis and grain are open (#50).',
  },
  {
    id: '3',
    title: 'PLU and Random-Weight Cost',
    status: 'Partly answered',
    question: 'Which cost PLU-based and random-weight items should use: HQ Average Cost, PO cost or another measure.',
    context: 'HQ Average Cost is calculated in Biceps, includes deals and trade rates, and is per SKU, not per PLU. The prototype shows every candidate so the business can pick the default.',
  },
  {
    id: '5',
    title: 'Fresh Purchases Build',
    status: 'Answered',
    question: 'How Purchases are built for the fresh departments, and who maintains the data behind the Fresh Report.',
    context: 'Fresh Report purchases come from the Workday general ledger; at item level, Category-Item Summary uses Warehouse & DSD Purchases: warehouse bills from the internal billing application and DSD receipts from Retalix HQ (Fresh Report Deep Dive, 4 Nov). Still to confirm which system or table holds the billing application’s data, and that Workday is in migration scope. Refresh and period alignment moved to #49.',
  },
  {
    id: '6',
    title: 'Receiving Data Flows',
    status: 'Partly answered',
    question: 'How DC and C&S receipts reach the HQ Receiver table.',
    context: 'Purchases from outside vendors are a known gap in the Fresh Report Total Purchases.',
  },
  {
    id: '9',
    title: 'Exceptions Review Scope',
    status: 'Partly answered',
    question: 'Is the exceptions review (Known Loss Report) part of this use case or a separate one?',
    context: 'Tentatively included; the Known Loss Report is shown as Scope TBD.',
  },
  {
    id: '10',
    title: 'Ingredient and Recipe Costs',
    status: 'Partly answered',
    question: 'How ingredient and recipe costs are maintained, and whether the dashboard only reads recipes or also edits them.',
    context: 'Recipes exist in Upshop (Inva Fresh), but the team would need to upload all recipes, and the tech team would connect the API to the dashboard (timing TBD).',
  },
  {
    id: '12',
    title: 'PO Cost at Source',
    status: 'Partly answered',
    question: 'How PO cost is recorded at the source (per case or per unit) and converted for random-weight items.',
    context: 'Needed for the Historical and Real-time PO Cost.',
  },
  {
    id: '16',
    title: 'Total Loss Source',
    status: 'Answered',
    question: 'Source of truth for loss: KL1011 or the Ops 300 report.',
    context: 'KL1011 is the source of known loss; the Ops 300 report counts a wider loss and is not used. Every loss figure in the prototype is labelled Known Loss.',
  },
  {
    id: '17',
    title: 'Gross Margin Denominator',
    status: 'Partly answered',
    question: 'Gross Sales basis and source for the Fresh Report, and the Gross Margin denominator.',
    context: 'Affects Total Gross Sales and Gross Margin Rate.',
  },
  {
    id: '21',
    title: 'Trade Rates in Fresh',
    status: 'Partly answered',
    question: 'Do trade rates apply to fresh items, and where are they stored?',
    context: 'HQ average cost carries deals and trade rates.',
  },
  {
    id: '26',
    title: '$1,000 Rule SQL',
    status: 'Open',
    question: 'Where the SQL with the $1,000 rule lives, and which report or job applies it.',
    context: 'Unknown today.',
  },
  {
    id: '32',
    title: 'Cost Measure for Volatile Items',
    status: 'Partly answered',
    question: 'Which cost measure is most helpful for items whose cost changes often, such as produce.',
    context: 'Average cost vs PO cost granularity is a pending business decision.',
  },
  {
    id: '36',
    title: 'Recipe Cost Write-back',
    status: 'Open',
    question: 'Can an ingredient cost change flow to every PLU that uses it in HQ?',
    context: 'Write-back to HQ is manual and out of scope for the prototype.',
  },
  {
    id: '44',
    title: 'Upshop Viability',
    status: 'Partly answered',
    question: 'Is Upshop (Inva Fresh) a viable source for recipes, and how can its data be extracted?',
    context: 'Upshop is the production planning and recipe management system, and it has an API. Whether ingredients go in the MVP is to confirm with the business.',
  },
  {
    id: '45',
    title: 'Upshop API Data',
    status: 'Open',
    question: 'What the Upshop API holds (recipes, ingredients, quantities, units, item codes that link to HQ, costs), and whether it is reliable and up to date.',
    context: 'Depends on #44.',
  },
  {
    id: '46',
    title: 'Recipe Scope and Inventory',
    status: 'Partly answered',
    question: 'Which recipes the Ingredients View should cover, which are already in Upshop and which live outside it.',
    context: 'Deli keeps one Excel workbook per category; pizza is not a production item and may not have a recipe in Upshop yet.',
  },
  {
    id: '47',
    title: 'Recipe Gaps, Quality and Modeling',
    status: 'Open',
    question: 'How missing recipes are added to Upshop, which quality checks the recipe data needs, and how the API data is modeled for the dashboard.',
    context: 'Depends on #44 to #46.',
  },
  {
    id: '48',
    title: 'UC2 Business Owners',
    status: 'Open',
    question: 'Who is the business owner for each UC2 KPI?',
    context: 'Every KPI row still lists the owners carried over from UC1.',
  },
  {
    id: '49',
    title: 'Purchases Refresh and Period Alignment',
    status: 'Open',
    question: 'What refresh does each purchases KPI need, and what is the shortest period the dashboard should show for each?',
    context: 'Total Purchases closes weekly after the Thursday postings. Warehouse & DSD Purchases refresh daily, but a DSD receipt can cover a week of product.',
  },
  {
    id: '50',
    title: 'Known Loss Valuation Basis',
    status: 'Open',
    question: 'Should Known Loss ($) and the $1,000 High Loss Flag be valued at cost or at retail? Does the $1,000 apply per item and store, or per item across all stores?',
    context: 'The Recon Map points to KL1011 "Known Loss Retail $". The prototype assumes cost and applies the rule per item, store and week, marked Pending validation.',
  },
  {
    id: '51',
    title: 'Department Scope',
    status: 'Open',
    question: 'Which departments does UC2 cover: the five fresh departments in the Fresh Report, or every department the EASS1048 prints?',
    context: 'The prototype covers the five fresh departments: Produce, Deli, Bakery, Seafood and Floral. Meat is out of scope.',
  },
];
