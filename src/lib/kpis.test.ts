import { describe, expect, it } from 'vitest';
import {
  allocateDiscount,
  averageRetail,
  budgetGpPct,
  clamp,
  clampLossRule,
  DEFAULT_LOSS_RULE,
  freshGpPct,
  grossMargin,
  grossMarginPct,
  highLossFlag,
  lastYear,
  likelyEntryError,
  LOSS_RULE_LIMITS,
  lossPctOfSales,
  MixedUnitError,
  netCostPerUnit,
  netSales,
  netSalesPerUnit,
  pointsDiff,
  poCostPerUnit,
  purchaseCostPerUnit,
  safeDiv,
  splitVolume,
  sumStrict,
  sumVolume,
  totalLoss,
  totalNetCost,
  totalPurchases,
  yoyGrowth,
  type PurchaseBreakdown,
  type UnitCostParts,
} from './kpis';

const parts: UnitCostParts = { list: 10, trade: 0.5, offInvoice: 0.2, deals: 0.8, scanbacks: 0.3, freight: 0.15 };

describe('guards', () => {
  it('safeDiv returns null for zero or missing denominators', () => {
    expect(safeDiv(1, 0)).toBeNull();
    expect(safeDiv(1, null)).toBeNull();
    expect(safeDiv(undefined, 2)).toBeNull();
    expect(safeDiv(1, Number.NaN)).toBeNull();
    expect(safeDiv(6, 3)).toBe(2);
  });
  it('sumStrict returns null when any part is missing', () => {
    expect(sumStrict([1, 2, 3])).toBe(6);
    expect(sumStrict([1, null])).toBeNull();
  });
  it('clamp keeps values in range and maps NaN to the minimum', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(Number.NaN, 0, 3)).toBe(0);
  });
});

describe('sales and volume', () => {
  it('net sales adds negative discounts', () => {
    expect(netSales(1000, -18)).toBe(982);
    expect(netSales(null, -18)).toBeNull();
  });
  it('allocates discounts pro rata to gross sales', () => {
    expect(allocateDiscount(250, 1000, -40)).toBe(-10);
    expect(allocateDiscount(250, 0, -40)).toBeNull();
  });
  it('sums volume within one unit of measure', () => {
    expect(sumVolume([{ qty: 3, uom: 'lb' }, { qty: 2, uom: 'lb' }])).toEqual({ qty: 5, uom: 'lb' });
    expect(sumVolume([])).toBeNull();
  });
  it('refuses to add ea and lb together', () => {
    expect(() => sumVolume([{ qty: 3, uom: 'lb' }, { qty: 2, uom: 'ea' }])).toThrow(MixedUnitError);
    expect(splitVolume([{ qty: 3, uom: 'lb' }, { qty: 2, uom: 'ea' }])).toEqual({ ea: 2, lb: 3 });
  });
  it('average retail and net sales per unit guard zero volume', () => {
    expect(averageRetail(100, 25)).toBe(4);
    expect(averageRetail(100, 0)).toBeNull();
    expect(netSalesPerUnit(98, 0)).toBeNull();
    expect(netSalesPerUnit(98, 49)).toBe(2);
  });
});

describe('cost and margin', () => {
  it('PO cost is list minus trade', () => {
    expect(poCostPerUnit(10, 0.5)).toBe(9.5);
    expect(poCostPerUnit(null, 0.5)).toBeNull();
  });
  it('net cost subtracts selected allowances and adds freight', () => {
    expect(netCostPerUnit(parts, [])).toBe(10);
    expect(netCostPerUnit(parts, ['trade'])).toBe(9.5);
    expect(netCostPerUnit(parts, ['trade', 'offInvoice', 'deals', 'scanbacks'])).toBeCloseTo(8.2);
    expect(netCostPerUnit(parts, ['trade', 'freight'])).toBeCloseTo(9.65);
  });
  it('total net cost, gross margin and GM % are ratios of totals', () => {
    expect(totalNetCost(4, 2.5)).toBe(10);
    expect(totalNetCost(null, 2.5)).toBeNull();
    expect(grossMargin(100, 60)).toBe(40);
    // Two items: 10 % on $100 and 50 % on $900 → 46 % overall, not the 30 % average of rates.
    expect(grossMarginPct(10 + 450, 100 + 900)).toBeCloseTo(0.46);
    expect(grossMarginPct(5, 0)).toBeNull();
  });
});

