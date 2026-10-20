/**
 * Memoised aggregations behind each tab. All rates are computed in kpis.ts as
 * ratios of the totals assembled here.
 */
import { fiscalOfWeek, globalWeek, LAST_COMPLETE_WEEK, weekOfDay } from '../data/calendar';
import {
  budgetGp,
  cellBaseLoss,
  cellLoss,
  cellLossUpperBound,
  EXTREME_ENTRY_DOLLARS,
  getModel,
  NC,
  ND,
  NI,
  NS,
  NW,
  periodWeeksOf,
  purchaseFractions,
  RETAIL_LOSS_FACTOR,
  type LossEvent,
  type Model,
} from '../data/generate';
import { CATS, DEPTS, estimatedCompositeCost, ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import {
  freshGpPct,
  highLossFlag,
  likelyEntryError,
  netCostPerUnit,
  PURCHASE_CHANNELS,
  type CostElement,
  type LossBasis,
  type LossRule,
  type PurchaseBreakdown,
  type Uom,
} from './kpis';
import { itemIndices, storeIndices, type FilterState, type ResolvedRange } from './filters';

// ---------------------------------------------------------------- Memo

function memo<T>(cache: Map<string, T>, key: string, make: () => T, max = 40): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = make();
  if (cache.size >= max) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
  return v;
}

// ---------------------------------------------------------------- Scope

export interface Scope {
  range: ResolvedRange;
  items: number[];
  itemMask: Uint8Array;
  stores: number[];
  storeMask: Uint8Array;
  productKey: string;
  storeKey: string;
  flagged: 'excl' | 'incl';
  rule: LossRule;
}

export function buildScope(s: FilterState, range: ResolvedRange, opts: { onlyDepts?: number[]; deptOnly?: boolean } = {}): Scope {
  const product = opts.deptOnly ? { dept: s.dept, cat: -1, sub: -1, item: -1 } : s;
  const items = itemIndices(product, opts.onlyDepts);
  const stores = storeIndices(s, range);
  const itemMask = new Uint8Array(NI);
  for (const i of items) itemMask[i] = 1;
  const storeMask = new Uint8Array(NS);
  for (const x of stores) storeMask[x] = 1;
  return {
    range,
    items,
    itemMask,
    stores,
    storeMask,
    productKey: `${product.dept}|${product.cat}|${product.sub}|${product.item}|${opts.onlyDepts?.join('.') ?? ''}`,
    storeKey: stores.length === NS ? 'all' : stores.join('.'),
    flagged: s.flagged,
    rule: s.rule,
  };
}

// ---------------------------------------------------------------- Store share per store set

interface ShareSet {
  /** cat × week share of chain sales held by the store set. */
  sales: Float32Array;
  /** cat × week share of chain known loss held by the store set (0 where a store has not posted). */
  loss: Float32Array;
}
const shareCache = new Map<string, ShareSet>();

function shareSet(scope: Scope): ShareSet {
  return memo(shareCache, scope.storeKey, () => {
    const m = getModel();
    const sales = new Float32Array(NC * NW);
    const loss = new Float32Array(NC * NW);
    for (let c = 0; c < NC; c++) {
      for (const s of scope.stores) {
        const lf = STORES[s].lossFactor;
        const base = (c * NS + s) * NW;
        for (let w = 0; w < NW; w++) {
          const v = m.share[base + w];
          if (v === 0) continue;
          sales[c * NW + w] += v;
          if (m.lossPosted[s * NW + w]) loss[c * NW + w] += v * lf;
        }
      }
      for (let w = 0; w < NW; w++) {
        const t = m.shareTot[c * NW + w];
        sales[c * NW + w] = t > 0 ? sales[c * NW + w] / t : 0;
        const lt = m.lossTot[c * NW + w];
        loss[c * NW + w] = lt > 0 ? loss[c * NW + w] / lt : 0;
      }
    }
    return { sales, loss };
  });
}

