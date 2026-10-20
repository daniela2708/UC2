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

/** Gross Margin % = Σ Gross Margin ÷ Σ Net Sales. */
export function grossMarginPct(sumGrossMargin: Num, sumNetSales: Num): number | null {
  return safeDiv(sumGrossMargin, sumNetSales);
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

/** Purchase Cost per Unit = Purchases $ ÷ units purchased (not units sold). */
export function purchaseCostPerUnit(purchases: Num, unitsPurchased: Num): number | null {
  return safeDiv(purchases, unitsPurchased);
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
  /** …and more than this fraction above the item-store 26-week average (1 = 100 %). */
  pct: number;
}

export const DEFAULT_LOSS_RULE: LossRule = { dollars: 1000, pct: 1 };
export const LOSS_RULE_LIMITS = { dollars: { min: 250, max: 100_000 }, pct: { min: 0, max: 10 } } as const;

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Clamps user-entered thresholds to their allowed ranges. Non-numbers fall back to the default. */
export function clampLossRule(rule: { dollars: unknown; pct: unknown }): LossRule {
  const d = typeof rule.dollars === 'number' && Number.isFinite(rule.dollars) ? rule.dollars : DEFAULT_LOSS_RULE.dollars;
  const p = typeof rule.pct === 'number' && Number.isFinite(rule.pct) ? rule.pct : DEFAULT_LOSS_RULE.pct;
  return {
    dollars: Math.round(clamp(d, LOSS_RULE_LIMITS.dollars.min, LOSS_RULE_LIMITS.dollars.max)),
    pct: clamp(p, LOSS_RULE_LIMITS.pct.min, LOSS_RULE_LIMITS.pct.max),
  };
}

/**
 * High Loss Flag: weekly loss > threshold $ AND > (1 + threshold %) × the item-store 26-week average.
 * Without a 26-week history the flag cannot fire.
 */
export function highLossFlag(weeklyLoss: Num, avg26: Num, rule: LossRule): boolean {
  if (!ok(weeklyLoss) || !ok(avg26)) return false;
  return weeklyLoss > rule.dollars && weeklyLoss > (1 + rule.pct) * avg26;
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
