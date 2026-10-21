import { describe, expect, it } from 'vitest';
import { formatDay, globalWeek, weekStartDay } from '../data/calendar';
import { ITEMS } from '../data/products';
import { DEFAULT_STATE, fromQuery, resolveTime, sanitizeSearch, searchItems, storeIndices, toQuery, BASE_TIME } from './filters';
import { buildScope, findFlags, itemAggregates, shrinkAggregates, storeCatLoss } from './selectors';

const W42_TIME = { ...BASE_TIME, mode: 'fiscal' as const, grain: 'week' as const, weekStart: weekStartDay(globalWeek(2026, 42)) };

describe('time resolution', () => {
  it('defaults weekly views to the last complete week, W42', () => {
    const r = resolveTime(W42_TIME);
    expect(formatDay(r.start)).toBe('10/11/2026');
    expect(formatDay(r.end)).toBe('10/17/2026');
    expect(r.snapped).toBe(false);
  });
  it('YTD runs from the FY2026 start to the as-of date, weekly sources to W42', () => {
    const r = resolveTime(BASE_TIME);
    expect(r.label).toBe('12/28/2025 – 10/18/2026');
    expect(r.endWeek).toBe(globalWeek(2026, 42));
    expect(r.snapped).toBe(true);
  });
  it('clamps custom dates and swaps reversed ranges', () => {
    const r = resolveTime({ ...BASE_TIME, mode: 'custom', from: 5000, to: -20 });
    expect(r.start).toBe(0);
    expect(formatDay(r.end)).toBe('10/18/2026');
  });
  it('lines holidays up with the same holiday last year', () => {
    const r = resolveTime({ ...BASE_TIME, mode: 'fiscal', grain: 'holiday', holiday: 'easter', fy: 2026 });
    expect(formatDay(r.start)).toBe('03/29/2026');
    expect(formatDay(r.lyStart)).toBe('04/13/2025');
  });
});

describe('URL state', () => {
  it('round-trips a full filter state', () => {
    const it0 = ITEMS.find((i) => i.name === 'Atlantic Salmon Fillet')!;
    const s = {
      ...DEFAULT_STATE,
      tab: 'loss' as const,
      time: { ...BASE_TIME, mode: 'fiscal' as const, grain: 'week' as const, weekStart: weekStartDay(globalWeek(2026, 38)) },
      dept: it0.dept,
      cat: it0.cat,
      sub: it0.sub,
      item: it0.idx,
      region: 1,
      districts: ['D01'],
      stores: [152],
      idStores: true,
      lossBasis: 'retail' as const,
      rule: { dollars: 2500, pct: 1.5, avg: true },
    };
    expect(fromQuery(toQuery(s))).toEqual(s);
  });
  it('ignores invalid, oversized and inconsistent parameters', () => {
    const s = fromQuery('tab=hack&dept=99&cat=0&sub=999&item=<script>&reg=7&dist=D99&st=999,abc&rd=5&rp=999999&cb=evil');
    expect(s.tab).toBe('items');
    expect(s.dept).toBe(0);
    expect(s.sub).toBe(-1);
    expect(s.item).toBe(-1);
    expect(s.region).toBe(0);
    expect(s.districts).toEqual([]);
    expect(s.stores).toEqual([]);
    expect(s.rule.dollars).toBe(250);
    expect(s.costBasis).toEqual([]);
    expect(fromQuery('x='.padEnd(5000, 'a'))).toEqual(DEFAULT_STATE);
  });
});

describe('search hygiene', () => {
  it('strips markup characters and caps length', () => {
    expect(sanitizeSearch('<img src=x onerror=alert(1)>')).not.toMatch(/[<>=()]/);
    expect(sanitizeSearch('a'.repeat(500)).length).toBe(40);
  });
  it('finds items by PLU and by name', () => {
    expect(searchItems('4011').map((i) => ITEMS[i].name)).toContain('Bananas');
    expect(searchItems('pepperoni pizza').map((i) => ITEMS[i].name)).toContain('16 in. Pepperoni Pizza');
    expect(searchItems('x')).toEqual([]);
  });
});

describe('empty selections', () => {
  it('return empty results without throwing', () => {
    const range = resolveTime(BASE_TIME);
    const state = { ...DEFAULT_STATE, stores: [999] };
    expect(storeIndices(state, range)).toEqual(expect.any(Array));
    const scope = buildScope({ ...DEFAULT_STATE, region: 3, districts: ['D01'] }, range);
    expect(scope.stores).toEqual([]);
    const aggs = itemAggregates(scope, ['trade']);
    expect(aggs.every((a) => a.gross === 0 && a.net === 0)).toBe(true);
    expect(findFlags(scope)).toEqual([]);
    expect(storeCatLoss(scope).size).toBe(0);
    expect(shrinkAggregates(scope).every((a) => a.loss === 0)).toBe(true);
    const noItems = buildScope({ ...DEFAULT_STATE, dept: 0, cat: 10 }, range);
    expect(noItems.items).toEqual([]);
    expect(itemAggregates(noItems, ['trade'])).toEqual([]);
  });
});