/** Share of one store in a cat-week (sales, loss). */
function storeShare(m: Model, c: number, s: number, w: number): [number, number] {
  const v = m.share[(c * NS + s) * NW + w];
  if (v === 0) return [0, 0];
  const t = m.shareTot[c * NW + w];
  const lt = m.lossTot[c * NW + w];
  return [t > 0 ? v / t : 0, lt > 0 && m.lossPosted[s * NW + w] ? (v * STORES[s].lossFactor) / lt : 0];
}

// ---------------------------------------------------------------- Loss flags

export interface FlagHit {
  item: number;
  store: number;
  week: number;
  cost: number;
  units: number;
  avgCost: number;
  avgUnits: number;
  ratio: number;
  entryError: boolean;
  extreme: boolean;
}

const flagCache = new Map<string, FlagHit[]>();

function history26(m: Model, i: number, s: number, w: number): { cost: number; units: number; n: number } {
  let cost = 0;
  let units = 0;
  let n = 0;
  for (let x = Math.max(0, w - 26); x < w; x++) {
    const c = cellLoss(m, i, s, x);
    cost += c.cost;
    units += c.units;
    n++;
  }
  return { cost: n ? cost / n : 0, units: n ? units / n : 0, n };
}

/** Flags in scope for the weeks [w0, w1] under the rule. Evaluates every event plus any baseline cell that could reach the $ threshold. */
export function findFlags(scope: Scope, w0 = scope.range.startWeek, w1 = scope.range.endWeek): FlagHit[] {
  const key = `${scope.productKey}#${scope.storeKey}#${w0}-${w1}#${scope.rule.dollars}-${scope.rule.pct}`;
  return memo(flagCache, key, () => {
    const m = getModel();
    const hits: FlagHit[] = [];
    const consider = (i: number, s: number, w: number) => {
      const c = cellLoss(m, i, s, w);
      if (c.cost <= scope.rule.dollars) return;
      const h = history26(m, i, s, w);
      if (h.n < 4) return;
      if (!highLossFlag(c.cost, h.cost, scope.rule)) return;
      hits.push({
        item: i,
        store: s,
        week: w,
        cost: c.cost,
        units: c.units,
        avgCost: h.cost,
        avgUnits: h.units,
        ratio: h.cost > 0 ? c.cost / h.cost : Infinity,
        entryError: likelyEntryError(c.units, h.units),
        extreme: c.cost > EXTREME_ENTRY_DOLLARS,
      });
    };
    for (const e of m.events) {
      if (e.week < w0 || e.week > w1 || !scope.itemMask[e.item] || !scope.storeMask[e.store]) continue;
      consider(e.item, e.store, e.week);
    }
    // Baseline cells only matter when the $ threshold is low enough for ordinary weeks to reach it.
    for (const i of scope.items) {
      if (cellLossUpperBound(m, i, w0, w1) <= scope.rule.dollars) continue;
      for (const s of scope.stores) {
        for (let w = w0; w <= w1; w++) {
          if (m.eventIndex.has((i * NS + s) * NW + w)) continue;
          if (cellBaseLoss(m, i, s, w) > scope.rule.dollars) consider(i, s, w);
        }
      }
    }
    hits.sort((a, b) => b.cost - a.cost);
    return hits;
  });
}

function eventsInScope(scope: Scope, w0: number, w1: number): LossEvent[] {
  const m = getModel();
  return m.events.filter((e) => e.week >= w0 && e.week <= w1 && scope.itemMask[e.item] && scope.storeMask[e.store]);
}

/** Per item-week adjustment of the aggregate loss: + event deltas, − flagged cells when excluded. */
function lossAdjustments(scope: Scope, w0: number, w1: number): Map<number, number> {
  const m = getModel();
  const adj = new Map<number, number>();
  const add = (i: number, w: number, v: number) => {
    const k = i * NW + w;
    adj.set(k, (adj.get(k) ?? 0) + v);
  };
  for (const e of eventsInScope(scope, w0, w1)) add(e.item, e.week, e.lossCost - cellBaseLoss(m, e.item, e.store, e.week));
  if (scope.flagged === 'excl') for (const f of findFlags(scope, w0, w1)) add(f.item, f.week, -f.cost);
  return adj;
}

