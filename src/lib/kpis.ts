/**
 * Every KPI formula used by the prototype. Pure and typed.
 * Rules: every rate is a ratio of totals (never an average of rates), and every
 * division is guarded, so a zero or missing denominator returns null (shown as —).
 */

export type Uom = 'ea' | 'lb';
export type Num = number | null | undefined;

const ok = (n: Num): n is number => typeof n === 'number' && Number.isFinite(n);

/** Guarded division: null when either side is missing or the denominator is 0. */
export function safeDiv(numerator: Num, denominator: Num): number | null {
  if (!ok(numerator) || !ok(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** Sum that ignores nothing: any missing part makes the total missing. */
export function sumStrict(parts: Num[]): number | null {
  let t = 0;
  for (const p of parts) {
    if (!ok(p)) return null;
    t += p;
  }
  return t;
}

// ---------------------------------------------------------------- Sales

/** Net Sales = Gross Sales + Discounts (discounts are negative). */
export function netSales(grossSales: Num, discounts: Num): number | null {
  return sumStrict([grossSales, discounts]);
}

/** Pro-rata allocation of a discount pool to one item by its share of gross sales. Provisional rule. */
export function allocateDiscount(itemGross: Num, totalGross: Num, totalDiscounts: Num): number | null {
  const share = safeDiv(itemGross, totalGross);
  return share === null || !ok(totalDiscounts) ? null : share * totalDiscounts;
}

// ---------------------------------------------------------------- Volume

export interface VolumeLine {
  qty: number;
  uom: Uom;
}

export class MixedUnitError extends Error {
  constructor() {
    super('Volume cannot add ea and lb together.');
    this.name = 'MixedUnitError';
  }
}

/** Total volume in one unit of measure. Refuses mixed units by throwing MixedUnitError. Empty input → null. */
export function sumVolume(lines: VolumeLine[]): VolumeLine | null {
  if (lines.length === 0) return null;
  const uom = lines[0].uom;
  let qty = 0;
  for (const l of lines) {
    if (l.uom !== uom) throw new MixedUnitError();
    qty += l.qty;
  }
  return { qty, uom };
}

/** Volume split by unit of measure, for tiles and aggregate rows. Never adds ea and lb. */
export function splitVolume(lines: VolumeLine[]): Record<Uom, number> {
  const out: Record<Uom, number> = { ea: 0, lb: 0 };
  for (const l of lines) out[l.uom] += l.qty;
  return out;
}

/** Average Retail = Gross Sales ÷ Volume, within one unit of measure. */
export function averageRetail(grossSales: Num, volume: Num): number | null {
  return safeDiv(grossSales, volume);
}

/** Net Sales per Unit = Net Sales ÷ Volume. */
export function netSalesPerUnit(net: Num, volume: Num): number | null {
  return safeDiv(net, volume);
}

// ---------------------------------------------------------------- Cost

/** Cost elements that can be switched on in "Cost includes". List cost is always on. */
export type CostElement = 'trade' | 'offInvoice' | 'deals' | 'scanbacks' | 'freight';
export const COST_ELEMENTS: CostElement[] = ['trade', 'offInvoice', 'deals', 'scanbacks', 'freight'];
export const DEFAULT_COST_BASIS: CostElement[] = ['trade'];

/** Per-unit cost components. Allowances are positive amounts that reduce cost; freight adds to it. */
export interface UnitCostParts {
  list: number;
  trade: number;
  offInvoice: number;
  deals: number;
  scanbacks: number;
  freight: number;
}

/** PO Cost per Unit = List cost − trade rates. */
export function poCostPerUnit(list: Num, trade: Num): number | null {
  if (!ok(list) || !ok(trade)) return null;
  return list - trade;
}

/**
 * Net Cost per Unit = list cost minus every allowance switched on in "Cost includes".
 * Freight billed separately is a cost, so switching it on adds it.
 */
export function netCostPerUnit(parts: UnitCostParts, basis: readonly CostElement[]): number {
  let c = parts.list;
  for (const e of basis) c += e === 'freight' ? parts.freight : -parts[e];
  return c;
}

/** Total Net Cost = Units sold × Net Cost per Unit. */
export function totalNetCost(unitsSold: Num, netCostUnit: Num): number | null {
  if (!ok(unitsSold) || !ok(netCostUnit)) return null;
  return unitsSold * netCostUnit;
}

/** Gross Margin $ = Net Sales − Total Net Cost. */
export function grossMargin(net: Num, totalCost: Num): number | null {
  if (!ok(net) || !ok(totalCost)) return null;
  return net - totalCost;
}

/** Ratio of a gross margin total to a sales total (kept for callers that pass the denominator directly). */
export function grossMarginPct(sumGrossMargin: Num, sumSales: Num): number | null {
  return safeDiv(sumGrossMargin, sumSales);
}

/** Which sales total Gross Margin Rate divides by. The workbook uses Gross Sales; Net Sales is a proposed option. */
export type MarginBase = 'gross' | 'net';
export const DEFAULT_MARGIN_BASE: MarginBase = 'gross';

/** Gross Margin Rate = Σ Gross Margin ÷ Σ Gross Sales (workbook), or ÷ Σ Net Sales when that option is chosen. */
export function grossMarginRate(sumGrossMargin: Num, sumGrossSales: Num, sumNetSales: Num, base: MarginBase = DEFAULT_MARGIN_BASE): number | null {
  return safeDiv(sumGrossMargin, base === 'gross' ? sumGrossSales : sumNetSales);
}

/** Units-weighted cost per unit: Σ (unit cost × units) ÷ Σ units. Used for PO Cost / Unit and Net Cost / Unit. */
export function weightedUnitCost(sumCostTimesUnits: Num, units: Num): number | null {
  if (typeof units === 'number' && units < 0) return null;
  return safeDiv(sumCostTimesUnits, units);
}

/**
 * Period-based PO Cost / Unit (BCG proposal, Proposed): total PO spend in the period ÷ volume purchased in the
 * period. A period with no volume purchased has no PO cost (null, shown as a gap); negative inputs are refused.
 */
export function periodPoCost(spend: Num, unitsPurchased: Num): number | null {
  if (!ok(spend) || !ok(unitsPurchased) || spend < 0 || unitsPurchased <= 0) return null;
  return spend / unitsPurchased;
}

/** Cost change from Current PO Cost (HQ) to New PO Cost: $ and %. */
export function costChange(current: Num, next: Num): Growth {
  return yoyGrowth(next, current);
}

// ---------------------------------------------------------------- Purchases (Fresh Report)

export const PURCHASE_CHANNELS = [
  'whse',
  'dsd',
  'packaging',
  'reclaim',
  'transfers',
  'inTransit',
  'donations',
  'wcCredit',
  'scanCredit',
] as const;
export type PurchaseChannel = (typeof PURCHASE_CHANNELS)[number];
export type PurchaseBreakdown = Record<PurchaseChannel, number>;

export const CHANNEL_LABEL: Record<PurchaseChannel, string> = {
  whse: 'Warehouse (Whse)',
  dsd: 'DSD',
  packaging: 'Packaging',
  reclaim: 'Reclaim in transit',
  transfers: 'Transfers',
  inTransit: 'In transit',
  donations: 'Donations',
  wcCredit: 'WC credit',
  scanCredit: 'Scan credit',
};

/** Total Purchases = Whse + DSD + Packaging + Reclaim in transit + Transfers + In transit + Donations + WC credit + Scan credit. */
export function totalPurchases(b: PurchaseBreakdown): number {
  let t = 0;
  for (const c of PURCHASE_CHANNELS) t += b[c];
  return t;
}

/** Purchase Cost per Unit = SUM(Total Purchases) ÷ SUM(volume purchased from PO data) — workbook (legacy source: Biceps). */
export function purchaseCostPerUnit(totalPurchasesSum: Num, volumePurchased: Num): number | null {
  if (typeof volumePurchased === 'number' && volumePurchased < 0) return null;
  return safeDiv(totalPurchasesSum, volumePurchased);
}

/** Fresh GP % = (Sales − Total Purchases) ÷ Sales. Weekly or period to date only. */
export function freshGpPct(sales: Num, purchases: Num): number | null {
  if (!ok(sales) || !ok(purchases)) return null;
  return safeDiv(sales - purchases, sales);
}

/** Budget GP % for a group = Σ budgeted GP $ ÷ Σ sales. */
export function budgetGpPct(sumBudgetGp: Num, sumSales: Num): number | null {
  return safeDiv(sumBudgetGp, sumSales);
}

// ---------------------------------------------------------------- Loss

export type LossBasis = 'cost' | 'retail';

/** Total Loss = known loss at cost (default) or at retail. */
export function totalLoss(atCost: Num, atRetail: Num, basis: LossBasis): number | null {
  const v = basis === 'cost' ? atCost : atRetail;
  return ok(v) ? v : null;
}

/** Loss % of Sales = Total Loss ÷ Gross Sales. */
export function lossPctOfSales(loss: Num, grossSales: Num): number | null {
  return safeDiv(loss, grossSales);
}

export interface LossRule {
  /** Weekly loss must be above this many dollars (at cost). */
  dollars: number;
  /** Proposed refinement: when on, loss must also be more than this fraction above the item-store 26-week average (1 = 100 %). */
  pct: number;
  avg: boolean;
}

/** Workbook: High Loss Flag = loss higher than $1,000 in a given week. The 26-week rule is a proposed refinement, off by default. */
export const DEFAULT_LOSS_RULE: LossRule = { dollars: 1000, pct: 1, avg: false };

/** Threshold basis of the $1,000 flag: assumed at cost until Weis confirms (open question 3). */
export const FLAG_BASIS_NOTE =
  'Threshold basis: at cost, assumed, Pending validation. Nobody has confirmed whether the current $1,000 rule is at cost or at retail, and the workbook Recon Map points to KL1011 "Known Loss Retail $" (open question 3).';
export const HIGH_LOSS_FLAG_TIP = `High Loss Flag (workbook): known loss higher than $1,000 for an item in a store in a given week. ${FLAG_BASIS_NOTE} Reason labels are proposed.`;
export const LOSS_RULE_LIMITS = { dollars: { min: 250, max: 100_000 }, pct: { min: 0, max: 10 } } as const;

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Clamps user-entered thresholds to their allowed ranges. Non-numbers fall back to the default. */
export function clampLossRule(rule: { dollars: unknown; pct: unknown; avg?: unknown }): LossRule {
  const d = typeof rule.dollars === 'number' && Number.isFinite(rule.dollars) ? rule.dollars : DEFAULT_LOSS_RULE.dollars;
  const p = typeof rule.pct === 'number' && Number.isFinite(rule.pct) ? rule.pct : DEFAULT_LOSS_RULE.pct;
  return {
    dollars: Math.round(clamp(d, LOSS_RULE_LIMITS.dollars.min, LOSS_RULE_LIMITS.dollars.max)),
    pct: clamp(p, LOSS_RULE_LIMITS.pct.min, LOSS_RULE_LIMITS.pct.max),
    avg: rule.avg === true,
  };
}

/**
 * High Loss Flag (workbook): weekly loss strictly above the $ threshold ($1,000).
 * With the proposed 26-week rule on, loss must also be above (1 + threshold %) × the item-store 26-week average,
 * and without that history the flag cannot fire.
 */
export function highLossFlag(weeklyLoss: Num, avg26: Num, rule: LossRule): boolean {
  if (!ok(weeklyLoss) || weeklyLoss <= rule.dollars) return false;
  if (!rule.avg) return true;
  return ok(avg26) && weeklyLoss > (1 + rule.pct) * avg26;
}

/** Likely entry error: loss units above 20× the item-store's typical weekly loss units. */
export const ENTRY_ERROR_MULTIPLE = 20;
export function likelyEntryError(lossUnits: Num, typicalUnits: Num): boolean {
  if (!ok(lossUnits) || !ok(typicalUnits) || typicalUnits <= 0) return false;
  return lossUnits > ENTRY_ERROR_MULTIPLE * typicalUnits;
}

// ---------------------------------------------------------------- Comparisons

/** Last Year: same weekday, 364 days earlier. */
export const LAST_YEAR_DAYS = 364;
export function lastYear(day: number): number {
  return day - LAST_YEAR_DAYS;
}

export interface Growth {
  abs: number | null;
  pct: number | null;
}

/** YoY Growth = (TY − LY) and (TY − LY) ÷ LY. */
export function yoyGrowth(ty: Num, ly: Num): Growth {
  if (!ok(ty) || !ok(ly)) return { abs: null, pct: null };
  return { abs: ty - ly, pct: safeDiv(ty - ly, ly) };
}

/** Difference of two rates in percentage points (rates are fractions, result is points). */
export function pointsDiff(a: Num, b: Num): number | null {
  if (!ok(a) || !ok(b)) return null;
  return (a - b) * 100;
}

// ---------------------------------------------------------------- Cost change simulator (read-only what-if)

export const SIM_LIMITS = { max: 999_999.99 } as const;

/**
 * Validates a simulator input: a positive number with at most 6 integer digits and 2 decimals.
 * Returns the value rounded to cents, or null when it is not acceptable.
 */
export function clampSimInput(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d{1,6}(\.\d{1,2})?\s*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > SIM_LIMITS.max) return null;
  return Math.round(n * 100) / 100;
}

/** Rounds a price up to the next .x9 ending ($4.23 → $4.29, $4.30 → $4.39, $4.29 → $4.29). */
export function roundToX9(price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const cents = Math.round(price * 100);
  const up = Math.ceil((cents - 9) / 10) * 10 + 9;
  return Math.max(9, up) / 100;
}

export interface SimInputs {
  /** Current cost per unit (HQ / recipe). */
  cost: number;
  /** Current retail per unit. */
  retail: number;
  newCost: number;
  newRetail?: number | null;
  /** Units sold over the trailing 52 weeks. */
  annualUnits: number;
}

export interface SimResult {
  marginNow: number | null;
  marginNewCost: number | null;
  retailToHold: number | null;
  marginWithNewRetail: number | null;
  /** Annual Gross Margin $ change at current retail (new cost). */
  impactNoRetailChange: number;
  /** Annual Gross Margin $ change with the new retail (or the retail that holds the margin). */
  impactWithRetailChange: number;
}

/** Margin on retail per unit: 1 − cost ÷ retail. */
export function unitMarginRate(cost: Num, retail: Num): number | null {
  if (!ok(cost) || !ok(retail)) return null;
  return safeDiv(retail - cost, retail);
}

/** The Deli team's spreadsheet: margin today, at the new cost, and the retail needed to hold today's margin. */
export function simulateCostChange(x: SimInputs): SimResult {
  const marginNow = unitMarginRate(x.cost, x.retail);
  const marginNewCost = unitMarginRate(x.newCost, x.retail);
  const retailToHold = marginNow !== null && marginNow < 1 ? roundToX9(x.newCost / (1 - marginNow)) : null;
  const retailUsed = x.newRetail ?? retailToHold;
  const units = Math.max(0, x.annualUnits);
  return {
    marginNow,
    marginNewCost,
    retailToHold,
    marginWithNewRetail: retailUsed === null ? null : unitMarginRate(x.newCost, retailUsed),
    impactNoRetailChange: (x.cost - x.newCost) * units,
    impactWithRetailChange: retailUsed === null ? 0 : (retailUsed - x.newCost - (x.retail - x.cost)) * units,
  };
}


// ---------------------------------------------------------------- Margin after loss (Proposed)

/** Expected total loss rates the Deli team subtracts from gross profit today (Proposed defaults), by department order. */
export const DEFAULT_EXPECTED_LOSS: Record<string, number> = { Meat: 0.04, Produce: 0.08, Deli: 0.12, Bakery: 0.09, Seafood: 0.08, Floral: 0.08 };
export const EXPECTED_LOSS_LIMITS = { min: 0, max: 0.3 } as const;

/** Clamps an expected loss rate to 0–30 %. Non-numbers fall back to null. */
export function clampExpectedLoss(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(clamp(n, EXPECTED_LOSS_LIMITS.min, EXPECTED_LOSS_LIMITS.max) * 1000) / 1000;
}

/** Margin After Loss % = Gross Margin Rate − loss rate (actual known loss ÷ sales, or the expected rate). */
export function marginAfterLoss(gmRate: Num, lossRate: Num): number | null {
  if (!ok(gmRate) || !ok(lossRate)) return null;
  return gmRate - lossRate;
}

// ---------------------------------------------------------------- Shipments vs sales (Proposed)

/** Sell-through % = units sold ÷ units shipped (warehouse bill-out). */
export function sellThrough(unitsSold: Num, unitsShipped: Num): number | null {
  if (typeof unitsShipped === 'number' && unitsShipped < 0) return null;
  return safeDiv(unitsSold, unitsShipped);
}

// ---------------------------------------------------------------- New items watch

export const NEW_ITEM_WEEKS = 12;

/** Weeks on sale through `endWeek`, counting the first week of sales as week 1 (0 before launch). */
export function weeksOnSale(firstWeek: number, endWeek: number): number {
  return endWeek < firstWeek ? 0 : endWeek - firstWeek + 1;
}

/** An item is "new" during its first 12 weeks since first sale: week 12 is included, week 13 is not. */
export function inNewItemWindow(weeks: number): boolean {
  return Number.isInteger(weeks) && weeks >= 1 && weeks <= NEW_ITEM_WEEKS;
}
