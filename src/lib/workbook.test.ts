import { describe, expect, it } from 'vitest';
import { formatDay, globalWeek, LAST_COMPLETE_WEEK, weekStartDay } from '../data/calendar';
import { getModel, NW } from '../data/generate';
import { DEPTS, CATS, ITEMS, itemByName } from '../data/products';
import { compositeCostAt, costSeries, currentPoCost, newPoCost, poUnitCostWeek, recipeCost, recipeLines } from '../data/purchasing';
import { PLANTED } from '../data/planted';
import { belowTarget, catBand } from '../data/targets';
import { mulberry32, SEED } from '../data/prng';
import { BASE_TIME, DEFAULT_STATE, fromQuery, resolveTime, toQuery, unusedFilters } from './filters';
import { pickerItems, resolveIcItem } from './itemCost';
import {
  averageRetail,
  clampExpectedLoss,
  clampLossRule,
  clampSimInput,
  DEFAULT_LOSS_RULE,
  grossMarginRate,
  highLossFlag,
  inNewItemWindow,
  lastYear,
  likelyEntryError,
  marginAfterLoss,
  netSalesPerUnit,
  newPoCostWeighted,
  purchaseCostPerUnit,
  purchaseCostPerUnitPurchased,
  roundToX9,
  sellThrough,
  simulateCostChange,
  totalLoss,
  totalPurchases,
  weeksOnSale,
  weightedUnitCost,
  yoyGrowth,
} from './kpis';
import {
  buildScope,
  findFlags,
  freshStoreDays,
  freshStoreWeeks,
  isEntryError,
  itemPurchaseFactor,
  itemPurchasesWeek,
  MERCH_CHANNELS,
  newItemsWatch,
} from './selectors';

const ytd = resolveTime(BASE_TIME);
const dept = (name: string) => DEPTS.findIndex((d) => d.name === name);

describe('workbook KPI formulas', () => {
  it('Average Retail Price per Unit and Net Sales per Unit are ratios within one unit of measure', () => {
    expect(averageRetail(1000, 250)).toBe(4);
    expect(netSalesPerUnit(980, 250)).toBeCloseTo(3.92);
    expect(averageRetail(1000, 0)).toBeNull();
  });
  it('Purchase Cost per Unit = Total Purchases ÷ Total Volume (sold); the purchased version divides by units purchased', () => {
    expect(purchaseCostPerUnit(600, 300)).toBe(2);
    expect(purchaseCostPerUnitPurchased(600, 400)).toBe(1.5);
    expect(purchaseCostPerUnit(600, 0)).toBeNull();
    expect(purchaseCostPerUnit(600, -5)).toBeNull();
  });
  it('Gross Margin Rate divides by Gross Sales by default and by Net Sales when toggled', () => {
    expect(grossMarginRate(30, 100, 98)).toBeCloseTo(0.3);
    expect(grossMarginRate(30, 100, 98, 'gross')).toBeCloseTo(0.3);
    expect(grossMarginRate(30, 100, 98, 'net')).toBeCloseTo(30 / 98);
    expect(grossMarginRate(30, 0, 98)).toBeNull();
    expect(grossMarginRate(30, 100, 0, 'net')).toBeNull();
  });
  it('Total Purchases sums every Fresh Report channel', () => {
    expect(totalPurchases({ whse: 70, dsd: 3, packaging: 1, reclaim: 0.1, transfers: 0, inTransit: -0.1, donations: 0.2, wcCredit: -0.4, scanCredit: -2 })).toBeCloseTo(71.8);
  });
  it('Total Loss picks the valuation, LY is 364 days, YoY is (TY − LY) and (TY − LY) ÷ LY', () => {
    expect(totalLoss(10, 19, 'retail')).toBe(19);
    expect(lastYear(400)).toBe(36);
    expect(yoyGrowth(110, 100)).toEqual({ abs: 10, pct: 0.1 });
  });
  it('PO Cost / Unit is units-weighted and refuses negative units', () => {
    expect(weightedUnitCost(2 * 10 + 4 * 30, 40)).toBeCloseTo(3.5);
    expect(weightedUnitCost(10, -1)).toBeNull();
  });
  it('Margin After Loss and Sell-through', () => {
    expect(marginAfterLoss(0.55, 0.12)).toBeCloseTo(0.43);
    expect(marginAfterLoss(null, 0.12)).toBeNull();
    expect(sellThrough(80, 100)).toBe(0.8);
    expect(sellThrough(80, 0)).toBeNull();
    expect(sellThrough(80, -3)).toBeNull();
  });
});