// ---------------------------------------------------------------- Shared row shape

export interface Agg {
  gross: number;
  net: number;
  ea: number;
  lb: number;
  cost: number;
  loss: number;
  lossRetail: number;
  lossUnits: number;
  donations: number;
  lyGross: number;
  lyNet: number;
  lyCost: number;
  lyLoss: number;
  lyLossRetail: number;
  flags: number;
}

export function emptyAgg(): Agg {
  return {
    gross: 0,
    net: 0,
    ea: 0,
    lb: 0,
    cost: 0,
    loss: 0,
    lossRetail: 0,
    lossUnits: 0,
    donations: 0,
    lyGross: 0,
    lyNet: 0,
    lyCost: 0,
    lyLoss: 0,
    lyLossRetail: 0,
    flags: 0,
  };
}

export function addAgg(into: Agg, a: Agg): void {
  for (const k in a) (into as unknown as Record<string, number>)[k] += (a as unknown as Record<string, number>)[k];
}

export function volumeOf(a: Agg, uom: Uom): number {
  return uom === 'ea' ? a.ea : a.lb;
}

// ---------------------------------------------------------------- Category-Item Summary

export interface ItemAgg extends Agg {
  item: number;
  flagReasons: string[];
}

/** Unit cost parts of one item-week. */
function costParts(m: Model, i: number, w: number) {
  const it = ITEMS[i];
  const po = m.poCost[i * NW + w];
  const list = po / (1 - it.tradeRate);
  const deal = m.dealOn[i * NW + w] === 1;
  return {
    list,
    trade: list * it.tradeRate,
    offInvoice: list * it.offInvoiceRate,
    deals: deal ? list * it.dealRate : 0,
    scanbacks: deal ? list * it.scanbackRate : 0,
    freight: list * it.freightRate,
  };
}

/** Day-level overlap of [a, b] with week w. */
function overlap(a: number, b: number, w: number): [number, number] {
  return [Math.max(a, w * 7), Math.min(b, w * 7 + 6, ND - 1)];
}

const itemCache = new Map<string, ItemAgg[]>();

