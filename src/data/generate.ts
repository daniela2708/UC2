/**
 * Seeded data generator. Builds compact typed-array "cubes" once at startup:
 *   item × week (chain)          sales, units, retail, cost, loss, donations, salvage, markdown, recall
 *   item × day (chain)           sales, units (for daily ranges in Category-Item Summary)
 *   category × store × week      store share weights (stores never hold their own item rows)
 *   department × week            discount rate
 * Store-level values are the chain value × the store's share; single item × store × week
 * cells (for loss flags) are derived on demand from the same inputs plus a stable hash.
 */
import {
  anchorWeek,
  DAY_COUNT,
  fiscalOfWeek,
  globalWeek,
  HOLIDAY_YEARS,
  holidaySpan,
  LAST_COMPLETE_WEEK,
  periodSpan,
  WEEK_COUNT,
  type HolidayId,
} from './calendar';
import { hash01, hashNormal, hashSigned } from './prng';
import { CATS, DEPTS, ITEMS, type Item } from './products';
import { isOpen, STORE_BY_ID, STORES } from './stores';
import { EXTREME_ENTRY_DOLLARS, PLANTED } from './planted';
import { PURCHASE_CHANNELS, type PurchaseBreakdown } from '../lib/kpis';

export const NW = WEEK_COUNT;
export const ND = DAY_COUNT;
export const NI = ITEMS.length;
export const NC = CATS.length;
export const NS = STORES.length;
export const NDP = DEPTS.length;

/** Weekly chain gross sales in FY2024 before seasonality, by department. */
const BASE_WEEKLY = [8_200_000, 6_900_000, 4_050_000, 2_400_000, 1_520_000, 800_000];
const DISCOUNT = [0.019, 0.016, 0.017, 0.018, 0.02, 0.015];
/** Known loss at cost, % of sales. */
const LOSS_RATE = [0.019, 0.028, 0.055, 0.018, 0.046, 0.06];
const DONATION_RATE = [0.002, 0.006, 0.005, 0.02, 0.001, 0.003];
const SALVAGE_RATE = [0.0015, 0.003, 0.001, 0.0005, 0.001, 0.002];
const MARKDOWN_RATE = [0.015, 0.004, 0.005, 0.006, 0.004, 0.003];
/** Known loss at retail ÷ known loss at cost. */
export const RETAIL_LOSS_FACTOR = [1.85, 1.9, 2.0, 2.0, 1.8, 1.95];
const DOW_PROFILE = [0.155, 0.125, 0.12, 0.13, 0.14, 0.155, 0.175];

/** Department holiday multipliers (Thanksgiving +35 %, Christmas +30 %, Valentine's ×3 for Floral …). */
const DEPT_HOLIDAY: Record<string, number[]> = {
  thanksgiving: [1.45, 1.35, 1.25, 1.5, 1.15, 1.25],
  christmasEve: [1.3, 1.28, 1.32, 1.35, 1.45, 1.3],
  newYear: [1.1, 1.08, 1.15, 1.05, 1.2, 1.0],
  easter: [1.25, 1.15, 1.12, 1.2, 1.1, 1.6],
  july4: [1.15, 1.15, 1.08, 1.08, 1.02, 1.0],
  memorial: [1.15, 1.15, 1.06, 1.05, 1.0, 1.15],
  laborday: [1.12, 1.08, 1.05, 1.03, 1.0, 1.0],
  halloween: [1.0, 1.03, 1.0, 1.1, 1.0, 1.05],
  valentinesDay: [1.04, 1.02, 1.0, 1.1, 1.15, 3.0],
  superBowl: [1.05, 1.04, 1.15, 1.03, 1.03, 1.0],
  mothersday: [1.03, 1.02, 1.02, 1.08, 1.02, 2.5],
  backtoschool: [1.0, 1.02, 1.05, 1.04, 1.0, 1.0],
};

// ---------------------------------------------------------------- Week helpers