describe('Current vs New PO Cost', () => {
  it('New PO Cost weights the last 4 weeks 0.4 / 0.3 / 0.2 / 0.1 by quantity and ignores bad lines', () => {
    const v = newPoCostWeighted([
      { weeksBack: 0, units: 100, unitCost: 2 },
      { weeksBack: 3, units: 100, unitCost: 1 },
      { weeksBack: 4, units: 100, unitCost: 99 },
      { weeksBack: 1, units: -5, unitCost: 50 },
    ]);
    expect(v).toBeCloseTo((0.4 * 100 * 2 + 0.1 * 100 * 1) / (0.4 * 100 + 0.1 * 100));
    expect(newPoCostWeighted([])).toBeNull();
  });
  it('Roma tomatoes: HQ holds the old case cost while POs jumped from $19.95 to $44.95 in W36', () => {
    const roma = itemByName('Roma Tomatoes').idx;
    expect(currentPoCost(roma)).toBeCloseTo(19.45 / 25, 3);
    expect(newPoCost(roma)!).toBeGreaterThan(1.5);
    expect(poUnitCostWeek(roma, globalWeek(2026, 35))).toBeLessThan(0.9);
    expect(poUnitCostWeek(roma, globalWeek(2026, 36))).toBeGreaterThan(1.4);
  });
  it('Pie pumpkins: $150 per bin in HQ, $250 per bin on POs in season', () => {
    const p = itemByName('Pie Pumpkins').idx;
    expect(currentPoCost(p) * 80).toBeCloseTo(150, 1);
    expect(newPoCost(p)! * 80).toBeCloseTo(250, 0);
  });
});

describe('composite PLUs', () => {
  it('recomputes the PLU cost from its recipe components', () => {
    const pizza = itemByName('16 in. Pepperoni Pizza');
    const lines = recipeLines(pizza);
    expect(recipeCost(lines)).toBeCloseTo(compositeCostAt(pizza, LAST_COMPLETE_WEEK), 6);
    const moz = lines.find((l) => l.key === 'mozzarella')!;
    const bumped = recipeCost(lines, { key: 'mozzarella', unitCost: moz.newUnitCost + 0.1 });
    expect(bumped - recipeCost(lines)).toBeCloseTo(moz.qty * 0.1, 6);
    expect(moz.change).toBeCloseTo(0.12, 2);
  });
  it('slices cost the pie divided by the slice count', () => {
    const pie = itemByName('16 in. Pepperoni Pizza').composite!;
    const slice = itemByName('16 in. Pepperoni Pizza Slice').composite!;
    expect(slice.standardCost).toBeCloseTo(pie.standardCost / 8, 6);
  });
});

describe('Item Cost Over Time', () => {
  it('aggregates daily points to weeks when the range exceeds 26 weeks', () => {
    const roma = itemByName('Roma Tomatoes').idx;
    expect(costSeries(roma, weekStartDay(globalWeek(2026, 17)), weekStartDay(globalWeek(2026, 42)) + 6).grain).toBe('day');
    const long = costSeries(roma, weekStartDay(globalWeek(2025, 30)), weekStartDay(globalWeek(2026, 42)) + 6);
    expect(long.grain).toBe('week');
    expect(long.points.every((p) => (p.day % 7) === 0)).toBe(true);
  });
  it('shows one SKU at a time; no SKU in the list means an empty state, not an error', () => {
    expect(resolveIcItem([], 5)).toBe(-1);
    const list = pickerItems(dept('Produce'), -1, -1, 'all');
    expect(resolveIcItem(list, list[3])).toBe(list[3]);
    expect(ITEMS[resolveIcItem(list, -1)].name).toBe('Roma Tomatoes');
  });
});

