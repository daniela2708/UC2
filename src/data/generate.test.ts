import { describe, expect, it } from 'vitest';
import { globalWeek } from './calendar';
import { buildModel, getModel, NW } from './generate';
import { PLANTED } from './planted';
import { DEPTS, ITEMS } from './products';
import { STORES } from './stores';
import { DEFAULT_STATE, resolveTime, BASE_TIME, tabDefaultTime } from '../lib/filters';
import { buildScope, findFlags, freshStoreWeeks, pluRows, storeCatLoss } from '../lib/selectors';
import { freshGpPct, totalPurchases } from '../lib/kpis';
import { shrimpStory } from '../views/common';

const m = getModel();
const dept = (name: string) => DEPTS.findIndex((d) => d.name === name);

describe('masters', () => {
  it('has 200 stores in 3 regions and 12 districts, with unique codes', () => {
    expect(STORES).toHaveLength(200);
    expect(new Set(STORES.map((s) => s.district)).size).toBe(12);
    expect(STORES.every((s) => s.size >= 0.5 && s.size <= 1.6)).toBe(true);
    expect(STORES.filter((s) => s.openWeek > 0)).toHaveLength(6);
    expect(STORES.filter((s) => s.closeWeek < 1e9)).toHaveLength(2);
  });
  it('has about 600 fresh items with unique codes', () => {
    expect(ITEMS.length).toBeGreaterThan(550);
    expect(new Set(ITEMS.map((i) => i.code)).size).toBe(ITEMS.length);
  });
});

describe('generator', () => {
  it('is deterministic', () => {
    const again = buildModel();
    expect(again.sales).toEqual(m.sales);
    expect(again.events).toEqual(m.events);
  });

  it('lands department magnitudes near the FY2024 Fresh Report', () => {
    const want: Record<string, [number, number]> = {
      Meat: [7.3e6, 9.6e6],
      Produce: [6.4e6, 7.8e6],
      Deli: [3.8e6, 4.5e6],
      Bakery: [2.2e6, 2.8e6],
      Seafood: [1.35e6, 1.8e6],
      Floral: [0.7e6, 1.0e6],
    };
    for (const [name, [lo, hi]] of Object.entries(want)) {
      const d = dept(name);
      let s = 0;
      for (const it of ITEMS) if (it.dept === d) for (let w = 0; w < 52; w++) s += m.sales[it.idx * NW + w];
      expect(s / 52).toBeGreaterThan(lo);
      expect(s / 52).toBeLessThan(hi);
    }
  });

  it('spikes Floral for Valentine’s Day', () => {
    const d = dept('Floral');
    const week = (w: number) => ITEMS.filter((i) => i.dept === d).reduce((a, i) => a + m.sales[i.idx * NW + w], 0);
    const vday = globalWeek(2025, 7);
    expect(week(vday) / week(vday - 3)).toBeGreaterThan(2.5);
  });
});

describe('planted stories', () => {
  const ytd = resolveTime(BASE_TIME);

  it('1–2: salmon tops the ranked flags; the $8.9M strawberries entry is flagged and kept out of totals', () => {
    const scope = buildScope(DEFAULT_STATE, ytd);
    const flags = findFlags(scope);
    const ranked = flags.filter((f) => !f.extreme);
    expect(ITEMS[ranked[0].item].name).toBe(PLANTED.fatFinger.item);
    expect(STORES[ranked[0].store].id).toBe(152);
    expect(ranked[0].entryError).toBe(true);
    const ext = flags.find((f) => f.extreme)!;
    expect(ITEMS[ext.item].name).toBe(PLANTED.extreme.item);
    let loss = 0;
    for (const row of storeCatLoss(scope).values()) for (const v of row) loss += v.loss;
    expect(loss).toBeLessThan(60e6);
    const incl = buildScope({ ...DEFAULT_STATE, flagged: 'incl' }, ytd);
    let lossIncl = 0;
    for (const row of storeCatLoss(incl).values()) for (const v of row) lossIncl += v.loss;
    expect(lossIncl - loss).toBeGreaterThan(8.9e6);
  });

  it('3: 16 in. Pepperoni Pizza tops PLU Cost Watch with a ~9 pt margin gap', () => {
    const rows = pluRows(buildScope(DEFAULT_STATE, ytd));
    expect(ITEMS[rows[0].item].name).toBe('16 in. Pepperoni Pizza');
    expect(rows[0].updatedLabel).toBe('03/2025');
    const gap = (rows[0].displayedMargin - rows[0].estMargin) * 100;
    expect(gap).toBeGreaterThan(8);
    expect(gap).toBeLessThan(10.5);
  });

  it('4: shrimp cost is up ~18 % since P8 with flat retail, Seafood GM % down 2–3.5 pts', () => {
    const s = shrimpStory();
    expect(s.costChange).toBeGreaterThan(0.14);
    expect(Math.abs(s.retailChange)).toBeLessThan(0.02);
    const pts = (s.gmNow - s.gmLy) * 100;
    expect(pts).toBeLessThan(-2);
    expect(pts).toBeGreaterThan(-3.5);
  });

  it('5: store 154 Meat runs about 8 pts below budget over W39–W42 (weekly values swing with purchase timing)', () => {
    const scope = buildScope({ ...DEFAULT_STATE, stores: [154] }, resolveTime(tabDefaultTime('fresh')));
    const weeks = [39, 40, 41, 42].map((w) => globalWeek(2026, w));
    const row = freshStoreWeeks(scope, [dept('Meat')], weeks).get(STORES.find((s) => s.id === 154)!.idx)!;
    let sales = 0;
    let purchases = 0;
    let budget = 0;
    for (const c of row) {
      sales += c.sales;
      purchases += totalPurchases(c.purchases);
      budget += c.budget;
    }
    const gap = (freshGpPct(sales, purchases)! - budget / sales) * 100;
    expect(gap).toBeLessThan(-6);
    expect(gap).toBeGreaterThan(-11);
  });

  it('weekly Fresh GP % is volatile but steadies when accumulated', () => {
    const scope = buildScope(DEFAULT_STATE, resolveTime(BASE_TIME), { deptOnly: true });
    const weeks = Array.from({ length: 26 }, (_, i) => globalWeek(2026, 14 + i));
    const rows = freshStoreWeeks(scope, [dept('Meat')], weeks);
    const gps = weeks.map((_, i) => {
      let s = 0;
      let p = 0;
      for (const r of rows.values()) {
        s += r[i].sales;
        p += totalPurchases(r[i].purchases);
      }
      return freshGpPct(s, p)!;
    });
    expect((Math.max(...gps) - Math.min(...gps)) * 100).toBeGreaterThan(8);
  });

  it('6: stores 213, 386 and 290 post no known loss for W42', () => {
    const scope = buildScope({ ...DEFAULT_STATE, stores: [...PLANTED.incomplete.stores] }, resolveTime(tabDefaultTime('storeloss')));
    for (const row of storeCatLoss(scope).values()) for (const v of row) expect(v.loss).toBe(0);
  });
});