function weekSet(build: (year: number) => number[]): Uint8Array {
  const set = new Uint8Array(NW + 60);
  for (const y of HOLIDAY_YEARS) for (const w of build(y)) if (w >= 0 && w < set.length) set[w] = 1;
  return set;
}
const span = (id: HolidayId) => (y: number) => {
  const s = holidaySpan(id, y);
  const out: number[] = [];
  for (let w = s.startWeek; w <= s.endWeek; w++) out.push(w);
  return out;
};

const HOLIDAY_SETS: Record<string, Uint8Array> = {
  thanksgiving: weekSet(span('thanksgiving')),
  christmasEve: weekSet((y) => [anchorWeek('christmasEve', y)]),
  newYear: weekSet((y) => [anchorWeek('newYear', y)]),
  easter: weekSet(span('easter')),
  july4: weekSet(span('july4')),
  memorial: weekSet(span('memorial')),
  laborday: weekSet(span('laborday')),
  halloween: weekSet(span('halloween')),
  valentinesDay: weekSet((y) => [anchorWeek('valentinesDay', y)]),
  superBowl: weekSet((y) => [anchorWeek('superBowl', y)]),
  mothersday: weekSet(span('mothersday')),
  backtoschool: weekSet(span('backtoschool')),
  lent: weekSet((y) => {
    const e = holidaySpan('easter', y).startWeek;
    return [e - 6, e - 5, e - 4, e - 3, e - 2, e - 1];
  }),
};

const TAG_SET: Record<string, string> = {
  tg: 'thanksgiving',
  es: 'easter',
  vd: 'valentinesDay',
  sb: 'superBowl',
  md: 'mothersday',
  j4: 'july4',
  mm: 'memorial',
  lb: 'laborday',
  hw: 'halloween',
  bs: 'backtoschool',
  le: 'lent',
};
/** Smooth seasons: centre fiscal week of year (0-based) and half width in weeks. */
const SEASONS: Record<string, [number, number]> = {
  su: [28, 9],
  gr: [26, 13],
  fa: [40, 8],
  wi: [2, 8],
  sp: [15, 7],
};

function bump(woy: number, centre: number, half: number): number {
  let d = Math.abs(woy - centre);
  d = Math.min(d, 52 - d);
  return d >= half ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / half));
}

function tagMultiplier(item: Item, w: number): number {
  let m = 1;
  const woy = w % 52;
  for (const tag in item.tags) {
    const peak = item.tags[tag];
    if (tag === 'xm') {
      if (HOLIDAY_SETS.christmasEve[w]) m *= peak;
      else if (HOLIDAY_SETS.newYear[w]) m *= 1 + (peak - 1) * 0.4;
    } else if (tag in TAG_SET) {
      if (HOLIDAY_SETS[TAG_SET[tag]][w]) m *= peak;
    } else if (tag in SEASONS) {
      m *= 1 + (peak - 1) * bump(woy, SEASONS[tag][0], SEASONS[tag][1]);
    }
  }
  return m;
}

function deptSeasonal(d: number, w: number): number {
  const woy = w % 52;
  switch (d) {
    case 0:
      return 1 + 0.06 * bump(woy, 26, 14) - 0.03 * bump(woy, 5, 5);
    case 1:
      return 1 + 0.09 * bump(woy, 27, 14) - 0.04 * bump(woy, 3, 6);
    case 2:
      return 1 + 0.03 * bump(woy, 4, 8);
    case 3:
      return 1 + 0.05 * bump(woy, 48, 6);
    case 4:
      return (HOLIDAY_SETS.lent[w] ? 1.12 : 1) - 0.03 * bump(woy, 30, 8);
    default:
      return 1 + 0.1 * bump(woy, 16, 8);
  }
}

function deptHoliday(d: number, w: number): number {
  let m = 1;
  for (const key in DEPT_HOLIDAY) if (HOLIDAY_SETS[key][w]) m *= DEPT_HOLIDAY[key][d];
  return m;
}