describe('simulator', () => {
  it('rounds retail up to a .x9 ending', () => {
    expect(roundToX9(4.23)).toBe(4.29);
    expect(roundToX9(4.3)).toBe(4.39);
    expect(roundToX9(4.29)).toBe(4.29);
    expect(roundToX9(0.01)).toBe(0.09);
    expect(roundToX9(-1)).toBeNull();
  });
  it('computes margin today, at the new cost, the retail to hold it and the annual impact', () => {
    const r = simulateCostChange({ cost: 5, retail: 10, newCost: 6, annualUnits: 1000 });
    expect(r.marginNow).toBeCloseTo(0.5);
    expect(r.marginNewCost).toBeCloseTo(0.4);
    expect(r.retailToHold).toBe(12.09);
    expect(r.impactNoRetailChange).toBeCloseTo(-1000);
    expect(r.impactWithRetailChange).toBeCloseTo((12.09 - 6 - 5) * 1000);
    const withRetail = simulateCostChange({ cost: 5, retail: 10, newCost: 6, newRetail: 11, annualUnits: 1000 });
    expect(withRetail.impactWithRetailChange).toBeCloseTo(0);
  });
  it('accepts only positive amounts with up to 6 digits and 2 decimals', () => {
    expect(clampSimInput('12.5')).toBe(12.5);
    expect(clampSimInput('-1')).toBeNull();
    expect(clampSimInput('0')).toBeNull();
    expect(clampSimInput('1234567')).toBeNull();
    expect(clampSimInput('1.234')).toBeNull();
    expect(clampSimInput('abc')).toBeNull();
    expect(clampSimInput(1e9)).toBeNull();
  });
});

describe('High Loss Flag tiers at the boundaries', () => {
  it('entry error needs more than 20× typical units; the rule needs more than the $ and % thresholds', () => {
    expect(likelyEntryError(200, 10)).toBe(false);
    expect(likelyEntryError(200.01, 10)).toBe(true);
    expect(highLossFlag(1000, 100, DEFAULT_LOSS_RULE)).toBe(false);
    expect(highLossFlag(1000.01, 100, DEFAULT_LOSS_RULE)).toBe(true);
    expect(highLossFlag(1500, 750, DEFAULT_LOSS_RULE)).toBe(false);
    expect(highLossFlag(1500, 749, DEFAULT_LOSS_RULE)).toBe(true);
  });
  it('about 30 % of flags are likely entry errors, and the salmon fat-finger tops the list', () => {
    const flags = findFlags(buildScope(DEFAULT_STATE, ytd));
    const share = flags.filter(isEntryError).length / flags.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.4);
    expect(ITEMS[flags.filter((f) => !f.extreme)[0].item].name).toBe(PLANTED.fatFinger.item);
  });
  it('the Deli soup entry (store 116, W40) is a likely entry error', () => {
    const flags = findFlags(buildScope(DEFAULT_STATE, ytd));
    const soup = flags.find((f) => ITEMS[f.item].name === PLANTED.soup.item && f.week === PLANTED.soup.week);
    expect(soup && isEntryError(soup)).toBe(true);
  });
});

describe('new items watch', () => {
  it('counts week 12 in and week 13 out', () => {
    expect(weeksOnSale(100, 111)).toBe(12);
    expect(inNewItemWindow(weeksOnSale(100, 111))).toBe(true);
    expect(inNewItemWindow(weeksOnSale(100, 112))).toBe(false);
    expect(inNewItemWindow(weeksOnSale(100, 99))).toBe(false);
  });
  it('lists FY2026 launches within the window and nothing sells before launch', () => {
    const rows = newItemsWatch(buildScope(DEFAULT_STATE, ytd));
    expect(rows.length).toBeGreaterThan(4);
    const m = getModel();
    for (const r of rows) {
      expect(r.weeks).toBeLessThanOrEqual(12);
      expect(m.sales[r.item * NW + r.launchWeek - 1]).toBe(0);
    }
  });
});