export function itemAggregates(scope: Scope, costBasis: readonly CostElement[]): ItemAgg[] {
  const r = scope.range;
  const key = `${scope.productKey}#${scope.storeKey}#${r.start}-${r.end}#${costBasis.join('.')}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}`;
  return memo(itemCache, key, () => {
    const m = getModel();
    const sh = shareSet(scope);
    const w0 = weekOfDay(r.start);
    const w1 = weekOfDay(r.end);
    const lw0 = Math.min(w0, LAST_COMPLETE_WEEK);
    const lw1 = Math.min(w1, LAST_COMPLETE_WEEK);
    const adj = lossAdjustments(scope, lw0, lw1);
    const lyAdj = r.lyAvailable ? lossAdjustments(scope, lw0 - 52, lw1 - 52) : new Map<number, number>();
    const flags = findFlags(scope, lw0, lw1);
    const flagCount = new Map<number, number>();
    for (const f of flags) flagCount.set(f.item, (flagCount.get(f.item) ?? 0) + 1);
    const out: ItemAgg[] = [];
    for (const i of scope.items) {
      const it = ITEMS[i];
      const c = it.cat;
      const d = it.dept;
      const a = { ...emptyAgg(), item: i, flagReasons: [] as string[] };
      const run = (ly: boolean) => {
        const off = ly ? 52 : 0;
        const dayOff = ly ? 364 : 0;
        for (let w = w0; w <= w1; w++) {
          const wk = w - off;
          if (wk < 0) continue;
          const [da, db] = overlap(r.start, r.end, w);
          const full = db - da === 6;
          let s = 0;
          let u = 0;
          if (full) {
            s = m.sales[i * NW + wk];
            u = m.units[i * NW + wk];
          } else {
            for (let day = da - dayOff; day <= db - dayOff; day++) {
              s += m.dSales[i * ND + day];
              u += m.dUnits[i * ND + day];
            }
          }
          const f = sh.sales[c * NW + wk];
          const gross = s * f;
          const units = u * f;
          const net = gross * (1 - m.disc[d * NW + wk]);
          const unitCost = netCostPerUnit(costParts(m, i, wk), costBasis);
          const frac = (db - da + 1) / 7;
          const lossBase = m.lossCost[i * NW + wk] * sh.loss[c * NW + wk];
          const lossV = Math.max(0, (lossBase + ((ly ? lyAdj : adj).get(i * NW + wk) ?? 0)) * frac);
          if (ly) {
            a.lyGross += gross;
            a.lyNet += net;
            a.lyCost += units * unitCost;
            a.lyLoss += lossV;
            a.lyLossRetail += lossV * RETAIL_LOSS_FACTOR[d];
          } else {
            a.gross += gross;
            a.net += net;
            if (it.uom === 'ea') a.ea += units;
            else a.lb += units;
            a.cost += units * unitCost;
            a.loss += lossV;
            a.lossRetail += lossV * RETAIL_LOSS_FACTOR[d];
            const pc = m.poCost[i * NW + wk];
            a.lossUnits += pc > 0 ? lossV / pc : 0;
            a.donations += m.donations[i * NW + wk] * sh.sales[c * NW + wk] * frac;
          }
        }
      };
      run(false);
      if (r.lyAvailable) run(true);
      const nf = flagCount.get(i) ?? 0;
      if (nf > 0) a.flagReasons.push(`High loss ×${nf}`);
      if (it.composite && it.composite.ageMonths > 6) a.flagReasons.push('Stale cost');
      if (a.net > 0 && a.net - a.cost < 0) a.flagReasons.push('Negative margin');
      a.flags = a.flagReasons.length > 0 ? 1 : 0;
      out.push(a);
    }
    return out;
  });
}

// ---------------------------------------------------------------- Department-store-week sales and purchases

const catSalesCache = new Map<string, Float64Array>();

/** Chain sales by cat × week for the items in scope (or for whole categories). */
function catWeekSales(scope: Scope | null): Float64Array {
  return memo(catSalesCache, scope ? scope.productKey : 'all', () => {
    const m = getModel();
    const out = new Float64Array(NC * NW);
    for (let i = 0; i < NI; i++) {
      if (scope && !scope.itemMask[i]) continue;
      const c = ITEMS[i].cat;
      for (let w = 0; w < NW; w++) out[c * NW + w] += m.sales[i * NW + w];
    }
    return out;
  });
}

const catLossCache = new Map<string, Float64Array[]>();
/** Chain known loss at cost, donations and per-week loss units by cat × week for the items in scope. */
function catWeekLoss(scope: Scope): Float64Array[] {
  return memo(catLossCache, scope.productKey, () => {
    const m = getModel();
    const loss = new Float64Array(NC * NW);
    const don = new Float64Array(NC * NW);
    for (const i of scope.items) {
      const c = ITEMS[i].cat;
      for (let w = 0; w < NW; w++) {
        loss[c * NW + w] += m.lossCost[i * NW + w];
        don[c * NW + w] += m.donations[i * NW + w];
      }
    }
    return [loss, don];
  });
}

export interface StoreWeekFresh {
  sales: number;
  purchases: PurchaseBreakdown;
  budget: number;
}

const freshCache = new Map<string, Map<number, StoreWeekFresh[]>>();