// ---------------------------------------------------------------- Model

export interface LossEvent {
  item: number;
  store: number;
  week: number;
  lossCost: number;
  lossUnits: number;
  kind: 'entry' | 'operational' | 'planted';
}

export interface Model {
  /** item × week */
  sales: Float32Array;
  units: Float32Array;
  retail: Float32Array;
  /** PO cost per unit (list − trade). */
  poCost: Float32Array;
  dealOn: Uint8Array;
  lossCost: Float32Array;
  donations: Float32Array;
  salvage: Float32Array;
  markdown: Float32Array;
  recall: Float32Array;
  /** item × day */
  dSales: Float32Array;
  dUnits: Float32Array;
  /** dept × week */
  disc: Float32Array;
  /** cat × store × week raw share weight, and its per cat × week totals. */
  share: Float32Array;
  shareTot: Float32Array;
  /** cat × week total of share × store loss factor (nominal, including stores that did not post). */
  lossTot: Float32Array;
  /** store × week: 0 when the store has not posted known loss. */
  lossPosted: Uint8Array;
  events: LossEvent[];
  eventIndex: Map<number, number>;
  /** item × store loss affinity. */
  lossAff: Float32Array;
}

export const cellKey = (item: number, store: number, week: number) => (item * NS + store) * NW + week;

const PLANTED_SQUEEZE_ITEMS = new Set(
  ITEMS.filter((it) => DEPTS[it.dept].name === PLANTED.shrimpSqueeze.dept && PLANTED.shrimpSqueeze.namePattern.test(it.name)).map(
    (it) => it.idx,
  ),
);

export function isSqueezeItem(i: number): boolean {
  return PLANTED_SQUEEZE_ITEMS.has(i);
}