describe('Fresh Report', () => {
  it('Day filter resolves to one day and daily purchases add back up to the week', () => {
    const day = resolveTime({ ...BASE_TIME, mode: 'fiscal', grain: 'day', day: weekStartDay(globalWeek(2026, 41)) + 3 });
    expect(day.start).toBe(day.end);
    expect(formatDay(day.start)).toBe('10/07/2026');
    const scope = buildScope(DEFAULT_STATE, ytd, { noItem: true });
    const w = globalWeek(2026, 41);
    const days = Array.from({ length: 7 }, (_, k) => weekStartDay(w) + k);
    let byDay = 0;
    for (const row of freshStoreDays(scope, [dept('Meat')], days).values()) for (const c of row) byDay += totalPurchases(c.purchases);
    let byWeek = 0;
    for (const row of freshStoreWeeks(scope, [dept('Meat')], [w]).values()) byWeek += totalPurchases(row[0].purchases);
    expect(byDay / byWeek).toBeCloseTo(1, 6);
  });
  it('respects Category and Subcategory; SKU stays disabled', () => {
    expect(unusedFilters('fresh').sku).toBeTruthy();
    expect(unusedFilters('fresh').product).toBeUndefined();
    const meat = dept('Meat');
    const w = [globalWeek(2026, 40)];
    const sum = (s: typeof DEFAULT_STATE) => {
      let t = 0;
      for (const row of freshStoreWeeks(buildScope(s, ytd, { noItem: true }), [meat], w).values()) t += totalPurchases(row[0].purchases);
      return t;
    };
    const whole = sum({ ...DEFAULT_STATE, dept: meat });
    const parts = DEPTS[meat].cats.map((c) => sum({ ...DEFAULT_STATE, dept: meat, cat: c }));
    expect(parts.reduce((a, b) => a + b, 0) / whole).toBeCloseTo(1, 9);
    expect(Math.max(...parts)).toBeLessThan(whole);
    const cat = DEPTS[meat].cats[0];
    const subs = CATS[cat].subs.map((s) => sum({ ...DEFAULT_STATE, dept: meat, cat, sub: s }));
    expect(subs.reduce((a, b) => a + b, 0) / parts[0]).toBeCloseTo(1, 6);
  });
  it('weekly Gross Margin Rate moves about 4–12 pts week to week, and period to date stays in range', () => {
    const scope = buildScope(DEFAULT_STATE, ytd, { deptOnly: true });
    const weeks = Array.from({ length: 30 }, (_, k) => globalWeek(2026, 12 + k));
    const ranges: Record<string, [number, number]> = { Meat: [26, 31], Produce: [36, 41], Deli: [41, 46], Bakery: [48, 52], Seafood: [24, 33], Floral: [48, 62] };
    for (const [name, [lo, hi]] of Object.entries(ranges)) {
      const rows = freshStoreWeeks(scope, [dept(name)], weeks);
      let S = 0;
      let P = 0;
      const gp = weeks.map((_, i) => {
        let s = 0;
        let p = 0;
        for (const r of rows.values()) {
          s += r[i].sales;
          p += totalPurchases(r[i].purchases);
        }
        S += s;
        P += p;
        return (s - p) / s;
      });
      const changes = gp.slice(1).map((v, i) => Math.abs(v - gp[i]) * 100).sort((a, b) => a - b);
      const median = changes[Math.floor(changes.length / 2)];
      expect(median).toBeGreaterThan(name === 'Bakery' ? 2 : 3);
      expect(median).toBeLessThan(name === 'Floral' ? 30 : 12);
      expect(((S - P) / S) * 100).toBeGreaterThan(lo);
      expect(((S - P) / S) * 100).toBeLessThan(hi);
    }
  });
});

