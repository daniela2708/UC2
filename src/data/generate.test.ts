import { describe, expect, it } from 'vitest';
import { globalWeek, LAST_COMPLETE_WEEK, weekStartDay } from './calendar';
import { buildModel, getModel, NW } from './generate';
import { PLANTED } from './planted';
import { CATS, deptTable, DEPTS, itemByName, ITEMS, recipeCostAt, SUBS } from './products';
import { nameKey } from './prng';
import { deptBand } from './targets';
import { DEFAULT_EXPECTED_LOSS } from '../lib/kpis';
import { fromQuery } from '../lib/filters';
import { STORES } from './stores';
import { DEFAULT_STATE, resolveTime, BASE_TIME, tabDefaultTime } from '../lib/filters';
import { buildScope, findFlags, freshStoreWeeks, storeCatLoss } from '../lib/selectors';
import { freshGpPct, totalPurchases } from '../lib/kpis';
import { shrimpStory } from '../views/common';

const m = getModel();
const dept = (name: string) => DEPTS.findIndex((d) => d.name === name);

const W42_TIME = { ...BASE_TIME, mode: 'fiscal' as const, grain: 'week' as const, weekStart: weekStartDay(globalWeek(2026, 42)) };

describe('masters', () => {
  it('has 200 stores in 3 regions and 12 districts, with unique codes', () => {
    expect(STORES).toHaveLength(200);
    expect(new Set(STORES.map((s) => s.district)).size).toBe(12);
    expect(STORES.every((s) => s.size >= 0.5 && s.size <= 1.6)).toBe(true);
    expect(STORES.filter((s) => s.openWeek > 0)).toHaveLength(6);
    expect(STORES.filter((s) => s.closeWeek < 1e9)).toHaveLength(2);
  });
  it('has about 470 fresh items in five departments (Meat is out of scope), with unique codes', () => {
    expect(DEPTS.map((d) => d.name)).toEqual(['Produce', 'Deli', 'Bakery', 'Seafood', 'Floral']);
    expect(ITEMS.length).toBeGreaterThan(440);
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

  it('3: 16 in. Pepperoni Pizza (recipe last costed 03/2025) has the largest recipe cost gap, about 8 pts of margin', () => {
    const m = getModel();
    const fy0 = globalWeek(2026, 1);
    const gaps = ITEMS.filter((it) => it.composite).map((it) => {
      const c = it.composite!;
      let units = 0;
      let net = 0;
      for (let w = fy0; w <= LAST_COMPLETE_WEEK; w++) {
        units += m.units[it.idx * NW + w];
        net += m.sales[it.idx * NW + w] * (1 - m.disc[it.dept * NW + w]);
      }
      const est = recipeCostAt(c, LAST_COMPLETE_WEEK);
      return { it, impact: (est - c.standardCost) * units, pts: ((est - c.standardCost) / (net / units)) * 100 };
    });
    gaps.sort((a, b) => b.impact - a.impact);
    expect(gaps[0].it.name).toBe('16 in. Pepperoni Pizza');
    expect(gaps[0].it.composite!.updatedLabel).toBe('03/2025');
    expect(gaps[0].pts).toBeGreaterThan(7);
    expect(gaps[0].pts).toBeLessThan(10.5);
  });

  it('4: shrimp cost is up ~18 % since P8 with flat retail, Seafood GM % down 2–3.5 pts', () => {
    const s = shrimpStory();
    expect(s.costChange).toBeGreaterThan(0.14);
    expect(Math.abs(s.retailChange)).toBeLessThan(0.02);
    const pts = (s.gmNow - s.gmLy) * 100;
    expect(pts).toBeLessThan(-2);
    expect(pts).toBeGreaterThan(-3.5);
  });

  it('5: store 154 Produce runs well below budget over W39–W42 (weekly values swing with purchase timing)', () => {
    const scope = buildScope({ ...DEFAULT_STATE, stores: [154] }, resolveTime(tabDefaultTime('fresh')));
    const weeks = [39, 40, 41, 42].map((w) => globalWeek(2026, w));
    const row = freshStoreWeeks(scope, [dept('Produce')], weeks).get(STORES.find((s) => s.id === 154)!.idx)!;
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
    const rows = freshStoreWeeks(scope, [dept('Produce')], weeks);
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
    const scope = buildScope({ ...DEFAULT_STATE, stores: [...PLANTED.incomplete.stores] }, resolveTime(W42_TIME));
    for (const row of storeCatLoss(scope).values()) for (const v of row) expect(v.loss).toBe(0);
  });
});

describe('Meat is out of scope for UC2', () => {
  it('no department, category or subcategory belongs to Meat; every department has its tables', () => {
    expect(DEPTS.some((d) => /meat/i.test(d.name))).toBe(false);
    expect(ITEMS.every((it) => DEPTS[it.dept] !== undefined && CATS[it.cat].dept === it.dept && SUBS[it.sub].cat === it.cat)).toBe(true);
    for (const d of DEPTS) {
      expect(deptBand(d.idx)).toBeDefined();
      expect(DEFAULT_EXPECTED_LOSS[d.name]).toBeGreaterThan(0);
    }
    expect('Meat' in DEFAULT_EXPECTED_LOSS).toBe(false);
  });
  it('keeps Deli and Seafood items with meat or beef in the name, and recipes with meat ingredients', () => {
    const keep: [string, string][] = [
      ['16 in. Meat Lovers Pizza', 'Deli'],
      ['Meatloaf Dinner', 'Deli'],
      ['Meat & Cheese Tray Medium', 'Deli'],
      ['Lump Crab Meat 8 oz', 'Seafood'],
    ];
    for (const [name, dep] of keep) expect(DEPTS[itemByName(name).dept].name).toBe(dep);
    const lovers = itemByName('16 in. Meat Lovers Pizza').composite!;
    expect(lovers.components.map((c) => c.key)).toContain('sausage');
    expect(recipeCostAt(lovers, LAST_COMPLETE_WEEK)).toBeGreaterThan(0);
  });
  it('keeps the item codes published before Meat left the catalog (demo links and searches)', () => {
    expect(itemByName('Roma Tomatoes').code).toBe('4123');
    expect(itemByName('Chicken Noodle Soup 16 oz').code).toBe('24169');
    expect(new Set(ITEMS.map((i) => i.code)).size).toBe(ITEMS.length);
  });
  it('deptTable maps by department name and fails safely when one is missing', () => {
    expect(deptTable({ A: 1, B: 2 }, ['B', 'A'])).toEqual([2, 1]);
    expect(deptTable({}, [])).toEqual([]);
    expect(() => deptTable({ Produce: 1 }, ['Produce', 'Deli'])).toThrow(/Missing department/);
    // Inherited keys are not departments.
    expect(() => deptTable({}, ['toString'])).toThrow(/Missing department/);
  });
  it('nameKey is stable, deterministic and handles empty strings', () => {
    expect(nameKey('16 in. Pepperoni Pizza')).toBe(nameKey('16 in. Pepperoni Pizza'));
    expect(nameKey('a')).not.toBe(nameKey('b'));
    expect(Number.isInteger(nameKey(''))).toBe(true);
  });
  it('old links with a Meat expected-loss rate or a prototype key are ignored', () => {
    const s = fromQuery('tab=items&el=Meat:9;__proto__:5;constructor:5;Deli:15');
    expect(s.expLoss.Deli).toBeCloseTo(0.15);
    expect(Object.prototype.hasOwnProperty.call(s.expLoss, 'Meat')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(s.expLoss, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