/** Builds a fresh model (getModel caches one). */
export function buildModel(): Model {
  const sales = new Float32Array(NI * NW);
  const units = new Float32Array(NI * NW);
  const retail = new Float32Array(NI * NW);
  const poCost = new Float32Array(NI * NW);
  const dealOn = new Uint8Array(NI * NW);
  const lossCost = new Float32Array(NI * NW);
  const donations = new Float32Array(NI * NW);
  const salvage = new Float32Array(NI * NW);
  const markdown = new Float32Array(NI * NW);
  const recall = new Float32Array(NI * NW);
  const dSales = new Float32Array(NI * ND);
  const dUnits = new Float32Array(NI * ND);
  const disc = new Float32Array(NDP * NW);

  // Department weekly totals and discount rates.
  const deptSales = new Float64Array(NDP * NW);
  for (let d = 0; d < NDP; d++) {
    for (let w = 0; w < NW; w++) {
      const growth = Math.pow(1.03, w / 52);
      deptSales[d * NW + w] =
        BASE_WEEKLY[d] * growth * deptSeasonal(d, w) * deptHoliday(d, w) * (1 + 0.015 * hashNormal(d, w, 101));
      disc[d * NW + w] = DISCOUNT[d] + 0.002 * hashNormal(d, w, 102);
    }
  }

  // Item mix inside each department, re-weighted by seasonal tags each week.
  const mix = new Float64Array(NI * NW);
  const mixTot = new Float64Array(NDP * NW);
  for (const it of ITEMS) {
    for (let w = 0; w < NW; w++) {
      const v = it.weight * tagMultiplier(it, w) * (1 + 0.06 * hashNormal(it.idx, w, 103));
      mix[it.idx * NW + w] = v;
      mixTot[it.dept * NW + w] += v;
    }
  }

  // Department-normalised loss rates.
  const lossNorm = new Float64Array(NDP);
  const weightTot = new Float64Array(NDP);
  for (const it of ITEMS) {
    lossNorm[it.dept] += it.weight * it.lossFactor;
    weightTot[it.dept] += it.weight;
  }

  const squeezeFrom = PLANTED.shrimpSqueeze.fromWeek;
  const freezeFrom = PLANTED.shrimpSqueeze.retailFrozenFrom;

  for (const it of ITEMS) {
    const i = it.idx;
    const d = it.dept;
    const lossRate = (LOSS_RATE[d] * it.lossFactor) / (lossNorm[d] / weightTot[d]);
    const squeeze = PLANTED_SQUEEZE_ITEMS.has(i);
    let x = 0;
    const [ar, sd] = it.vol === 'high' ? [0.5, 0.1] : it.vol === 'med' ? [0.5, 0.035] : [0, 0];
    for (let w = 0; w < NW; w++) {
      const k = i * NW + w;
      // Retail: quarterly steps with ~3 % yearly inflation. Shrimp retail frozen in FY2026.
      let price: number;
      if (it.composite) price = it.basePrice;
      else {
        const wq = squeeze && w >= freezeFrom ? freezeFrom : w;
        const q = Math.floor(wq / 13);
        price = it.basePrice * Math.pow(1.03, (q * 13) / 52) * (1 + 0.02 * hashSigned(i, q, 104));
        price = Math.max(0.29, Math.round(price * 10) / 10 - 0.01);
      }
      retail[k] = price;

      // Cost: PO cost tracks retail at the target margin, with item-specific drift.
      let cost: number;
      if (it.composite) {
        const std = price * (1 - DISCOUNT[d]) * (1 - it.margin);
        it.composite.standardCost = std;
        cost = w >= it.composite.updatedWeek ? std : std * 0.94;
      } else {
        if (it.vol === 'step') x = 0.015 * hashSigned(i, Math.floor(w / 13), 105);
        else x = ar * x + sd * hashNormal(i, w, 106);
        let lift = 1;
        if (squeeze && w >= squeezeFrom) lift = 1 + PLANTED.shrimpSqueeze.costLift * (w === squeezeFrom ? 0.5 : 1);
        cost = price * (1 - DISCOUNT[d]) * (1 - it.margin) * Math.exp(x) * lift;
      }
      poCost[k] = cost;
      dealOn[k] = it.composite ? 0 : hash01(i, w, 107) < 0.15 ? 1 : 0;

      // Sales from the department total and this week's mix.
      const s = (deptSales[d * NW + w] * mix[k]) / mixTot[d * NW + w];
      // Daily split; the partial current week only has its first days.
      const w0 = w * 7;
      let profTot = 0;
      const prof = [0, 0, 0, 0, 0, 0, 0];
      for (let dw = 0; dw < 7; dw++) {
        prof[dw] = DOW_PROFILE[dw] * (1 + 0.04 * hashNormal(i, w0 + dw, 108));
        profTot += prof[dw];
      }
      let weekSales = 0;
      for (let dw = 0; dw < 7; dw++) {
        const day = w0 + dw;
        if (day >= ND) break;
        const ds = (s * prof[dw]) / profTot;
        dSales[i * ND + day] = ds;
        dUnits[i * ND + day] = ds / price;
        weekSales += ds;
      }
      sales[k] = weekSales;
      units[k] = weekSales / price;

      if (w <= LAST_COMPLETE_WEEK) {
        lossCost[k] = Math.max(0, weekSales * lossRate * (1 + 0.12 * hashNormal(i, w, 109)));
        donations[k] = weekSales * DONATION_RATE[d] * (0.6 + 0.8 * hash01(i, 110));
        salvage[k] = weekSales * SALVAGE_RATE[d] * (0.5 + hash01(i, 111));
        const md = d === 0 ? 0.005 + 0.02 * hash01(d, w, 112) : MARKDOWN_RATE[d] * (0.6 + 0.8 * hash01(d, w, 112));
        markdown[k] = weekSales * md * (0.7 + 0.6 * hash01(i, 113));
      }
    }
  }

  // Recalls (DY270): whole-chain pulls of an item for one or two weeks, valued at cost.
  const RECALLS: [string, number, number][] = [
    ['Cantaloupe', globalWeek(2024, 46), 2],
    ['Baby Spinach 6 oz', globalWeek(2025, 20), 1],
    ['Chicken Salad', globalWeek(2026, 24), 2],
    ['Sliced Mushrooms 8 oz', globalWeek(2026, 36), 1],
  ];
  for (const [name, start, len] of RECALLS) {
    const it = ITEMS.find((x) => x.name === name);
    if (!it) continue;
    for (let w = start; w < start + len && w <= LAST_COMPLETE_WEEK; w++) {
      const k = it.idx * NW + w;
      recall[k] = units[k] * poCost[k] * 0.55;
    }
  }

  // Store shares.
  const share = new Float32Array(NC * NS * NW);
  const shareTot = new Float32Array(NC * NW);
  const lossTot = new Float32Array(NC * NW);
  const lossPosted = new Uint8Array(NS * NW).fill(1);
  for (const id of PLANTED.incomplete.stores) {
    const s = STORE_BY_ID.get(id);
    if (s) lossPosted[s.idx * NW + PLANTED.incomplete.week] = 0;
  }
  for (let c = 0; c < NC; c++) {
    const d = CATS[c].dept;
    for (const st of STORES) {
      const s = st.idx;
      const aff = st.size * Math.exp(0.12 * hashNormal(st.id, d, 201)) * Math.exp(0.08 * hashNormal(st.id, c, 202));
      for (let w = 0; w < NW; w++) {
        if (!isOpen(st, w)) continue;
        const ramp = st.openWeek > 0 ? Math.min(1, 0.6 + 0.05 * (w - st.openWeek)) : 1;
        const v = aff * ramp * (1 + 0.03 * hashNormal(c, s, w));
        share[(c * NS + s) * NW + w] = v;
        shareTot[c * NW + w] += v;
        lossTot[c * NW + w] += v * st.lossFactor;
      }
    }
  }

  const lossAff = new Float32Array(NI * NS);
  for (let i = 0; i < NI; i++) for (let s = 0; s < NS; s++) lossAff[i * NS + s] = 0.75 + 0.5 * hash01(i, s, 203);

  const model: Model = {
    sales,
    units,
    retail,
    poCost,
    dealOn,
    lossCost,
    donations,
    salvage,
    markdown,
    recall,
    dSales,
    dUnits,
    disc,
    share,
    shareTot,
    lossTot,
    lossPosted,
    events: [],
    eventIndex: new Map(),
    lossAff,
  };
  model.events = buildEvents(model);
  model.events.forEach((e, n) => model.eventIndex.set(cellKey(e.item, e.store, e.week), n));
  return model;
}

