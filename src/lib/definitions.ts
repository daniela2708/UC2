import type { Status } from '../components/ui';

export interface KpiDefinition {
  id: string;
  name: string;
  unit: string;
  definition: string;
  formula: string;
  source: string;
  reconciliation: string;
  status: Status;
  note?: string;
}

const EASS = 'EASS1048 Category Cost Report';
const FRESH = 'Fresh Report (Accounting, Excel)';
const KL = 'KL1011 Dept Known Loss by Item (WebFocus)';
const DY = 'DY270 Fresh Shrink report';

export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    id: 'gross-sales',
    name: 'Gross Sales',
    unit: '$',
    definition: 'Sales at the register before discounts.',
    formula: 'Σ item sales before discounts',
    source: EASS,
    reconciliation: 'Department weekly gross sales match EASS1048 within ±0.5 %.',
    status: 'Draft',
    note: 'Shared with UC1.',
  },
  {
    id: 'net-sales',
    name: 'Net Sales',
    unit: '$',
    definition: 'Gross Sales after discounts. At item level, discounts are allocated pro rata to gross sales (provisional rule).',
    formula: 'Gross Sales + Discounts (discounts are negative)',
    source: EASS,
    reconciliation: 'Department net sales match EASS1048; item-level allocation is not yet reconciled.',
    status: 'Pending validation',
  },
  {
    id: 'volume',
    name: 'Volume',
    unit: 'ea / lb',
    definition: 'Units sold, or pounds for random-weight items. Each and pounds are never added together; tiles and aggregate rows show them separately.',
    formula: 'Σ units (ea) ; Σ pounds (lb)',
    source: 'Scan Data',
    reconciliation: 'Item units match Scan Data within ±1 %.',
    status: 'Proposed',
  },
  {
    id: 'avg-retail',
    name: 'Average Retail',
    unit: '$ / unit',
    definition: 'Average selling price per unit before discounts, within one unit of measure.',
    formula: 'Gross Sales ÷ Volume',
    source: 'Scan Data · Category Analyzer',
    reconciliation: 'Matches Category Analyzer average retail per item.',
    status: 'Draft',
  },
  {
    id: 'net-sales-unit',
    name: 'Net Sales per Unit',
    unit: '$ / unit',
    definition: 'Average net price per unit after discounts.',
    formula: 'Net Sales ÷ Volume',
    source: EASS,
    reconciliation: 'Derived; no legacy equivalent.',
    status: 'Draft',
  },
  {
    id: 'po-cost',
    name: 'PO Cost per Unit',
    unit: '$ / unit',
    definition: 'Purchase order cost per unit: list cost less trade rates. This is the default cost basis.',
    formula: 'List cost − trade rates',
    source: `${EASS} · vendor cost file`,
    reconciliation: 'Matches EASS1048 item cost for warehouse items.',
    status: 'Pending validation',
  },
  {
    id: 'net-cost-unit',
    name: 'Net Cost per Unit',
    unit: '$ / unit',
    definition:
      'PO cost minus every allowance switched on in "Cost includes" (off-invoice, deals, scan-backs). Freight billed separately is a cost, so switching it on adds it. Composite PLUs use the recipe standard cost from the Excel file.',
    formula: 'List cost − Σ selected allowances (+ freight when selected)',
    source: `${EASS} · vendor allowance files · Deli recipe workbook`,
    reconciliation: 'With trade rates only, equals PO Cost per Unit.',
    status: 'Proposed',
  },
  {
    id: 'total-net-cost',
    name: 'Total Net Cost',
    unit: '$',
    definition: 'Cost of the units sold at the selected cost basis.',
    formula: 'Units sold × Net Cost per Unit (summed by week, as costs change weekly)',
    source: EASS,
    reconciliation: 'Department cost of goods sold within ±1 % of EASS1048.',
    status: 'Proposed',
  },
  {
    id: 'gm',
    name: 'Gross Margin $',
    unit: '$',
    definition: 'Margin after the cost of the units sold.',
    formula: 'Net Sales − Total Net Cost',
    source: EASS,
    reconciliation: 'Department gross margin within ±1 % of EASS1048.',
    status: 'Draft',
  },
  {
    id: 'gm-pct',
    name: 'Gross Margin %',
    unit: '%',
    definition: 'Gross margin as a share of net sales. Always a ratio of totals, never an average of item rates.',
    formula: 'Σ Gross Margin ÷ Σ Net Sales',
    source: EASS,
    reconciliation: 'Department GM % within ±0.3 pts of EASS1048. Same definition as UC1.',
    status: 'Pending validation',
  },
  {
    id: 'total-purchases',
    name: 'Total Purchases',
    unit: '$',
    definition:
      'Everything bought for the department in the store-week. Purchases shipped by third-party channels (CNS, DN, Milton) are tracked by email and Excel and are not in the source systems.',
    formula: 'Whse + DSD + Packaging + Reclaim in transit + Transfers + In transit + Donations + WC credit + Scan credit',
    source: `${FRESH} · warehouse bill-out`,
    reconciliation: 'Equals the Fresh Report purchases total per store and week, excluding third-party channels.',
    status: 'Draft',
  },
  {
    id: 'purchase-cost-unit',
    name: 'Purchase Cost per Unit',
    unit: '$ / unit',
    definition: 'Average cost of what was bought, per unit purchased (not per unit sold).',
    formula: 'Purchases $ ÷ units purchased',
    source: `${FRESH} · warehouse bill-out`,
    reconciliation: 'Matches warehouse bill-out unit cost for warehouse-supplied items.',
    status: 'Proposed',
  },
  {
    id: 'fresh-gp',
    name: 'Fresh GP %',
    unit: '%',
    definition: "Accounting's simple store gross profit from sales and purchases. Includes loss and cost variability by construction. Weekly or period to date only.",
    formula: '(Sales − Total Purchases) ÷ Sales',
    source: FRESH,
    reconciliation: "Equals Accounting's Fresh Report GP % per store and department.",
    status: 'Draft',
  },
  {
    id: 'budget-gp',
    name: 'Budget GP %',
    unit: '%',
    definition: 'Budgeted Fresh GP % by department, store and fiscal period. Aggregates weight each store-week by its sales.',
    formula: 'Σ (Sales × Budget GP %) ÷ Σ Sales',
    source: `${FRESH} (budget tab)`,
    reconciliation: 'Matches the Fresh Report budget column.',
    status: 'Draft',
  },
  {
    id: 'total-loss',
    name: 'Total Loss (Known Loss)',
    unit: '$',
    definition:
      'Known loss entered by stores, at cost by default or at retail with the toggle (retail is about 1.8–2.0 × cost depending on department). Totals exclude flagged entries by default.',
    formula: 'Σ known loss at cost | Σ known loss at retail',
    source: KL,
    reconciliation: 'Matches KL1011 department totals once flagged entries are reviewed.',
    status: 'Pending validation',
  },
  {
    id: 'loss-pct',
    name: 'Loss % of Sales',
    unit: '%',
    definition: 'Known loss as a share of gross sales.',
    formula: 'Total Loss ÷ Gross Sales',
    source: `${KL} · ${EASS}`,
    reconciliation: 'Department rates within ±0.1 pts of KL1011 ÷ EASS1048.',
    status: 'Draft',
  },
  {
    id: 'shrink-components',
    name: 'Donations, Salvage, Recall, Markdown',
    unit: '$',
    definition:
      'Other shrink reported outside known loss. Donations, salvage and recall at cost; markdown is POS price overrides plus department coupons, at retail.',
    formula: 'Σ by item and week',
    source: DY,
    reconciliation: 'Matches DY270 totals by department and week.',
    status: 'Draft',
  },
  {
    id: 'high-loss-flag',
    name: 'High Loss Flag',
    unit: 'T / F',
    definition:
      'Marks an item-store-week whose known loss is both large and unusual. A flagged entry is a "Likely entry error" when its loss units exceed 20× the item-store typical weekly loss units. Replaces hiding entries above about $1,000 per SKU.',
    formula: 'Weekly loss > threshold $ (default 1,000) AND > (1 + threshold %) × item-store 26-week average (default 100 %)',
    source: `${KL} (proposed rule)`,
    reconciliation: 'Every flagged entry is reviewed with the store before it enters the official total.',
    status: 'Proposed',
  },
  {
    id: 'ly',
    name: 'Last Year values',
    unit: '$ / %',
    definition: 'The same weekdays 364 days earlier, so fiscal weeks line up. Holiday periods compare to the same holiday last year.',
    formula: 'Value(day − 364)',
    source: 'All sources',
    reconciliation: 'Agreed in UC1.',
    status: 'Draft',
  },
  {
    id: 'yoy',
    name: 'YoY Growth',
    unit: '$ / %',
    definition: 'Change versus the same fiscal weeks last year. Rate differences are shown in percentage points (pts).',
    formula: '(TY − LY) and (TY − LY) ÷ LY',
    source: 'Derived',
    reconciliation: 'Derived; no legacy equivalent.',
    status: 'Draft',
  },
  {
    id: 'id-stores',
    name: 'ID stores (comparable)',
    unit: 'filter',
    definition: 'Stores open for the whole selected range and the same range last year. Stores opened in FY2025 or closed in FY2026 drop out.',
    formula: 'open week ≤ first LY week AND close week > last week',
    source: 'Store master',
    reconciliation: 'Same rule as UC1.',
    status: 'Draft',
  },
];
