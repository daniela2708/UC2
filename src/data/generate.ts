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
import { BASE_ITEM_COUNT, CATS, DEPTS, ingredientUnitCost, ITEMS, recipeCostAt, roundQty, type Item } from './products';
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
    if (tag === 'zz') {
      // Seasonal-only item (pie pumpkins): sells from Labor Day to Halloween, barely otherwise.
      if (woy < 35 || woy > 43) m *= 0.02;
    } else if (tag === 'xm') {
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

/** Loss runs high after holidays (unsold seasonal stock), around Valentine's for Floral and in summer heat for Produce. */
const LOSS_AFTER: [string, number[]][] = [
  //                Meat Produce Deli Bakery Seafood Floral
  ['thanksgiving', [1.5, 1.4, 1.4, 1.9, 1.3, 1.6]],
  ['christmasEve', [1.35, 1.3, 1.45, 1.6, 1.5, 1.5]],
  ['newYear', [1.2, 1.15, 1.3, 1.3, 1.3, 1.2]],
  ['valentinesDay', [1.0, 1.0, 1.0, 1.3, 1.15, 2.4]],
  ['easter', [1.4, 1.1, 1.2, 1.4, 1.1, 1.8]],
  ['mothersday', [1.0, 1.0, 1.0, 1.2, 1.0, 1.9]],
  ['july4', [1.3, 1.3, 1.15, 1.1, 1.0, 1.0]],
  ['memorial', [1.2, 1.2, 1.1, 1.05, 1.0, 1.2]],
  ['laborday', [1.2, 1.15, 1.1, 1.05, 1.0, 1.0]],
  ['halloween', [1.0, 1.05, 1.0, 1.5, 1.0, 1.1]],
];
const LOSS_SEASON = (() => {
  const raw = new Float64Array(NDP * NW);
  for (let d = 0; d < NDP; d++) {
    for (let w = 0; w < NW; w++) {
      let m = 1;
      for (const [h, mult] of LOSS_AFTER) if (w > 0 && HOLIDAY_SETS[h][w - 1]) m *= mult[d];
      if (d === 5 && HOLIDAY_SETS.valentinesDay[w]) m *= 1.4;
      if (d === 1) m *= 1 + 0.35 * bump(w % 52, 29, 8);
      if (d === 2) m *= 1 + 0.1 * bump(w % 52, 29, 8);
      if (d === 4) m *= 1 + 0.12 * bump(w % 52, 29, 7);
      raw[d * NW + w] = m;
    }
    let mean = 0;
    for (let w = 0; w < 52; w++) mean += raw[d * NW + w] / 52;
    for (let w = 0; w < NW; w++) raw[d * NW + w] /= mean;
  }
  return raw;
})();

/** Weeks right after a holiday, when unsold seasonal stock is written off. */
export const POST_HOLIDAY_WEEKS: number[] = (() => {
  const out = new Set<number>();
  for (const [h] of LOSS_AFTER)
    for (let w = 1; w < NW; w++) if (HOLIDAY_SETS[h][w - 1] && !HOLIDAY_SETS[h][w]) out.add(w);
  return [...out].sort((a, b) => a - b);
})();

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
  kind: 'entry' | 'operational' | 'overstock' | 'planted';
}

/**
 * Units sold moved between stores for one item-week, so a planted store-level story is part of the
 * item × store × week data. Per-store units add to zero, so chain totals do not change; every selector
 * that splits sales by store adds these units (valued at the item-week's average price).
 */