/** Baseline weekly known loss at cost for one item in one store (no events). */
export function cellBaseLoss(m: Model, i: number, s: number, w: number): number {
  if (w < 0 || w > LAST_COMPLETE_WEEK || !m.lossPosted[s * NW + w]) return 0;
  const c = ITEMS[i].cat;
  const tot = m.lossTot[c * NW + w];
  if (tot <= 0) return 0;
  const sh = m.share[(c * NS + s) * NW + w];
  if (sh <= 0) return 0;
  return (
    ((m.lossCost[i * NW + w] * sh * STORES[s].lossFactor) / tot) * m.lossAff[i * NS + s] * (1 + 0.45 * hashSigned(i, s, w, 204))
  );
}

/** Upper bound of baseline cell loss per item across stores and weeks, used to skip items that can never trip a $ threshold. */
export function cellLossUpperBound(m: Model, i: number, w0: number, w1: number): number {
  const c = ITEMS[i].cat;
  let maxRatio = 0;
  for (let w = Math.max(0, w0); w <= Math.min(w1, LAST_COMPLETE_WEEK); w++) {
    const tot = m.lossTot[c * NW + w];
    if (tot <= 0) continue;
    const r = m.lossCost[i * NW + w] / tot;
    if (r > maxRatio) maxRatio = r;
  }
  let maxShare = 0;
  for (let s = 0; s < NS; s++) {
    const st = STORES[s];
    const v = st.size * st.lossFactor * 2;
    if (v > maxShare) maxShare = v;
  }
  return maxRatio * maxShare * 1.25 * 1.45;
}

