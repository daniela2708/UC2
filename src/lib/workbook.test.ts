import { describe, expect, it } from 'vitest';
import { formatDay, globalWeek, LAST_COMPLETE_WEEK, weekStartDay } from '../data/calendar';
import { getModel, NW } from '../data/generate';
import { DEPTS, CATS, ingredientUnitCost, ITEMS, itemByName, recipeCostAt } from '../data/products';

const ingredientUnitCostToday = (key: string) => ingredientUnitCost(key, LAST_COMPLETE_WEEK);
import { compositeCostAt, costSeries, currentPoCost, newPoCost, newPoCostInfo, ordersOf, poCostForDays, poCostFromWeek, poTotals, poUnitCostWeek, recipeCost, recipeLines, supplyOf } from '../data/purchasing';
import { clampIngredientCost, ingredientPickerItems, ingredientsSummary, pluUsing, resolveIngredientsItem, unitsProduced52, whereUsed } from './ingredients';
import { PLANTED } from '../data/planted';
import { STORES } from '../data/stores';
import { belowTarget, catBand, deptBand } from '../data/targets';
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
  impactTone,
  marginImpactOf,
  periodPoCost,
  purchaseCostPerUnit,
  roundToX9,
  sellThrough,
  simulateCostChange,
  totalLoss,
  totalPurchases,
  weeksOnSale,
  weightedUnitCost,
  yoyGrowth,
} from './kpis';
import { csvCell, csvText, toCsv } from './csv';
import { IT_HEAD, itEntryOf, itRows, itSheet } from './itReport';
import {
  addAgg,
  buildScope,
  costWatchRows,
  pluRows,
  emptyAgg,
  findFlags,
  itemAggregates,
  newItemsWatch,
  storeKnownLoss,
  freshStoreDays,
  freshStoreWeeks,
  isEntryError,
} from './selectors';

const ytd = resolveTime(BASE_TIME);
const dept = (name: string) => DEPTS.findIndex((d) => d.name === name);