/** Fresh Report inputs per store (index) per requested week, summed over the departments in scope. */
export function freshStoreWeeks(scope: Scope, depts: number[], weeks: number[]): Map<number, StoreWeekFresh[]> {
  const key = `${depts.join('.')}#${scope.storeKey}#${weeks.join('.')}`;
  return memo(freshCache, key, () => {
    const m = getModel();
    const cs = catWeekSales(null);
    const out = new Map<number, StoreWeekFresh[]>();
    const fr = {} as PurchaseBreakdown;
    for (const s of scope.stores) {
      const row: StoreWeekFresh[] = [];
      for (const w of weeks) {
        const cell: StoreWeekFresh = { sales: 0, purchases: zeroBreakdown(), budget: 0 };
        if (w >= 0 && w <= LAST_COMPLETE_WEEK) {
          for (const d of depts) {
            let ds = 0;
            for (const c of DEPTS[d].cats) {
              const [f] = storeShare(m, c, s, w);
              ds += cs[c * NW + w] * f;
            }
            if (ds <= 0) continue;
            purchaseFractions(d, s, w, fr);
            for (const ch of PURCHASE_CHANNELS) cell.purchases[ch] += ds * fr[ch];
            cell.sales += ds;
            cell.budget += ds * budgetGp(d, s, w);
          }
        }
        row.push(cell);
      }
      out.set(s, row);
    }
    return out;
  });
}

export function zeroBreakdown(): PurchaseBreakdown {
  const b = {} as PurchaseBreakdown;
  for (const c of PURCHASE_CHANNELS) b[c] = 0;
  return b;
}

export function addBreakdown(into: PurchaseBreakdown, b: PurchaseBreakdown): void {
  for (const c of PURCHASE_CHANNELS) into[c] += b[c];
}

/** Total purchases for departments over weeks (weekly source). */
export function purchasesTotal(scope: Scope, depts: number[], w0: number, w1: number): { sales: number; purchases: number } {
  const weeks: number[] = [];
  for (let w = w0; w <= Math.min(w1, LAST_COMPLETE_WEEK); w++) weeks.push(w);
  const data = freshStoreWeeks(scope, depts, weeks);
  let sales = 0;
  let purchases = 0;
  for (const row of data.values())
    for (const c of row) {
      sales += c.sales;
      for (const ch of PURCHASE_CHANNELS) purchases += c.purchases[ch];
    }
  return { sales, purchases };
}

// ---------------------------------------------------------------- Store loss (cat × store)

export interface StoreCatLoss {
  sales: number;
  loss: number;
  lossRetail: number;
  donations: number;
  lySales: number;
  lyLoss: number;
  lyLossRetail: number;
  flags: number;
}

const storeLossCache = new Map<string, Map<number, StoreCatLoss[]>>();

/** Known loss by store (index) and category (index into CATS) over the scope's complete weeks. */
export function storeCatLoss(scope: Scope): Map<number, StoreCatLoss[]> {
  const r = scope.range;
  const key = `${scope.productKey}#${scope.storeKey}#${r.startWeek}-${r.endWeek}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}`;
  return memo(storeLossCache, key, () => {
    const m = getModel();
    const cs = catWeekSales(scope);
    const [cl, cd] = catWeekLoss(scope);
    const out = new Map<number, StoreCatLoss[]>();
    for (const s of scope.stores) {
      const row: StoreCatLoss[] = [];
      for (let c = 0; c < NC; c++) {
        const v: StoreCatLoss = { sales: 0, loss: 0, lossRetail: 0, donations: 0, lySales: 0, lyLoss: 0, lyLossRetail: 0, flags: 0 };
        const rf = RETAIL_LOSS_FACTOR[CATS[c].dept];
        for (let w = r.startWeek; w <= r.endWeek; w++) {
          const [f, lf] = storeShare(m, c, s, w);
          v.sales += cs[c * NW + w] * f;
          v.loss += cl[c * NW + w] * lf;
          v.donations += cd[c * NW + w] * f;
          if (r.lyAvailable && w - 52 >= 0) {
            const [f2, lf2] = storeShare(m, c, s, w - 52);
            v.lySales += cs[c * NW + w - 52] * f2;
            v.lyLoss += cl[c * NW + w - 52] * lf2;
          }
        }
        v.lossRetail = v.loss * rf;
        v.lyLossRetail = v.lyLoss * rf;
        row.push(v);
      }
      out.set(s, row);
    }
    const applyEvents = (w0: number, w1: number, ly: boolean) => {
      for (const e of eventsInScope(scope, w0, w1)) {
        const row = out.get(e.store);
        if (!row) continue;
        const c = ITEMS[e.item].cat;
        const delta = e.lossCost - cellBaseLoss(m, e.item, e.store, e.week);
        const rf = RETAIL_LOSS_FACTOR[CATS[c].dept];
        if (ly) {
          row[c].lyLoss += delta;
          row[c].lyLossRetail += delta * rf;
        } else {
          row[c].loss += delta;
          row[c].lossRetail += delta * rf;
        }
      }
      for (const f of findFlags(scope, w0, w1)) {
        const row = out.get(f.store);
        if (!row) continue;
        const c = ITEMS[f.item].cat;
        const rf = RETAIL_LOSS_FACTOR[CATS[c].dept];
        if (!ly) row[c].flags += 1;
        if (scope.flagged !== 'excl') continue;
        if (ly) {
          row[c].lyLoss -= f.cost;
          row[c].lyLossRetail -= f.cost * rf;
        } else {
          row[c].loss -= f.cost;
          row[c].lossRetail -= f.cost * rf;
        }
      }
    };
    applyEvents(r.startWeek, r.endWeek, false);
    if (r.lyAvailable) applyEvents(r.startWeek - 52, r.endWeek - 52, true);
    for (const row of out.values())
      for (const v of row) {
        v.loss = Math.max(0, v.loss);
        v.lossRetail = Math.max(0, v.lossRetail);
        v.lyLoss = Math.max(0, v.lyLoss);
        v.lyLossRetail = Math.max(0, v.lyLossRetail);
      }
    return out;
  });
}