function buildEvents(m: Model): LossEvent[] {
  const events: LossEvent[] = [];
  const taken = new Set<number>();
  // Cumulative item weights by chain sales, for sampling.
  const cum = new Float64Array(NI);
  let acc = 0;
  for (let i = 0; i < NI; i++) {
    acc += BASE_WEEKLY[ITEMS[i].dept] * ITEMS[i].weight;
    cum[i] = acc;
  }
  const pick = (u: number) => {
    const target = u * acc;
    let lo = 0;
    let hi = NI - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Operational losses (cooler failures, over-ordering) hit high-loss items in larger stores.
  const bigItems = ITEMS.map((it) => it.idx)
    .sort((a, b) => BASE_WEEKLY[ITEMS[b].dept] * ITEMS[b].weight * LOSS_RATE[ITEMS[b].dept] - BASE_WEEKLY[ITEMS[a].dept] * ITEMS[a].weight * LOSS_RATE[ITEMS[a].dept])
    .slice(0, 40);
  const bigStores = STORES.filter((s) => s.size * s.lossFactor > 1.1).map((s) => s.idx);
  for (let w = 0; w <= LAST_COMPLETE_WEEK; w++) {
    const n = 4 + Math.floor(hash01(w, 301) * 4);
    for (let e = 0; e < n; e++) {
      const entry = hash01(w, e, 304) < 0.62;
      const i = entry ? pick(hash01(w, e, 302)) : bigItems[Math.floor(hash01(w, e, 302) * bigItems.length)];
      const s = entry ? Math.floor(hash01(w, e, 303) * NS) : bigStores[Math.floor(hash01(w, e, 303) * bigStores.length)];
      const base = cellBaseLoss(m, i, s, w);
      if (base <= 0) continue;
      let factor = entry ? (hash01(w, e, 305) < 0.7 ? 10 : 100) : Math.min(18, Math.max(4, (700 + 1800 * hash01(w, e, 306)) / base));
      if (base * factor > 9_000) factor = entry ? 10 : 9_000 / base;
      if (base * factor > 9_000) continue;
      const key = cellKey(i, s, w);
      if (taken.has(key)) continue;
      taken.add(key);
      const lossCostV = base * factor;
      events.push({
        item: i,
        store: s,
        week: w,
        lossCost: lossCostV,
        lossUnits: lossCostV / m.poCost[i * NW + w],
        kind: entry ? 'entry' : 'operational',
      });
    }
  }
  for (const p of [PLANTED.fatFinger, PLANTED.extreme]) {
    const it = ITEMS.find((x) => x.name === p.item);
    const st = STORE_BY_ID.get(p.store);
    if (!it || !st) continue;
    const key = cellKey(it.idx, st.idx, p.week);
    const existing = events.findIndex((e) => cellKey(e.item, e.store, e.week) === key);
    if (existing >= 0) events.splice(existing, 1);
    events.push({ item: it.idx, store: st.idx, week: p.week, lossCost: p.lossCost, lossUnits: p.lossUnits, kind: 'planted' });
  }
  return events;
}

/** Weekly known loss at cost for one item-store cell, including any loss event. */
export function cellLoss(m: Model, i: number, s: number, w: number): { cost: number; units: number; event: LossEvent | null } {
  const n = m.eventIndex.get(cellKey(i, s, w));
  if (n !== undefined) {
    const e = m.events[n];
    return { cost: e.lossCost, units: e.lossUnits, event: e };
  }
  const cost = cellBaseLoss(m, i, s, w);
  const pc = m.poCost[i * NW + w];
  return { cost, units: pc > 0 ? cost / pc : 0, event: null };
}

export { EXTREME_ENTRY_DOLLARS };

// ---------------------------------------------------------------- Fresh Report purchases

const PURCHASE_BASE: Record<string, number[]> = {
  //            Meat    Produce Deli    Bakery  Seafood Floral
  whse: [0.7, 0.55, 0.44, 0.3, 0.66, 0.38],
  dsd: [0.03, 0.05, 0.07, 0.14, 0.04, 0.05],
  packaging: [0.012, 0.008, 0.03, 0.035, 0.01, 0.02],
  reclaim: [0.001, 0.001, 0.001, 0.001, 0.001, 0.0005],
  donations: [0.002, 0.006, 0.005, 0.02, 0.001, 0.003],
  wcCredit: [-0.004, -0.003, -0.002, -0.002, -0.002, -0.002],
  scanCredit: [-0.02, -0.006, -0.008, -0.004, -0.01, -0.002],
};
/** Week-to-week swing of in-transit timing (telescopes over a period), by department. */
const IN_TRANSIT_AMP = [0.012, 0.018, 0.012, 0.01, 0.075, 0.16];
const BUDGET_GP = [0.292, 0.361, 0.427, 0.513, 0.278, 0.4];
const SEAFOOD_SQUEEZE_WHSE = 0.026;

/** Purchases by channel as fractions of the department-store-week's sales. */
export function purchaseFractions(d: number, s: number, w: number, out: PurchaseBreakdown): PurchaseBreakdown {
  const st = STORES[s];
  const n = (salt: number) => hashNormal(d, st.id, w, salt);
  out.whse = PURCHASE_BASE.whse[d] + 0.008 * hashNormal(d, st.id, 401) + 0.006 * n(402);
  out.dsd = PURCHASE_BASE.dsd[d] * (1 + 0.15 * n(403));
  out.packaging = PURCHASE_BASE.packaging[d] * (1 + 0.1 * n(404));
  out.reclaim = PURCHASE_BASE.reclaim[d] * (1 + 0.5 * hash01(d, st.id, w, 405));
  out.transfers = 0.004 * n(406);
  out.inTransit = IN_TRANSIT_AMP[d] * (n(407) - hashNormal(d, st.id, w - 1, 407)) * 0.7;
  out.donations = PURCHASE_BASE.donations[d] * (0.7 + 0.6 * hash01(d, st.id, w, 408));
  out.wcCredit = PURCHASE_BASE.wcCredit[d] * (0.5 + hash01(d, st.id, w, 409));
  out.scanCredit = PURCHASE_BASE.scanCredit[d] * (0.8 + 0.4 * hash01(d, st.id, w, 410));
  if (d === 4 && w >= PLANTED.shrimpSqueeze.fromWeek) out.whse += SEAFOOD_SQUEEZE_WHSE;
  const o = PLANTED.storeOutlier;
  if (st.id === o.store && DEPTS[d].name === o.dept && w >= o.fromWeek && w <= o.toWeek) {
    out.dsd = o.dsdShare;
    out.whse += o.whseLift;
    out.inTransit = 0;
    out.transfers = 0;
  }
  return out;
}

export function emptyBreakdown(): PurchaseBreakdown {
  const b = {} as PurchaseBreakdown;
  for (const c of PURCHASE_CHANNELS) b[c] = 0;
  return b;
}

/** Budget GP % by department, store and fiscal period. */
export function budgetGp(d: number, s: number, w: number): number {
  const f = fiscalOfWeek(w);
  return BUDGET_GP[d] + 0.005 * hashNormal(d, STORES[s].id, 501) + 0.004 * hashNormal(d, f.fy, f.period, 502);
}

// ---------------------------------------------------------------- Singleton

let cached: Model | null = null;
export function getModel(): Model {
  if (!cached) cached = buildModel();
  return cached;
}

export function periodWeeksOf(w: number): number[] {
  const f = fiscalOfWeek(w);
  const sp = periodSpan(f.fy, f.period);
  const out: number[] = [];
  for (let x = sp.startWeek; x <= sp.endWeek; x++) out.push(x);
  return out;
}