export interface SalesAdj {
  item: number;
  week: number;
  /** Units added to each store index (negative where taken away). */
  units: Float64Array;
  /** Chain average gross price per unit that week. */
  price: number;
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
  /** Item-store-week sales corrections (planted stories), by item × week. */
  salesAdj: SalesAdj[];
  salesAdjIndex: Map<number, SalesAdj>;
  /** item × store loss affinity. */
  lossAff: Float32Array;
  /** store × department loss propensity (handling, staffing, layout differ by store and department). */
  storeDeptLoss: Float32Array;
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
      // Launched items sell nothing before launch and ramp up over 4 weeks.
      const ramp = it.launchWeek === undefined ? 1 : w < it.launchWeek ? 0 : Math.min(1, 0.4 + 0.2 * (w - it.launchWeek));
      const v = ramp * it.weight * tagMultiplier(it, w) * (1 + 0.06 * hashNormal(it.idx, w, 103));
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
        if (w === 0) setRecipeQuantities(it, price * (1 - DISCOUNT[d]) * (1 - it.margin));
        const std = it.composite.standardCost;
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
        lossCost[k] = Math.max(0, weekSales * lossRate * LOSS_SEASON[d * NW + w] * (1 + 0.12 * hashNormal(i, w, 109)));
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
  const storeDeptLoss = new Float32Array(NS * NDP);
  // Each store's loss factor by department runs 0.6–1.6× (handling, staffing and layout differ).
  for (const st of STORES)
    for (let d = 0; d < NDP; d++) storeDeptLoss[st.idx * NDP + d] = (0.6 + 1.0 * hash01(st.id, d, 205)) / st.lossFactor;
  for (let c = 0; c < NC; c++) {
    const d = CATS[c].dept;
    for (const st of STORES) {
      const s = st.idx;
      const aff = st.size * Math.exp(0.12 * hashNormal(st.id, d, 201)) * Math.exp(0.15 * hashNormal(st.id, c, 202));
      for (let w = 0; w < NW; w++) {
        if (!isOpen(st, w)) continue;
        const ramp = st.openWeek > 0 ? Math.min(1, 0.6 + 0.05 * (w - st.openWeek)) : 1;
        const v = aff * ramp * (1 + 0.03 * hashNormal(c, s, w));
        share[(c * NS + s) * NW + w] = v;
        shareTot[c * NW + w] += v;
        lossTot[c * NW + w] += v * st.lossFactor * storeDeptLoss[s * NDP + d];
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
    salesAdj: [],
    salesAdjIndex: new Map(),
    lossAff,
    storeDeptLoss,
  };
  model.events = buildEvents(model);
  model.salesAdj = buildSalesAdj(model);
  for (const a of model.salesAdj) model.salesAdjIndex.set(a.item * NW + a.week, a);
  model.events.forEach((e, n) => model.eventIndex.set(cellKey(e.item, e.store, e.week), n));
  return model;
}

/**
 * Sets recipe quantities for recipes kept as cost shares (sized to the target cost, rounded the way a recipe
 * card is written), then the standard cost: the recipe at ingredient costs in the month it was last updated.
 */
function setRecipeQuantities(it: Item, targetCost: number): void {
  const c = it.composite!;
  for (const comp of c.components)
    if (comp.qty === 0 && comp.share > 0) comp.qty = roundQty((comp.share * targetCost) / ingredientUnitCost(comp.key, c.updatedWeek), comp.unit);
  c.standardCost = recipeCostAt(c, c.updatedWeek);
}

function buildSalesAdj(m: Model): SalesAdj[] {
  // Deli soup: store 116 sold a single unit in W40; the rest of that week's units sold in the other stores.
  const p = PLANTED.soup;
  const it = ITEMS.find((x) => x.name === p.item);
  const st = STORE_BY_ID.get(p.store);
  if (!it || !st) return [];
  const c = it.cat;
  const w = p.week;
  const tot = m.shareTot[c * NW + w];
  const chainUnits = m.units[it.idx * NW + w];
  if (tot <= 0 || chainUnits <= 0) return [];
  const f = (s: number) => m.share[(c * NS + s) * NW + w] / tot;
  const delta = p.unitsSold - chainUnits * f(st.idx);
  let others = 0;
  for (let s = 0; s < NS; s++) if (s !== st.idx) others += m.share[(c * NS + s) * NW + w];
  const units = new Float64Array(NS);
  for (let s = 0; s < NS; s++) units[s] = s === st.idx ? delta : others > 0 ? (-delta * m.share[(c * NS + s) * NW + w]) / others : 0;
  return [{ item: it.idx, week: w, units, price: m.sales[it.idx * NW + w] / chainUnits }];
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
    ((m.lossCost[i * NW + w] * sh * STORES[s].lossFactor * m.storeDeptLoss[s * NDP + ITEMS[i].dept]) / tot) * m.lossAff[i * NS + s] * (1 + 0.45 * hashSigned(i, s, w, 204))
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
    const v = m.share[(c * NS + s) * NW + Math.max(0, Math.min(w1, LAST_COMPLETE_WEEK, STORES[s].closeWeek - 1))] * 1.15 * STORES[s].lossFactor * m.storeDeptLoss[s * NDP + ITEMS[i].dept];
    if (v > maxShare) maxShare = v;
  }
  return maxRatio * maxShare * 1.25 * 1.45;
}

function buildEvents(m: Model): LossEvent[] {
  const events: LossEvent[] = [];
  const taken = new Set<number>();
  // Cumulative item weights by chain sales, for sampling.
  const cum = new Float64Array(BASE_ITEM_COUNT);
  let acc = 0;
  for (let i = 0; i < BASE_ITEM_COUNT; i++) {
    acc += BASE_WEEKLY[ITEMS[i].dept] * ITEMS[i].weight;
    cum[i] = acc;
  }
  const pick = (u: number) => {
    const target = u * acc;
    let lo = 0;
    let hi = BASE_ITEM_COUNT - 1;
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
    .slice(0, 60);
  const bigStores = STORES.filter((s) => s.size * s.lossFactor > 1.1).map((s) => s.idx);
  for (let w = 0; w <= LAST_COMPLETE_WEEK; w++) {
    const n = 4 + Math.floor(hash01(w, 301) * 4);
    for (let e = 0; e < n; e++) {
      // About 30 % of flags are keyed errors; the rest is real high loss to review.
      const entry = hash01(w, e, 304) < 0.28;
      let i = entry ? pick(hash01(w, e, 302)) : bigItems[Math.floor(hash01(w, e, 302) * bigItems.length)];
      let s = entry ? Math.floor(hash01(w, e, 303) * NS) : bigStores[Math.floor(hash01(w, e, 303) * bigStores.length)];
      let base = cellBaseLoss(m, i, s, w);
      // Operational losses (cooler failure, over-ordering) land where weekly loss is already material.
      for (let t = 1; !entry && base < 85 && t < 6; t++) {
        i = bigItems[Math.floor(hash01(w, e, 302 + 10 * t) * bigItems.length)];
        s = bigStores[Math.floor(hash01(w, e, 303 + 10 * t) * bigStores.length)];
        base = cellBaseLoss(m, i, s, w);
      }
      if (base <= 0) continue;
      let factor = entry ? (hash01(w, e, 305) < 0.7 ? 10 : 100) : Math.min(14, Math.max(4, (1100 + 1500 * hash01(w, e, 306)) / base));
      if (!entry) {
        // Real high loss stays within 2.5–14× the item-store 26-week average, so it never reads as a keyed error.
        let hist = 0;
        let n = 0;
        for (let x = Math.max(0, w - 26); x < w; x++) {
          hist += cellBaseLoss(m, i, s, x);
          n++;
        }
        const avg = n ? hist / n : 0;
        if (avg <= 0) continue;
        const want = base * factor;
        if (want / avg > 14) factor = (14 * avg) / base;
        if ((base * factor) / avg < 2.5) continue;
      }
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
  // Post-holiday overstock: real, large write-offs of seasonal stock the week after a holiday.
  // Kept between 2.5× and 14× the item-store average, so the rule flags them without calling them entry errors.
  for (const w of POST_HOLIDAY_WEEKS) {
    if (w > LAST_COMPLETE_WEEK) continue;
    let made = 0;
    for (let tries = 0; tries < 120 && made < 10; tries++) {
      const i = bigItems[Math.floor(hash01(w, tries, 311) * bigItems.length)];
      const s = bigStores[Math.floor(hash01(w, tries, 312) * bigStores.length)];
      const key = cellKey(i, s, w);
      if (taken.has(key)) continue;
      let hist = 0;
      let n = 0;
      for (let x = Math.max(0, w - 26); x < w; x++) {
        hist += cellBaseLoss(m, i, s, x);
        n++;
      }
      if (n < 8 || hist <= 0) continue;
      const avg = hist / n;
      const want = 1150 + 1500 * hash01(w, tries, 313);
      if (want / avg < 2.5 || want / avg > 14) continue;
      taken.add(key);
      events.push({ item: i, store: s, week: w, lossCost: want, lossUnits: want / m.poCost[i * NW + w], kind: 'overstock' });
      made++;
    }
  }
  {
    const p = PLANTED.soup;
    const it = ITEMS.find((x) => x.name === p.item);
    const st = STORE_BY_ID.get(p.store);
    if (it && st) {
      const cost = p.lossUnits * m.poCost[it.idx * NW + p.week];
      events.push({ item: it.idx, store: st.idx, week: p.week, lossCost: cost, lossUnits: p.lossUnits, kind: 'planted' });
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
  whse: [0.69, 0.55, 0.46, 0.3, 0.66, 0.38],
  dsd: [0.03, 0.05, 0.07, 0.14, 0.04, 0.05],
  packaging: [0.012, 0.008, 0.03, 0.035, 0.01, 0.02],
  reclaim: [0.001, 0.001, 0.001, 0.001, 0.001, 0.0005],
  donations: [0.002, 0.006, 0.005, 0.02, 0.001, 0.003],
  wcCredit: [-0.004, -0.003, -0.002, -0.002, -0.002, -0.002],
  scanCredit: [-0.02, -0.006, -0.008, -0.004, -0.01, -0.002],
};
/** Week-to-week swing of in-transit timing (telescopes over a period), by department. */
const BUDGET_GP = [0.292, 0.361, 0.427, 0.513, 0.278, 0.4];
const SEAFOOD_SQUEEZE_WHSE = 0.026;

/** Purchases by channel as fractions of the department-store-week's sales. */
export function purchaseFractions(d: number, s: number, w: number, out: PurchaseBreakdown): PurchaseBreakdown {
  const st = STORES[s];
  const n = (salt: number) => hashNormal(d, st.id, w, salt);
  // District execution differs (shrink control, mix, DSD reliance), so some districts beat budget and others miss it.
  const dist = Number(st.district.slice(1));
  out.whse = PURCHASE_BASE.whse[d] + 0.011 + 0.014 * hashNormal(dist, 399) + 0.01 * hashNormal(d, dist, 400) + 0.008 * hashNormal(d, st.id, 401) + 0.004 * n(402);
  out.dsd = PURCHASE_BASE.dsd[d] * (1 + 0.15 * n(403));
  out.packaging = PURCHASE_BASE.packaging[d] * (1 + 0.1 * n(404));
  out.reclaim = PURCHASE_BASE.reclaim[d] * (1 + 0.5 * hash01(d, st.id, w, 405));
  out.transfers = 0.004 * n(406);
  out.inTransit = 0.002 * n(407);
  out.donations = PURCHASE_BASE.donations[d] * (0.7 + 0.6 * hash01(d, st.id, w, 408));
  out.wcCredit = PURCHASE_BASE.wcCredit[d] * (0.5 + hash01(d, st.id, w, 409));
  out.scanCredit = PURCHASE_BASE.scanCredit[d] * (0.8 + 0.4 * hash01(d, st.id, w, 410));
  if (d === 4 && w >= PLANTED.shrimpSqueeze.fromWeek) out.whse += SEAFOOD_SQUEEZE_WHSE;
  const o = PLANTED.storeOutlier;
  if (st.id === o.store && DEPTS[d].name === o.dept && w >= o.fromWeek && w <= o.toWeek) {
    out.dsd = o.dsdShare;
    out.whse = PURCHASE_BASE.whse[d] + 0.011 + o.whseLift;
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

/**
 * Purchase timing. Stores buy ahead of selling: about 55 % of a week's purchases are for next week's sales,
 * holidays are stocked the week before, and deliveries land unevenly (a chain-wide warehouse rhythm plus
 * store-level noise). Both noise terms telescope, so over a period purchases still match sales.
 */
const TIMING_CHAIN = [0.07, 0.055, 0.075, 0.07, 0.07, 0.2];
const TIMING_STORE = [0.12, 0.09, 0.1, 0.09, 0.11, 0.33];
export const PURCHASE_LEAD = 0.55;
export function purchaseTiming(d: number, s: number, w: number): number {
  const id = STORES[s].id;
  const o = PLANTED.storeOutlier;
  if (id === o.store && DEPTS[d].name === o.dept && w >= o.fromWeek && w <= o.toWeek) return 1;
  const chain = hashNormal(d, w, 0, 420) - hashNormal(d, w - 1, 0, 420);
  const store = hashNormal(d, id, w, 421) - hashNormal(d, id, w - 1, 421);
  return Math.max(0.2, 1 + 0.7 * (TIMING_CHAIN[d] * chain + TIMING_STORE[d] * store));
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