export interface TopLossItem {
  item: number;
  sales: number;
  loss: number;
  lossUnits: number;
  flags: number;
}

/** Top items by known loss for one store over the scope's weeks (cell level). */
export function topLossItems(scope: Scope, store: number, basis: LossBasis, n = 10): TopLossItem[] {
  const m = getModel();
  const r = scope.range;
  const flagged = new Set(findFlags(scope).filter((f) => f.store === store).map((f) => f.item * NW + f.week));
  const flagCount = new Map<number, number>();
  for (const k of flagged) flagCount.set(Math.floor(k / NW), (flagCount.get(Math.floor(k / NW)) ?? 0) + 1);
  const out: TopLossItem[] = [];
  for (const i of scope.items) {
    const c = ITEMS[i].cat;
    let loss = 0;
    let units = 0;
    let sales = 0;
    for (let w = r.startWeek; w <= r.endWeek; w++) {
      const [f] = storeShare(m, c, store, w);
      sales += m.sales[i * NW + w] * f;
      if (scope.flagged === 'excl' && flagged.has(i * NW + w)) continue;
      const cl = cellLoss(m, i, store, w);
      loss += cl.cost;
      units += cl.units;
    }
    if (basis === 'retail') loss *= RETAIL_LOSS_FACTOR[ITEMS[i].dept];
    out.push({ item: i, sales, loss, lossUnits: units, flags: flagCount.get(i) ?? 0 });
  }
  return out.sort((a, b) => b.loss - a.loss).slice(0, n);
}

// ---------------------------------------------------------------- Shrink Review

export interface ShrinkAgg {
  item: number;
  sales: number;
  ea: number;
  lb: number;
  lossUnitsEa: number;
  lossUnitsLb: number;
  loss: number;
  lossRetail: number;
  donations: number;
  salvage: number;
  recall: number;
  markdown: number;
  spark: Float64Array;
  flags: number;
}

const shrinkCache = new Map<string, ShrinkAgg[]>();
export const SPARK_WEEKS = 26;