describe('purchases reconcile', () => {
  const scope = buildScope(DEFAULT_STATE, ytd, { deptOnly: true });
  const weeks = [globalWeek(2026, 20), globalWeek(2026, 33), globalWeek(2026, 41)];
  it('item purchases equal department merchandise purchases (within 0.5 %), and items plus non-merchandise lines equal the department total', () => {
    const { all: R } = itemPurchaseFactor(scope, weeks);
    for (const w of weeks)
      for (const d of DEPTS) {
        let merch = 0;
        let total = 0;
        for (const row of freshStoreWeeks(scope, [d.idx], [w]).values()) {
          for (const ch of MERCH_CHANNELS) merch += row[0].purchases[ch];
          total += totalPurchases(row[0].purchases);
        }
        let items = 0;
        for (const it of ITEMS) if (it.dept === d.idx) items += itemPurchasesWeek(R, it.idx, w);
        expect(Math.abs(items / merch - 1)).toBeLessThan(0.005);
        expect(items + (total - merch)).toBeCloseTo(total, 2);
      }
  });
  it('category purchases sum to department purchases for every sampled store and week', () => {
    const rand = mulberry32(SEED);
    for (let k = 0; k < 50; k++) {
      const d = Math.floor(rand() * DEPTS.length);
      const w = globalWeek(2025, 1) + Math.floor(rand() * 90);
      const storeId = [74, 152, 154, 217, 116, 386, 290, 4, 8, 60][Math.floor(rand() * 10)];
      const base = { ...DEFAULT_STATE, stores: [storeId], dept: d };
      const total = (s: typeof DEFAULT_STATE) => {
        let t = 0;
        for (const row of freshStoreWeeks(buildScope(s, ytd, { noItem: true }), [d], [w]).values()) t += totalPurchases(row[0].purchases);
        return t;
      };
      const whole = total(base);
      const parts = DEPTS[d].cats.reduce((a, c) => a + total({ ...base, cat: c }), 0);
      expect(parts).toBeCloseTo(whole, 4);
    }
  });
  it('simulated inventory never goes negative', () => {
    const m = getModel();
    const weeksAll = Array.from({ length: LAST_COMPLETE_WEEK + 1 }, (_, w) => w);
    const { all: R } = itemPurchaseFactor(scope, weeksAll);
    const rand = mulberry32(SEED + 1);
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(rand() * ITEMS.length);
      if (ITEMS[i].launchWeek !== undefined) continue;
      // Opening stock: one week of sales.
      let inv = m.units[i * NW];
      for (const w of weeksAll) {
        const landed = poUnitCostWeek(i, w);
        const bought = landed > 0 ? itemPurchasesWeek(R, i, w) / landed : 0;
        const pc = m.poCost[i * NW + w];
        inv += bought - m.units[i * NW + w] - (pc > 0 ? m.lossCost[i * NW + w] / pc : 0);
        expect(inv).toBeGreaterThan(-1e-6);
      }
    }
  });
});

describe('input clamps and URL state', () => {
  it('clamps loss rule, expected loss and rejects bad values', () => {
    expect(clampLossRule({ dollars: -50, pct: -1 })).toEqual({ dollars: 250, pct: 0 });
    expect(clampExpectedLoss(-0.2)).toBe(0);
    expect(clampExpectedLoss(0.9)).toBe(0.3);
    expect(clampExpectedLoss(Number.NaN)).toBeNull();
  });
  it('round-trips column choices, cost source, margin base and assumptions through the URL', () => {
    const s = {
      ...DEFAULT_STATE,
      cols: { items: ['gross', 'gmr', 'mal'], fresh: ['gross'] },
      costSource: 'hq' as const,
      marginBase: 'net' as const,
      costType: 'RW' as const,
      lossRateBasis: 'expected' as const,
      expLoss: { ...DEFAULT_STATE.expLoss, Deli: 0.15 },
      icItem: itemByName('Roma Tomatoes').idx,
    };
    expect(fromQuery(toQuery(s))).toEqual(s);
  });
  it('drops unsafe column tokens and out-of-range assumptions', () => {
    const s = fromQuery('cols=items:gross.<script>.gmr;BAD:x&el=Deli:95;Meat:abc');
    expect(s.cols.items).toEqual(['gross', 'gmr']);
    expect(s.cols.BAD).toBeUndefined();
    expect(s.expLoss.Deli).toBe(0.3);
    expect(s.expLoss.Meat).toBe(DEFAULT_STATE.expLoss.Meat);
  });
});

describe('target bands', () => {
  it('Produce band is 45–50 % and flags items below it', () => {
    const roma = itemByName('Roma Tomatoes');
    expect(catBand(roma.cat)).toEqual({ lo: 0.45, hi: 0.5 });
    expect(belowTarget(0.44, catBand(roma.cat))).toBe(true);
    expect(belowTarget(0.46, catBand(roma.cat))).toBe(false);
    expect(belowTarget(null, catBand(roma.cat))).toBe(false);
  });
});