describe('workbook KPI formulas', () => {
  it('Average Retail Price per Unit and Net Sales per Unit are ratios within one unit of measure', () => {
    expect(averageRetail(1000, 250)).toBe(4);
    expect(netSalesPerUnit(980, 250)).toBeCloseTo(3.92);
    expect(averageRetail(1000, 0)).toBeNull();
  });
  it('Purchase Cost per Unit = Total Purchases ÷ volume purchased (units purchased, not units sold)', () => {
    // $600 spent on 400 units purchased, of which 300 sold: $1.50, not $2.00.
    expect(purchaseCostPerUnit(600, 400)).toBe(1.5);
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
  it('period-based PO cost = PO spend ÷ volume purchased; an empty period has no cost', () => {
    expect(periodPoCost(1000, 400)).toBe(2.5);
    expect(periodPoCost(0, 0)).toBeNull();
    expect(periodPoCost(500, 0)).toBeNull();
    expect(periodPoCost(-5, 10)).toBeNull();
    expect(periodPoCost(5, -10)).toBeNull();
    expect(periodPoCost(null, 10)).toBeNull();
  });
  it('New PO Cost is the last complete week, or the latest earlier week with purchases', () => {
    const roma = itemByName('Roma Tomatoes').idx;
    const info = newPoCostInfo(roma);
    expect(info.week).toBe(LAST_COMPLETE_WEEK);
    const t = poTotals(roma, LAST_COMPLETE_WEEK * 7, LAST_COMPLETE_WEEK * 7 + 6);
    expect(info.cost).toBeCloseTo(t.spend / t.units, 9);
    // Pie pumpkins out of season: no purchases after the season, so the cost comes from an earlier week.
    const p = itemByName('Pie Pumpkins').idx;
    const off = newPoCostInfo(p, globalWeek(2026, 20));
    expect(off.cost === null || off.week <= globalWeek(2026, 20)).toBe(true);
  });
  it('Roma tomatoes: $19.95 normal case, $4.95 glut in W35, $44.95 spike in W36, then back; margin normal outside those weeks', () => {
    const roma = itemByName('Roma Tomatoes').idx;
    const m = getModel();
    expect(currentPoCost(roma)).toBeCloseTo(19.45 / 25, 3);
    const wk = (n: number) => poUnitCostWeek(roma, globalWeek(2026, n));
    expect(wk(35)).toBeLessThan(0.3);
    expect(wk(36)).toBeGreaterThan(1.8);
    expect(wk(37)).toBeLessThan(wk(36));
    expect(wk(38)).toBeLessThan(wk(37));
    for (const n of [30, 34, 39, 42]) {
      expect(wk(n)).toBeGreaterThan(0.8);
      expect(wk(n)).toBeLessThan(0.9);
      const retail = m.retail[roma * NW + globalWeek(2026, n)];
      const margin = 1 - wk(n) / retail;
      expect(margin).toBeGreaterThan(0.4);
      expect(margin).toBeLessThan(0.55);
    }
    expect(newPoCost(roma)!).toBeLessThan(0.9);
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
    expect(moz.change).toBeGreaterThan(0.08);
    expect(moz.change).toBeLessThan(0.16);
  });
  it('slices cost the pie divided by the slice count', () => {
    const pie = itemByName('16 in. Pepperoni Pizza').composite!;
    const slice = itemByName('16 in. Pepperoni Pizza Slice').composite!;
    expect(slice.standardCost).toBeCloseTo(pie.standardCost / 8, 6);
  });
});

describe('Item Cost Over Time', () => {
  const roma = itemByName('Roma Tomatoes').idx;
  it('PO Cost / Unit per week and per fiscal period is PO spend ÷ volume purchased in that bucket', () => {
    const w0 = globalWeek(2026, 18);
    const w1 = globalWeek(2026, 42);
    const weeks = costSeries(roma, w0, w1, 'week');
    expect(weeks).toHaveLength(w1 - w0 + 1);
    for (const p of weeks) {
      const t = poTotals(roma, p.day, p.week * 7 + 6);
      expect(p.units).toBeCloseTo(t.units, 6);
      expect(p.cost).toBeCloseTo(t.spend / t.units, 9);
    }
    const periods = costSeries(roma, w0, w1, 'period');
    // Buckets follow fiscal periods (4-4-5) and cover the same weeks.
    expect(periods.reduce((a, p) => a + p.units, 0)).toBeCloseTo(weeks.reduce((a, p) => a + p.units, 0), 4);
    for (const p of periods) expect(p.cost).toBeCloseTo(p.spend / p.units, 9);
    // The W36 spike: week 35 below $0.90 / lb, week 36 above $1.40 / lb; HQ stays at $19.45 / 25 lb.
    expect(weeks.find((p) => p.week === globalWeek(2026, 35))!.cost!).toBeLessThan(0.9);
    expect(weeks.find((p) => p.week === globalWeek(2026, 36))!.cost!).toBeGreaterThan(1.4);
    expect(weeks.every((p) => Math.abs(p.hq - 19.45 / 25) < 1e-6)).toBe(true);
  });
  it('a period without purchases is a gap; margins carry the most recent PO cost and say where it came from', () => {
    const p = itemByName('Pie Pumpkins').idx;
    const series = costSeries(p, globalWeek(2025, 1), LAST_COMPLETE_WEEK, 'week');
    const gaps = series.filter((x) => x.units === 0);
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect(g.cost).toBeNull();
    const g = gaps.find((x) => series.some((y) => y.week < x.week && y.units > 0))!;
    const from = poCostFromWeek(p, g.week);
    expect(from).toBeLessThan(g.week);
    expect(poUnitCostWeek(p, g.week)).toBeCloseTo(poCostForDays(p, from * 7, from * 7 + 6)!, 4);
    // A day with no deliveries (Sunday) has no PO cost.
    expect(poCostForDays(p, weekStartDay(g.week), weekStartDay(g.week))).toBeNull();
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
  it('High Loss Flag is loss higher than $1,000 in a week: 999.99 and 1000 are not flagged, 1000.01 is', () => {
    expect(highLossFlag(999.99, 0, DEFAULT_LOSS_RULE)).toBe(false);
    expect(highLossFlag(1000, 0, DEFAULT_LOSS_RULE)).toBe(false);
    expect(highLossFlag(1000.01, 0, DEFAULT_LOSS_RULE)).toBe(true);
    // The 26-week average does not matter unless the proposed rule is switched on.
    expect(highLossFlag(1000.01, 5000, DEFAULT_LOSS_RULE)).toBe(true);
    expect(highLossFlag(1500, 750, { ...DEFAULT_LOSS_RULE, avg: true })).toBe(false);
    expect(highLossFlag(1500, 749, { ...DEFAULT_LOSS_RULE, avg: true })).toBe(true);
  });
  it('entry error label needs more than 20× typical units', () => {
    expect(likelyEntryError(200, 10)).toBe(false);
    expect(likelyEntryError(200.01, 10)).toBe(true);
  });
  it('every flag in the data is above $1,000 for one item-store-week', () => {
    for (const f of findFlags(buildScope(DEFAULT_STATE, ytd))) expect(f.cost).toBeGreaterThan(1000);
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
  it('item Total Purchases = Biceps PO spend (PLU, RW), bill-out (UPC) or production cost (composite), and Purchase Cost per Unit divides by volume purchased', () => {
    const all = buildScope(DEFAULT_STATE, ytd);
    const aggs = itemAggregates(all, DEFAULT_STATE.costBasis, 'po');
    const m = getModel();
    const byName = (n: string) => aggs.find((a) => ITEMS[a.item].name === n)!;
    for (const name of ['Roma Tomatoes', 'Atlantic Salmon Fillet']) {
      const a = byName(name);
      const t = poTotals(a.item, ytd.start, ytd.end);
      // All stores hold the whole chain (share 1, up to float rounding).
      expect(a.purch / t.spend).toBeCloseTo(1, 6);
      const units = ITEMS[a.item].uom === 'ea' ? a.purchUnitsEa : a.purchUnitsLb;
      expect(units / t.units).toBeCloseTo(1, 6);
      expect(purchaseCostPerUnit(a.purch, units)! / (t.spend / t.units)).toBeCloseTo(1, 6);
    }
    const upc = aggs.find((a) => ITEMS[a.item].costType === 'UPC' && a.purch > 0)!;
    const lines = ordersOf(upc.item).filter((o) => o.day >= ytd.start && o.day <= ytd.end);
    expect(lines.every((o) => o.vendor === 'Weis Distribution Center')).toBe(true);
    expect(upc.purch / lines.reduce((x, o) => x + (o.caseCost + o.freight) * o.cases, 0)).toBeCloseTo(1, 6);
    const pizza = byName('16 in. Pepperoni Pizza');
    expect(pizza.purchUnitsEa).toBeCloseTo(pizza.ea + pizza.lossUnitsEa, 4);
    let prod = 0;
    for (let w = Math.floor(ytd.start / 7); w <= Math.min(Math.floor(ytd.end / 7), NW - 1); w++) {
      const k = pizza.item * NW + w;
      if (w * 7 + 6 > ytd.end) continue;
      prod += (m.units[k] + (m.poCost[k] > 0 ? m.lossCost[k] / m.poCost[k] : 0)) * compositeCostAt(ITEMS[pizza.item], w);
    }
    expect(pizza.purch / prod).toBeCloseTo(1, 2);
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
  it('simulated inventory never goes negative: stores reorder up to par in whole cases', () => {
    const m = getModel();
    const rand = mulberry32(SEED + 1);
    for (let k = 0; k < 30; k++) {
      const i = Math.floor(rand() * ITEMS.length);
      if (ITEMS[i].composite) continue;
      const byDay = new Map<number, number>();
      for (const o of ordersOf(i)) byDay.set(o.day, (byDay.get(o.day) ?? 0) + o.units);
      const used = (day: number) => {
        const w = Math.min(Math.floor(day / 7), LAST_COMPLETE_WEEK);
        const pc = m.poCost[i * NW + w];
        return m.dUnits[i * 1023 + day] + (pc > 0 ? m.lossCost[i * NW + w] / pc / 7 : 0);
      };
      // Opening stock: one week of use.
      let inv = 0;
      for (let day = 0; day < 7; day++) inv += used(day);
      for (let day = 0; day < 1023; day++) {
        inv += byDay.get(day) ?? 0;
        inv -= used(day);
        expect(inv).toBeGreaterThan(-1e-6);
      }
    }
  });
});

describe('input clamps and URL state', () => {
  it('clamps loss rule, expected loss and rejects bad values', () => {
    expect(clampLossRule({ dollars: -50, pct: -1 })).toEqual({ dollars: 250, pct: 0, avg: false });
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
  it('bands are centered on each department’s item-level Gross Margin Rate at PO cost (year to date)', () => {
    const aggs = itemAggregates(buildScope(DEFAULT_STATE, ytd), DEFAULT_STATE.costBasis, 'po');
    for (const d of DEPTS) {
      const t = emptyAgg();
      for (const a of aggs) if (ITEMS[a.item].dept === d.idx) addAgg(t, a);
      const gm = grossMarginRate(t.net - t.cost, t.gross, t.net)!;
      const band = deptBand(d.idx);
      expect(gm).toBeGreaterThanOrEqual(band.lo);
      expect(gm).toBeLessThanOrEqual(band.hi);
    }
  });
});

describe('Known Loss Report', () => {
  const scope = buildScope(DEFAULT_STATE, ytd);
  const items = itemAggregates(scope, DEFAULT_STATE.costBasis, DEFAULT_STATE.costSource);
  const total = emptyAgg();
  for (const a of items) addAgg(total, a);
  type Key = 'gross' | 'ea' | 'lb' | 'loss' | 'lossUnitsEa' | 'lossUnitsLb';
  const KEYS: Key[] = ['gross', 'ea', 'lb', 'loss', 'lossUnitsEa', 'lossUnitsLb'];
  /** Exact up to floating-point rounding. */
  const same = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
  const reconcile = (sc: typeof scope, aggs: typeof items, item: number) => {
    const rows = storeKnownLoss(sc, item);
    const t = emptyAgg();
    for (const a of aggs) if (item < 0 || a.item === item) addAgg(t, a);
    for (const k of KEYS) same(rows.reduce((x, r) => x + r[k], 0), t[k]);
    expect(rows.reduce((x, r) => x + r.flags, 0)).toBe(findFlags(sc).filter((f) => item < 0 || f.item === item).length);
    return rows;
  };
  it('store rows add up exactly to the item table for all items (sales, volume, known loss $ and units)', () => {
    reconcile(scope, items, -1);
    const incl = buildScope({ ...DEFAULT_STATE, flagged: 'incl' }, ytd);
    reconcile(incl, itemAggregates(incl, DEFAULT_STATE.costBasis, DEFAULT_STATE.costSource), -1);
  });
  it('the SKU filter narrows the store table to one item and still adds up exactly, soup included', () => {
    const salmon = itemByName(PLANTED.fatFinger.item).idx;
    expect(reconcile(scope, items, salmon).length).toBeLessThanOrEqual(scope.stores.length);
    const soup = itemByName(PLANTED.soup.item).idx;
    reconcile(scope, items, soup);
    const w40 = resolveTime({ ...BASE_TIME, mode: 'fiscal', grain: 'week', weekStart: weekStartDay(PLANTED.soup.week) });
    for (const flagged of ['excl', 'incl'] as const) {
      const sc = buildScope({ ...DEFAULT_STATE, flagged }, w40);
      reconcile(sc, itemAggregates(sc, DEFAULT_STATE.costBasis, DEFAULT_STATE.costSource), soup);
      // A store subset that includes store 116 also reconciles.
      const sub = buildScope({ ...DEFAULT_STATE, flagged, stores: [PLANTED.soup.store, 152, 217] }, w40);
      reconcile(sub, itemAggregates(sub, DEFAULT_STATE.costBasis, DEFAULT_STATE.costSource), soup);
    }
  });
  it('the soup story is in the item × store × week data: chain units do not change', () => {
    const m = getModel();
    const soup = itemByName(PLANTED.soup.item).idx;
    const adj = m.salesAdjIndex.get(soup * NW + PLANTED.soup.week)!;
    same(adj.units.reduce((a, b) => a + b, 0), 0);
  });
  it('keeps the soup, salmon and strawberries cases findable', () => {
    const flags = findFlags(scope);
    const find = (name: string, store: number, week: number) => flags.find((f) => ITEMS[f.item].name === name && STORES[f.store].id === store && f.week === week);
    expect(find(PLANTED.soup.item, PLANTED.soup.store, PLANTED.soup.week)).toBeTruthy();
    expect(find(PLANTED.fatFinger.item, PLANTED.fatFinger.store, PLANTED.fatFinger.week)).toBeTruthy();
    expect(find(PLANTED.extreme.item, PLANTED.extreme.store, PLANTED.extreme.week)?.extreme).toBe(true);
    const soupItem = itemByName(PLANTED.soup.item).idx;
    const w40 = resolveTime({ ...BASE_TIME, mode: 'fiscal', grain: 'week', weekStart: weekStartDay(PLANTED.soup.week) });
    const rowOf = (flagged: 'excl' | 'incl') =>
      storeKnownLoss(buildScope({ ...DEFAULT_STATE, flagged }, w40), soupItem).find((r) => STORES[r.store].id === PLANTED.soup.store)!;
    const incl = rowOf('incl');
    expect(incl.ea).toBeCloseTo(PLANTED.soup.unitsSold, 6);
    expect(incl.lossUnitsEa).toBeGreaterThan(3900);
    expect(incl.flags).toBe(1);
    // Excluded by default as a likely entry error, but still flagged on the store row.
    const excl = rowOf('excl');
    expect(excl.lossUnitsEa).toBeLessThan(50);
    expect(excl.errFlags).toBe(1);
  });
});

describe('IT review list export', () => {
  it('has item, store, week, units, $ and reason, with numbers as numbers', () => {
    const f = findFlags(buildScope(DEFAULT_STATE, ytd)).find((x) => ITEMS[x.item].name === PLANTED.soup.item)!;
    const rows = itRows([itEntryOf(f)]);
    expect(IT_HEAD).toEqual(['Item', 'SKU Number', 'Store Num', 'District', 'Week', 'Week beginning', 'Known Loss (Units)', 'UoM', 'Known Loss ($, at cost)', 'Reason']);
    const [name, , store, , week, , units, uom, cost, reason] = rows[0];
    expect(name).toBe(PLANTED.soup.item);
    expect(store).toBe(String(PLANTED.soup.store));
    expect(week).toContain(`W${String((PLANTED.soup.week % 52) + 1)}`);
    expect(typeof units).toBe('number');
    expect(units as number).toBeGreaterThan(3900);
    expect(uom).toBe('ea');
    expect(typeof cost).toBe('number');
    expect(reason).toBe('Likely entry error');
    expect(itSheet([itEntryOf(f)]).rows).toHaveLength(1);
  });
  it('guards text fields against formulas and leaves numbers numeric', () => {
    for (const bad of ['=HYPERLINK("x")', '+1', '-cmd', '@SUM(A1)', '\tTab', '\rCR']) expect(csvText(bad).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvText('Chicken Noodle Soup 16 oz')).toBe('Chicken Noodle Soup 16 oz');
    expect(csvText('Wings, 12 ct')).toBe('"Wings, 12 ct"');
    expect(csvText('=A1,"x"')).toBe('"\'=A1,""x"""');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(4000)).toBe('4000');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['Item', 'Known Loss ($)'], [['-Soup', -3.25]])).toBe("Item,Known Loss ($)\r\n'-Soup,-3.25\r\n");
  });
});

describe('new items watch (Known Loss Report)', () => {
  it('counts week 12 in and week 13 out', () => {
    expect(weeksOnSale(100, 111)).toBe(12);
    expect(inNewItemWindow(weeksOnSale(100, 111))).toBe(true);
    expect(inNewItemWindow(weeksOnSale(100, 112))).toBe(false);
    expect(inNewItemWindow(weeksOnSale(100, 99))).toBe(false);
  });
  it('lists FY2026 launches in their first 12 weeks; nothing sells before launch and weeks add up', () => {
    const rows = newItemsWatch(buildScope(DEFAULT_STATE, ytd));
    expect(rows.length).toBeGreaterThan(4);
    const m = getModel();
    for (const r of rows) {
      expect(r.weeks).toBeLessThanOrEqual(12);
      expect(r.weekly).toHaveLength(r.weeks);
      expect(m.sales[r.item * NW + r.launchWeek - 1]).toBe(0);
      expect(r.weekly.reduce((a, w) => a + w.loss, 0)).toBeCloseTo(r.loss, 6);
      expect(r.weekly.reduce((a, w) => a + w.volume, 0)).toBeCloseTo(r.volume, 6);
    }
  });
});

describe('Ingredients View', () => {
  const pizza = itemByName('16 in. Pepperoni Pizza');
  it('opens on 16 in. Pepperoni Pizza and lists only composite Deli and Bakery PLUs', () => {
    const list = ingredientPickerItems(-1, -1);
    expect(list.every((i) => !!ITEMS[i].composite && ['Deli', 'Bakery'].includes(DEPTS[ITEMS[i].dept].name))).toBe(true);
    expect(resolveIngredientsItem(list, -1)).toBe(pizza.idx);
    expect(resolveIngredientsItem([], -1)).toBe(-1);
  });
  it('contribution = units per item × cost per unit; contributions add up to cost / unit; totals follow the workbook interpretation', () => {
    const r = resolveTime({ ...BASE_TIME, mode: 'rolling', rolling: 26 });
    const sum = ingredientsSummary(pizza, r.start, r.end);
    expect(sum.rows.map((x) => x.name)).toEqual(['Pizza dough ball', 'Shredded mozzarella', 'Pizza sauce', 'Sliced pepperoni', '16 in. pizza box']);
    expect(sum.rows.find((x) => x.key === 'mozzarella')!.qty).toBe(12);
    for (const row of sum.rows) expect(row.contribution).toBeCloseTo(row.qty * row.unitCost, 9);
    expect(sum.rows.reduce((a, x) => a + x.contribution, 0)).toBeCloseTo(sum.costPerUnit, 9);
    expect(sum.rows.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9);
    expect(sum.totalCost).toBeCloseTo(sum.costPerUnit * sum.units, 6);
    expect(sum.grossProfit).toBeCloseTo(sum.grossSales - sum.totalCost, 6);
    expect(sum.grossProfitPct!).toBeCloseTo(sum.grossProfit / sum.grossSales, 9);
  });
  it('base ingredients are shared: the pepperoni pizza’s ingredients are used by at least 4 other PLUs', () => {
    for (const key of ['dough16', 'mozzarella', 'pizzaSauce', 'pepperoni']) {
      const others = pluUsing(key).filter((i) => i !== pizza.idx);
      expect(others.length).toBeGreaterThanOrEqual(4);
      expect(others.some((i) => /Stromboli/.test(ITEMS[i].name))).toBe(true);
    }
  });
  it('where used: a new ingredient cost flows to every recipe that uses it, with annual impact on units produced', () => {
    const today = whereUsed('mozzarella', null);
    expect(today.every((r) => r.newCost === r.currentCost && r.annualCostChange === 0 && r.marginImpact === 0)).toBe(true);
    const base = today.find((r) => r.item === pizza.idx)!;
    const unitNow = base.currentCost - recipeCostAt(pizza.composite!, LAST_COMPLETE_WEEK, { key: 'mozzarella', unitCost: 0 });
    const newUnit = unitNow / 12 + 0.05;
    const sim = whereUsed('mozzarella', newUnit);
    expect(sim.map((r) => r.item).sort()).toEqual(pluUsing('mozzarella').sort());
    for (const r of sim) {
      const c = ITEMS[r.item].composite!;
      expect(r.newCost).toBeCloseTo(recipeCostAt(c, LAST_COMPLETE_WEEK, { key: 'mozzarella', unitCost: newUnit }), 9);
      expect(r.newCost - r.currentCost).toBeCloseTo(r.qty * (newUnit - (r.currentCost - recipeCostAt(c, LAST_COMPLETE_WEEK, { key: 'mozzarella', unitCost: 0 })) / r.qty), 9);
      expect(r.unitsProduced).toBeCloseTo(unitsProduced52(r.item), 6);
      expect(r.annualCostChange).toBeCloseTo((r.newCost - r.currentCost) * r.unitsProduced, 6);
      expect(r.marginImpact).toBeCloseTo(-r.annualCostChange, 6);
      expect(r.gpAfter!).toBeLessThan(r.gpBefore!);
    }
    // Slices use the pie's recipe ÷ 8, so they move by an eighth of the pie.
    const slice = sim.find((r) => ITEMS[r.item].name === '16 in. Pepperoni Pizza Slice')!;
    const pie = sim.find((r) => r.item === pizza.idx)!;
    expect(slice.newCost - slice.currentCost).toBeCloseTo((pie.newCost - pie.currentCost) / 8, 9);
  });
  it('accepts a positive ingredient cost up to 10× today and refuses anything else', () => {
    expect(clampIngredientCost('0.25', 0.18)).toBe(0.25);
    expect(clampIngredientCost('$1.5', 0.18)).toBe(1.5);
    expect(clampIngredientCost('0', 0.18)).toBeNull();
    expect(clampIngredientCost('-1', 0.18)).toBeNull();
    expect(clampIngredientCost('2', 0.18)).toBeNull();
    expect(clampIngredientCost('1e3', 0.18)).toBeNull();
    expect(clampIngredientCost('abc', 0.18)).toBeNull();
  });
});

describe('sign convention: a cost increase is a margin loss', () => {
  it('margin impact is the cost change with the opposite sign, red when cost goes up and green when it goes down', () => {
    expect(marginImpactOf(439_000)).toBe(-439_000);
    expect(marginImpactOf(-12_000)).toBe(12_000);
    expect(marginImpactOf(0)).toBe(0);
    expect(impactTone(439_000, 'cost')).toBe('neg');
    expect(impactTone(-439_000, 'margin')).toBe('neg');
    expect(impactTone(-12_000, 'cost')).toBe('pos');
    expect(impactTone(12_000, 'margin')).toBe('pos');
    expect(impactTone(0, 'margin')).toBe('flat');
  });
  it('where used: higher ingredient cost → positive cost change and negative margin impact; lower → the reverse', () => {
    const today = ingredientUnitCostToday('mozzarella');
    const up = whereUsed('mozzarella', today * 1.2);
    const down = whereUsed('mozzarella', today * 0.8);
    for (const r of up) {
      expect(r.annualCostChange).toBeGreaterThan(0);
      expect(r.marginImpact).toBeLessThan(0);
    }
    for (const r of down) {
      expect(r.annualCostChange).toBeLessThan(0);
      expect(r.marginImpact).toBeGreaterThan(0);
    }
  });
  it('simulator: a cost increase shows a positive annual cost change and a negative margin impact, and the reverse', () => {
    const up = simulateCostChange({ cost: 2, retail: 4, newCost: 2.5, newRetail: null, annualUnits: 1000 });
    expect(up.annualCostChange).toBeCloseTo(500);
    expect(up.impactNoRetailChange).toBeCloseTo(-500);
    const down = simulateCostChange({ cost: 2, retail: 4, newCost: 1.5, newRetail: null, annualUnits: 1000 });
    expect(down.annualCostChange).toBeCloseTo(-500);
    expect(down.impactNoRetailChange).toBeCloseTo(500);
  });
  it('Cost Watch: items costing more on POs than in HQ show a negative margin impact, cheaper ones a positive one', () => {
    const rows = costWatchRows(buildScope(DEFAULT_STATE, ytd));
    const ups = rows.filter((r) => r.costChange > 0);
    const downs = rows.filter((r) => r.costChange < 0);
    expect(ups.length).toBeGreaterThan(0);
    expect(downs.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.marginImpact).toBeCloseTo(-r.costChange, 9);
    // Sorted with the largest margin loss first.
    for (let k = 1; k < rows.length; k++) expect(rows[k].marginImpact).toBeGreaterThanOrEqual(rows[k - 1].marginImpact);
    for (const r of pluRows(buildScope(DEFAULT_STATE, ytd))) expect(r.marginImpact).toBeCloseTo(-r.costChange, 9);
  });
});

describe('realism of the cost stories', () => {
  const sc = buildScope(DEFAULT_STATE, ytd);
  it('about 55–65 % of recipe PLUs are older than 6 months, a few older than 12, and 16 in. Pepperoni Pizza is the oldest and the top margin impact', () => {
    const comp = ITEMS.filter((x) => x.composite);
    const over6 = comp.filter((x) => x.composite!.ageMonths > 6).length / comp.length;
    const over12 = comp.filter((x) => x.composite!.ageMonths > 12).length;
    expect(over6).toBeGreaterThanOrEqual(0.55);
    expect(over6).toBeLessThanOrEqual(0.65);
    expect(over12).toBeGreaterThan(0);
    expect(over12).toBeLessThanOrEqual(comp.length * 0.15);
    const oldest = Math.max(...comp.map((x) => x.composite!.ageMonths));
    expect(itemByName('16 in. Pepperoni Pizza').composite!.ageMonths).toBe(oldest);
    expect(ITEMS[pluRows(sc)[0].item].name).toBe('16 in. Pepperoni Pizza');
  });
  it('most items cost more on POs than in HQ, about 25–30 % cost less, and pie pumpkins lead the margin impact', () => {
    const rows = costWatchRows(sc);
    const cheaper = rows.filter((r) => r.costChange < 0).length / rows.length;
    expect(cheaper).toBeGreaterThanOrEqual(0.25);
    expect(cheaper).toBeLessThanOrEqual(0.3);
    expect(ITEMS[rows[0].item].name).toBe('Pie Pumpkins');
  });
  it('freight inside the New PO Cost explains part of the gap (HQ excludes freight)', () => {
    for (const r of costWatchRows(sc)) {
      if (r.next === null || r.freight === null) continue;
      const fr = supplyOf(r.item).freightRate;
      expect(r.freight).toBeCloseTo((r.next * fr) / (1 + fr), 9);
      expect(r.freight).toBeLessThan(r.next);
    }
  });
});

describe('ranking order (Top first | Bottom first)', () => {
  it('top lists highest to lowest; bottom lists the lowest of the whole ranking, lowest first', async () => {
    const { rankSlice } = await import('../components/Charts');
    const rows = [3, -5, 10, 0, 7, -2].map((v) => ({ v }));
    expect(rankSlice(rows, (r) => r.v, 'top').map((r) => r.v)).toEqual([10, 7, 3, 0, -2, -5]);
    expect(rankSlice(rows, (r) => r.v, 'top', 2).map((r) => r.v)).toEqual([10, 7]);
    expect(rankSlice(rows, (r) => r.v, 'bottom', 2).map((r) => r.v)).toEqual([-5, -2]);
    expect(rows.map((r) => r.v)).toEqual([3, -5, 10, 0, 7, -2]);
  });
});