export function shrinkAggregates(scope: Scope): ShrinkAgg[] {
  const r = scope.range;
  const key = `${scope.productKey}#${scope.storeKey}#${r.startWeek}-${r.endWeek}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}`;
  return memo(shrinkCache, key, () => {
    const m = getModel();
    const sh = shareSet(scope);
    const sp0 = r.endWeek - SPARK_WEEKS + 1;
    const lo = Math.min(r.startWeek, sp0);
    const adj = lossAdjustments(scope, Math.max(0, lo), r.endWeek);
    const flags = findFlags(scope);
    const flagCount = new Map<number, number>();
    for (const f of flags) flagCount.set(f.item, (flagCount.get(f.item) ?? 0) + 1);
    const out: ShrinkAgg[] = [];
    for (const i of scope.items) {
      const it = ITEMS[i];
      const c = it.cat;
      const a: ShrinkAgg = {
        item: i,
        sales: 0,
        ea: 0,
        lb: 0,
        lossUnitsEa: 0,
        lossUnitsLb: 0,
        loss: 0,
        lossRetail: 0,
        donations: 0,
        salvage: 0,
        recall: 0,
        markdown: 0,
        spark: new Float64Array(SPARK_WEEKS),
        flags: flagCount.get(i) ?? 0,
      };
      const weekLoss = (w: number) => {
        if (w < 0) return 0;
        return Math.max(0, m.lossCost[i * NW + w] * sh.loss[c * NW + w] + (adj.get(i * NW + w) ?? 0));
      };
      for (let w = r.startWeek; w <= r.endWeek; w++) {
        const k = i * NW + w;
        const f = sh.sales[c * NW + w];
        const units = m.units[k] * f;
        a.sales += m.sales[k] * f;
        const l = weekLoss(w);
        a.loss += l;
        const lu = m.poCost[k] > 0 ? l / m.poCost[k] : 0;
        if (it.uom === 'ea') {
          a.ea += units;
          a.lossUnitsEa += lu;
        } else {
          a.lb += units;
          a.lossUnitsLb += lu;
        }
        a.donations += m.donations[k] * f;
        a.salvage += m.salvage[k] * f;
        a.recall += m.recall[k] * f;
        a.markdown += m.markdown[k] * f;
      }
      a.lossRetail = a.loss * RETAIL_LOSS_FACTOR[it.dept];
      for (let n = 0; n < SPARK_WEEKS; n++) a.spark[n] = weekLoss(sp0 + n);
      out.push(a);
    }
    return out;
  });
}

// ---------------------------------------------------------------- PLU Cost Watch

export interface PluRow {
  item: number;
  components: number;
  currentCost: number;
  updatedLabel: string;
  ageMonths: number;
  estCost: number;
  units: number;
  impact: number;
  displayedMargin: number;
  estMargin: number;
}

export function pluRows(scope: Scope): PluRow[] {
  const m = getModel();
  const sh = shareSet(scope);
  const fy0 = globalWeek(fiscalOfWeek(LAST_COMPLETE_WEEK).fy, 1);
  const out: PluRow[] = [];
  for (const i of scope.items) {
    const it = ITEMS[i];
    if (!it.composite) continue;
    const comp = it.composite;
    let units = 0;
    let net = 0;
    for (let w = fy0; w < NW; w++) {
      const f = sh.sales[it.cat * NW + w];
      units += m.units[i * NW + w] * f;
      net += m.sales[i * NW + w] * f * (1 - m.disc[it.dept * NW + w]);
    }
    const est = estimatedCompositeCost(comp);
    const netPrice = units > 0 ? net / units : 0;
    out.push({
      item: i,
      components: comp.components.length,
      currentCost: comp.standardCost,
      updatedLabel: comp.updatedLabel,
      ageMonths: comp.ageMonths,
      estCost: est,
      units,
      impact: (est - comp.standardCost) * units,
      displayedMargin: netPrice > 0 ? 1 - comp.standardCost / netPrice : 0,
      estMargin: netPrice > 0 ? 1 - est / netPrice : 0,
    });
  }
  return out.sort((a, b) => b.impact - a.impact);
}

// ---------------------------------------------------------------- Misc

export function periodWeeks(range: ResolvedRange): number[] {
  return periodWeeksOf(range.endWeek);
}