describe('purchases and Fresh GP', () => {
  const b: PurchaseBreakdown = {
    whse: 700,
    dsd: 30,
    packaging: 12,
    reclaim: 1,
    transfers: -2,
    inTransit: 5,
    donations: 2,
    wcCredit: -4,
    scanCredit: -20,
  };
  it('totals every channel including credits', () => {
    expect(totalPurchases(b)).toBe(724);
  });
  it('computes GP % as (sales − purchases) ÷ sales', () => {
    expect(freshGpPct(1000, totalPurchases(b))).toBeCloseTo(0.276);
    expect(freshGpPct(0, 10)).toBeNull();
    expect(freshGpPct(null, 10)).toBeNull();
  });
  it('purchase cost per unit uses units purchased', () => {
    expect(purchaseCostPerUnit(500, 200)).toBe(2.5);
    expect(purchaseCostPerUnit(500, 0)).toBeNull();
  });
  it('budget GP % weights by sales', () => {
    expect(budgetGpPct(0.3 * 100 + 0.2 * 300, 400)).toBeCloseTo(0.225);
    expect(budgetGpPct(10, 0)).toBeNull();
  });
});

describe('loss', () => {
  it('picks the valuation basis', () => {
    expect(totalLoss(10, 19, 'cost')).toBe(10);
    expect(totalLoss(10, 19, 'retail')).toBe(19);
    expect(totalLoss(null, 19, 'cost')).toBeNull();
  });
  it('loss % of sales guards zero sales', () => {
    expect(lossPctOfSales(30, 1000)).toBe(0.03);
    expect(lossPctOfSales(30, 0)).toBeNull();
  });
  it('the official flag is weekly loss above $1,000; the 26-week rule applies only when switched on', () => {
    expect(highLossFlag(11_700, 110, DEFAULT_LOSS_RULE)).toBe(true);
    expect(highLossFlag(900, 50, DEFAULT_LOSS_RULE)).toBe(false);
    expect(highLossFlag(1500, 800, DEFAULT_LOSS_RULE)).toBe(true);
    expect(highLossFlag(1500, null, DEFAULT_LOSS_RULE)).toBe(true);
    const withAvg = { ...DEFAULT_LOSS_RULE, avg: true };
    expect(highLossFlag(1500, 800, withAvg)).toBe(false);
    expect(highLossFlag(1500, 749, withAvg)).toBe(true);
    expect(highLossFlag(1500, null, withAvg)).toBe(false);
  });
  it('clamps thresholds outside their range', () => {
    expect(clampLossRule({ dollars: 5, pct: -3 })).toEqual({ dollars: LOSS_RULE_LIMITS.dollars.min, pct: LOSS_RULE_LIMITS.pct.min, avg: false });
    expect(clampLossRule({ dollars: 1e9, pct: 99, avg: 'yes' })).toEqual({ dollars: LOSS_RULE_LIMITS.dollars.max, pct: LOSS_RULE_LIMITS.pct.max, avg: false });
    expect(clampLossRule({ dollars: 'abc', pct: Number.NaN })).toEqual(DEFAULT_LOSS_RULE);
  });
  it('marks likely entry errors above 20× typical units', () => {
    expect(likelyEntryError(1110, 11)).toBe(true);
    expect(likelyEntryError(150, 11)).toBe(false);
    expect(likelyEntryError(150, 0)).toBe(false);
  });
});

describe('comparisons', () => {
  it('last year is 364 days earlier', () => {
    expect(lastYear(1000)).toBe(636);
  });
  it('YoY growth guards missing and zero last year', () => {
    expect(yoyGrowth(110, 100)).toEqual({ abs: 10, pct: 0.1 });
    expect(yoyGrowth(110, 0)).toEqual({ abs: 110, pct: null });
    expect(yoyGrowth(110, null)).toEqual({ abs: null, pct: null });
  });
  it('points differences are in percentage points', () => {
    expect(pointsDiff(0.368, 0.374)).toBeCloseTo(-0.6);
    expect(pointsDiff(null, 0.3)).toBeNull();
  });
});