export function gpOf(c: { sales: number; purchases: PurchaseBreakdown }): number | null {
  let p = 0;
  for (const ch of PURCHASE_CHANNELS) p += c.purchases[ch];
  return freshGpPct(c.sales, p);
}

// ---------------------------------------------------------------- Weekly series for charts

/** Weeks shown in trend charts: the range itself (at most 52 weeks), or the 13 weeks ending at it when shorter. */
export function trendWeeks(range: ResolvedRange): number[] {
  const end = range.endWeek;
  const start = Math.max(0, Math.max(end - 51, Math.min(range.startWeek, end - 12)));
  const out: number[] = [];
  for (let w = start; w <= end; w++) out.push(w);
  return out;
}

export interface MarginPoint {
  week: number;
  gross: number;
  net: number;
  cost: number;
  loss: number;
  lyNet: number | null;
  lyCost: number | null;
}

const marginCache = new Map<string, MarginPoint[]>();

/** Chain-or-store-set weekly net sales, cost at the selected basis and known loss, with last year. */
export function weeklyMargin(scope: Scope, costBasis: readonly CostElement[], weeks: number[]): MarginPoint[] {
  const key = `${scope.productKey}#${scope.storeKey}#${weeks[0]}-${weeks[weeks.length - 1]}#${costBasis.join('.')}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}`;
  return memo(marginCache, key, () => {
    const m = getModel();
    const sh = shareSet(scope);
    const adj = lossAdjustments(scope, weeks[0], weeks[weeks.length - 1]);
    return weeks.map((w) => {
      const p: MarginPoint = { week: w, gross: 0, net: 0, cost: 0, loss: 0, lyNet: w >= 52 ? 0 : null, lyCost: w >= 52 ? 0 : null };
      for (const i of scope.items) {
        const it = ITEMS[i];
        const c = it.cat;
        const k = i * NW + w;
        const f = sh.sales[c * NW + w];
        const g = m.sales[k] * f;
        p.gross += g;
        p.net += g * (1 - m.disc[it.dept * NW + w]);
        p.cost += m.units[k] * f * netCostPerUnit(costParts(m, i, w), costBasis);
        p.loss += Math.max(0, m.lossCost[k] * sh.loss[c * NW + w] + (adj.get(k) ?? 0));
        if (w >= 52) {
          const kl = k - 52;
          const fl = sh.sales[c * NW + w - 52];
          p.lyNet! += m.sales[kl] * fl * (1 - m.disc[it.dept * NW + w - 52]);
          p.lyCost! += m.units[kl] * fl * netCostPerUnit(costParts(m, i, w - 52), costBasis);
        }
      }
      return p;
    });
  });
}

/** Weekly known loss at cost for the scope, last year's same weeks alongside (both after flag handling). */
export function weeklyLoss(scope: Scope, weeks: number[]): { week: number; loss: number; ly: number | null; flags: number }[] {
  const m = getModel();
  const sh = shareSet(scope);
  const w0 = weeks[0];
  const w1 = weeks[weeks.length - 1];
  const adj = lossAdjustments(scope, w0, w1);
  const lyAdj = w0 - 52 >= 0 ? lossAdjustments(scope, w0 - 52, w1 - 52) : new Map<number, number>();
  const flagsByWeek = new Map<number, number>();
  for (const f of findFlags(scope, w0, w1)) flagsByWeek.set(f.week, (flagsByWeek.get(f.week) ?? 0) + 1);
  return weeks.map((w) => {
    let loss = 0;
    let ly = 0;
    for (const i of scope.items) {
      const c = ITEMS[i].cat;
      loss += Math.max(0, m.lossCost[i * NW + w] * sh.loss[c * NW + w] + (adj.get(i * NW + w) ?? 0));
      if (w >= 52) ly += Math.max(0, m.lossCost[i * NW + w - 52] * sh.loss[c * NW + w - 52] + (lyAdj.get(i * NW + w - 52) ?? 0));
    }
    return { week: w, loss, ly: w >= 52 ? ly : null, flags: flagsByWeek.get(w) ?? 0 };
  });
}
