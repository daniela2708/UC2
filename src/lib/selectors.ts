/**
 * Memoised aggregations behind each tab. All rates are computed in kpis.ts as
 * ratios of the totals assembled here.
 */
import { LAST_COMPLETE_WEEK, weekOfDay } from '../data/calendar';
import { hash01 } from '../data/prng';
import {
  budgetGp,
  cellBaseLoss,
  cellLoss,
  cellLossUpperBound,
  EXTREME_ENTRY_DOLLARS,
  getModel,
  NC,
  NDP,
  PURCHASE_LEAD,
  purchaseTiming,
  ND,
  NI,
  NS,
  NW,
  periodWeeksOf,
  purchaseFractions,
  dsdFraction,
  RETAIL_LOSS_FACTOR,
  type LossEvent,
  type Model,
} from '../data/generate';
import { CATS, DEPTS, ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import {
  freshGpPct,
  highLossFlag,
  inNewItemWindow,
  likelyEntryError,
  weeksOnSale,
  netCostPerUnit,
  PURCHASE_CHANNELS,
  type CostElement,
  type LossBasis,
  type LossRule,
  type PurchaseBreakdown,
  type PurchaseChannel,
  type Uom,
} from './kpis';
import { itemIndices, storeIndices, type CostSource, type FilterState, type ResolvedRange } from './filters';
import { hqUnitCostWeek, poCostFromWeek, poTotals, poUnitCostWeek } from '../data/purchasing';

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

export function buildScope(
  s: FilterState,
  range: ResolvedRange,
  opts: { onlyDepts?: number[]; deptOnly?: boolean; noItem?: boolean } = {},
): Scope {
  const product = opts.deptOnly ? { dept: s.dept, cat: -1, sub: -1, item: -1 } : opts.noItem ? { ...s, item: -1 } : s;
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
    productKey: `${product.dept}|${product.cat}|${product.sub}|${product.item}|${'costType' in product ? product.costType : 'all'}|${opts.onlyDepts?.join('.') ?? ''}`,
    storeKey: stores.length === NS ? 'all' : stores.join('.'),
    flagged: s.flagged,
    rule: s.rule,
  };
}

// ---------------------------------------------------------------- Store share per store set

interface ShareSet {
  /** cat × week share of chain sales held by the store set. */
  sales: Float64Array;
  /** cat × week share of chain known loss held by the store set (0 where a store has not posted). */
  loss: Float64Array;
}
const shareCache = new Map<string, ShareSet>();

function shareSet(scope: Scope): ShareSet {
  return memo(shareCache, scope.storeKey, () => {
    const m = getModel();
    const sales = new Float64Array(NC * NW);
    const loss = new Float64Array(NC * NW);
    for (let c = 0; c < NC; c++) {
      const dept = CATS[c].dept;
      for (const s of scope.stores) {
        const lf = STORES[s].lossFactor * m.storeDeptLoss[s * NDP + dept];
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
  const lf = STORES[s].lossFactor * m.storeDeptLoss[s * NDP + CATS[c].dept];
  return [t > 0 ? v / t : 0, lt > 0 && m.lossPosted[s * NW + w] ? (v * lf) / lt : 0];
}

/**
 * Known loss of one item-store-week as the store split gives it (item loss × the store's loss share). Loss events
 * replace this value, so a store's loss with an event is exactly the event, and an excluded entry leaves 0.
 */
function shareCellLoss(m: Model, i: number, s: number, w: number): number {
  return m.lossCost[i * NW + w] * storeShare(m, ITEMS[i].cat, s, w)[1];
}

/** Planted item-store-week sales corrections summed over the store set: units and gross sales. */
function scopeSalesAdj(m: Model, stores: number[], i: number, w: number): { u: number; g: number } {
  const a = m.salesAdjIndex.get(i * NW + w);
  if (!a) return { u: 0, g: 0 };
  let u = 0;
  for (const s of stores) u += a.units[s];
  return { u, g: u * a.price };
}

/** Sales corrections for one store-week across a department's items (all items, or those in the mask). */
function deptSalesAdj(m: Model, d: number, s: number, w: number, mask: Uint8Array | null) {
  const out = { g: 0, net: 0, ea: 0, lb: 0, gEa: 0, gLb: 0, cogs: 0 };
  for (const a of m.salesAdj) {
    if (a.week !== w || ITEMS[a.item].dept !== d || (mask && !mask[a.item])) continue;
    const u = a.units[s];
    const g = u * a.price;
    out.g += g;
    out.net += g * (1 - m.disc[d * NW + w]);
    out.cogs += u * poUnitCostWeek(a.item, w);
    if (ITEMS[a.item].uom === 'ea') {
      out.ea += u;
      out.gEa += g;
    } else {
      out.lb += u;
      out.gLb += g;
    }
  }
  return out;
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
  /** What the entry is when known: a keyed error, post-holiday overstock or an operational loss. */
  kind: 'entry' | 'overstock' | 'operational' | 'planted' | 'baseline';
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
/** Tier of a flag: "Likely entry error" (units > 20× typical, or above the plausibility cap) or "High loss to review". */
export function isEntryError(f: FlagHit): boolean {
  return f.entryError || f.extreme;
}

export function findFlags(scope: Scope, w0 = scope.range.startWeek, w1 = scope.range.endWeek): FlagHit[] {
  const key = `${scope.productKey}#${scope.storeKey}#${w0}-${w1}#${scope.rule.dollars}-${scope.rule.pct}-${scope.rule.avg}`;
  return memo(flagCache, key, () => {
    const m = getModel();
    const hits: FlagHit[] = [];
    const consider = (i: number, s: number, w: number) => {
      const c = cellLoss(m, i, s, w);
      if (c.cost <= scope.rule.dollars) return;
      const h = history26(m, i, s, w);
      if (scope.rule.avg && h.n < 4) return;
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
        kind: c.event?.kind ?? 'baseline',
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
  for (const e of eventsInScope(scope, w0, w1)) add(e.item, e.week, e.lossCost - shareCellLoss(m, e.item, e.store, e.week));
  // Excluding means leaving out likely entry errors; high loss to review is real loss and stays in.
  if (scope.flagged === 'excl') for (const f of findFlags(scope, w0, w1)) if (isEntryError(f)) add(f.item, f.week, -f.cost);
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
  /** Per unit of measure, so per-unit values never divide by mixed ea + lb totals. */
  grossEa: number;
  grossLb: number;
  netEa: number;
  netLb: number;
  costEa: number;
  costLb: number;
  /**
   * PO Cost / Unit numerator and denominator (period-based): PLU and random weight = PO spend ÷ volume purchased;
   * UPC = average cost × units sold; composite PLUs = recipe cost × units sold.
   */
  poEa: number;
  poLb: number;
  poUnitsEa: number;
  poUnitsLb: number;
  /** Total Purchases: PO spend (Biceps); UPC: source pending (open question 5); composite PLUs: production cost (recipe). */
  purch: number;
  purchEa: number;
  purchLb: number;
  lossUnitsEa: number;
  lossUnitsLb: number;
  /** Flagged item-store-weeks (High Loss Flag). */
  highFlags: number;
  /** Total Net Cost under the other cost source (PO ↔ HQ), to show what flipping the switch does. */
  costAlt: number;
  /** Flags in the "Likely entry error" tier. */
  errFlags: number;
  /** Volume purchased (UPC: shipped; composite PLUs: produced = sold + known loss), by unit of measure. */
  purchUnitsEa: number;
  purchUnitsLb: number;
  /** Items whose Total Purchases come from Biceps POs, a pending source (UPC) or the recipe (to note mixed sources). */
  srcPo: number;
  srcPending: number;
  srcRecipe: number;
  srcDsd: number;
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
    grossEa: 0,
    grossLb: 0,
    netEa: 0,
    netLb: 0,
    costEa: 0,
    costLb: 0,
    poEa: 0,
    poLb: 0,
    poUnitsEa: 0,
    poUnitsLb: 0,
    purch: 0,
    purchEa: 0,
    purchLb: 0,
    lossUnitsEa: 0,
    lossUnitsLb: 0,
    highFlags: 0,
    costAlt: 0,
    errFlags: 0,
    purchUnitsEa: 0,
    purchUnitsLb: 0,
    srcPo: 0,
    srcPending: 0,
    srcRecipe: 0,
    srcDsd: 0,
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
  /** Earliest week whose PO cost was carried into a week without purchases (−1 when none), for the "cost from W38" marker. */
  costFrom: number;
}

/** Where an item's Total Purchases come from. */
export type PurchaseSource = 'Biceps PO' | 'Source pending (open question 5)' | 'Recipe' | 'DSD receipt (HQ)';
export function purchaseSource(i: number): PurchaseSource {
  const it = ITEMS[i];
  return it.dsd ? 'DSD receipt (HQ)' : it.composite ? 'Recipe' : it.costType === 'UPC' ? 'Source pending (open question 5)' : 'Biceps PO';
}

/**
 * Unit cost parts of one item-week. The base cost comes from the cost source: real-time PO cost (landed, freight
 * included, so "freight billed separately" adds nothing) or the HQ Average Cost. UPC items always use the HQ Average Cost.
 */
function costParts(m: Model, i: number, w: number, source: CostSource = 'po') {
  const it = ITEMS[i];
  const useHq = source === 'hq' || it.costType === 'UPC';
  const po = useHq ? hqUnitCostWeek(i, w) : poUnitCostWeek(i, w);
  const list = po / (1 - it.tradeRate);
  const landed = !useHq && it.costType !== 'UPC';
  const deal = m.dealOn[i * NW + w] === 1;
  return {
    list,
    trade: list * it.tradeRate,
    offInvoice: list * it.offInvoiceRate,
    deals: deal ? list * it.dealRate : 0,
    scanbacks: deal ? list * it.scanbackRate : 0,
    freight: landed ? 0 : list * it.freightRate,
  };
}

/** Day-level overlap of [a, b] with week w. */
function overlap(a: number, b: number, w: number): [number, number] {
  return [Math.max(a, w * 7), Math.min(b, w * 7 + 6, ND - 1)];
}

const itemCache = new Map<string, ItemAgg[]>();

export function itemAggregates(scope: Scope, costBasis: readonly CostElement[], source: CostSource = 'po'): ItemAgg[] {
  const r = scope.range;
  const key = `${scope.productKey}#${scope.storeKey}#${r.start}-${r.end}#${costBasis.join('.')}#${source}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}-${scope.rule.avg}`;
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
    const errCount = new Map<number, number>();
    for (const f of flags) {
      const m2 = isEntryError(f) ? errCount : flagCount;
      m2.set(f.item, (m2.get(f.item) ?? 0) + 1);
    }
    const out: ItemAgg[] = [];
    for (const i of scope.items) {
      const it = ITEMS[i];
      const c = it.cat;
      const d = it.dept;
      const a: ItemAgg = { ...emptyAgg(), item: i, flagReasons: [], costFrom: -1 };
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
          const sAdj = scopeSalesAdj(m, scope.stores, i, wk);
          const wf = (db - da + 1) / 7;
          const gross = s * f + sAdj.g * wf;
          const units = u * f + sAdj.u * wf;
          const net = gross * (1 - m.disc[d * NW + wk]);
          const unitCost = netCostPerUnit(costParts(m, i, wk, source), costBasis);
          const altCost = netCostPerUnit(costParts(m, i, wk, source === 'po' ? 'hq' : 'po'), costBasis);
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
            const ea = it.uom === 'ea';
            const pc = m.poCost[i * NW + wk];
            const poUnit = poUnitCostWeek(i, wk);
            const lu = pc > 0 ? lossV / pc : 0;
            // The week in progress may still get its delivery, so only complete weeks count as "no purchases".
            if (units > 0 && wk <= LAST_COMPLETE_WEEK && source === 'po' && it.costType !== 'UPC' && !it.composite) {
              const from = poCostFromWeek(i, wk);
              if (from !== wk && (a.costFrom < 0 || from < a.costFrom)) a.costFrom = from;
            }
            // Total Purchases and volume purchased for the store set (chain POs × the stores' share of the category).
            let purch: number;
            let purchUnits: number;
            if (it.dsd) {
              purch = wk <= LAST_COMPLETE_WEEK ? dsdReceipts(scope, lw0, lw1).get(i)![wk] * frac : 0;
              purchUnits = poUnit > 0 ? purch / poUnit : 0;
            } else if (it.composite) {
              purchUnits = units + lu;
              purch = purchUnits * poUnit;
            } else {
              const t = poTotals(i, da, db);
              purch = t.spend * f;
              purchUnits = t.units * f;
            }
            const fromReceipts = it.dsd || !(it.composite || it.costType === 'UPC');
            const poNum = fromReceipts ? purch : units * poUnit;
            const poDen = fromReceipts ? purchUnits : units;
            a.gross += gross;
            a.net += net;
            a.cost += units * unitCost;
            a.costAlt += units * altCost;
            a.loss += lossV;
            a.lossRetail += lossV * RETAIL_LOSS_FACTOR[d];
            a.lossUnits += lu;
            a.purch += purch;
            a.donations += m.donations[i * NW + wk] * sh.sales[c * NW + wk] * frac;
            if (ea) {
              a.ea += units;
              a.grossEa += gross;
              a.netEa += net;
              a.costEa += units * unitCost;
              a.poEa += poNum;
              a.poUnitsEa += poDen;
              a.purchEa += purch;
              a.lossUnitsEa += lu;
              a.purchUnitsEa += purchUnits;
            } else {
              a.lb += units;
              a.grossLb += gross;
              a.netLb += net;
              a.costLb += units * unitCost;
              a.poLb += poNum;
              a.poUnitsLb += poDen;
              a.purchLb += purch;
              a.lossUnitsLb += lu;
              a.purchUnitsLb += purchUnits;
            }
          }
        }
      };
      run(false);
      if (r.lyAvailable) run(true);
      const src = purchaseSource(i);
      if (src === 'DSD receipt (HQ)') a.srcDsd = 1;
      else if (src === 'Recipe') a.srcRecipe = 1;
      else if (src === 'Source pending (open question 5)') a.srcPending = 1;
      else a.srcPo = 1;
      const nf = flagCount.get(i) ?? 0;
      const ne = errCount.get(i) ?? 0;
      a.highFlags = nf + ne;
      a.errFlags = ne;
      if (it.composite && it.composite.ageMonths > 6) a.flagReasons.push('Stale cost');
      if (a.net > 0 && a.net - a.cost < 0) a.flagReasons.push('Negative margin');
      a.flags = a.flagReasons.length > 0 || a.highFlags > 0 ? 1 : 0;
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

/** Merchandise channels: goods bought for resale, which item purchases reconcile to. */
export const MERCH_CHANNELS: PurchaseChannel[] = ['whse', 'dsd', 'reclaim', 'transfers', 'inTransit'];
const IS_MERCH = new Set<PurchaseChannel>(MERCH_CHANNELS);

const catCostCache = new Map<string, Float64Array>();
/**
 * Chain cost of goods (units × PO cost) plus known loss by cat × week for the items in scope (or all items).
 * This is the weight that allocates a department's merchandise purchases to categories and items.
 */
function catWeekCost(scope: Scope | null): Float64Array {
  return memo(catCostCache, scope ? scope.productKey : 'all', () => {
    const m = getModel();
    const out = new Float64Array(NC * NW);
    for (let i = 0; i < NI; i++) {
      if (scope && !scope.itemMask[i]) continue;
      const c = ITEMS[i].cat;
      for (let w = 0; w < NW; w++) out[c * NW + w] += itemCostWeight(m, i, w);
    }
    return out;
  });
}

/** Cost of goods sold at the landed PO cost, plus known loss, for one item-week. */
function itemCostRaw(m: Model, i: number, w: number): number {
  const k = i * NW + w;
  return m.units[k] * poUnitCostWeek(i, w) + m.lossCost[k];
}

/**
 * Allocation weight for one item-week. Stores buy ahead of selling, so the weight follows the same lead
 * as department purchases: part this week's cost of goods, part next week's (holiday stock goes to the items
 * that will sell it).
 */
function itemCostWeight(m: Model, i: number, w: number): number {
  const wn = w + 1 <= LAST_COMPLETE_WEEK ? w + 1 : w;
  return (1 - PURCHASE_LEAD) * itemCostRaw(m, i, w) + PURCHASE_LEAD * itemCostRaw(m, i, wn);
}

const catUnitsCache = new Map<string, Float64Array[]>();
/** Chain net sales and volume (ea, lb) by cat × week for the items in scope. */
function catWeekNetUnits(scope: Scope): Float64Array[] {
  return memo(catUnitsCache, scope.productKey, () => {
    const m = getModel();
    const net = new Float64Array(NC * NW);
    const ea = new Float64Array(NC * NW);
    const lb = new Float64Array(NC * NW);
    const gEa = new Float64Array(NC * NW);
    const gLb = new Float64Array(NC * NW);
    const cogs = new Float64Array(NC * NW);
    for (const i of scope.items) {
      const it = ITEMS[i];
      const c = it.cat;
      const vol = it.uom === 'ea' ? ea : lb;
      const g = it.uom === 'ea' ? gEa : gLb;
      for (let w = 0; w < NW; w++) {
        net[c * NW + w] += m.sales[i * NW + w] * (1 - m.disc[it.dept * NW + w]);
        vol[c * NW + w] += m.units[i * NW + w];
        g[c * NW + w] += m.sales[i * NW + w];
        cogs[c * NW + w] += m.units[i * NW + w] * poUnitCostWeek(i, w);
      }
    }
    return [net, ea, lb, gEa, gLb, cogs];
  });
}

/**
 * Department purchases for one store-week, by channel (the Fresh Report). Stores buy ahead of selling:
 * part of this week's buying is for next week's sales, with uneven deliveries. Returns the department's sales.
 */
/** Department sales for one store-week and the purchases it drives before channel fractions (buying ahead, timing). */
function deptStoreTimed(m: Model, cs: Float64Array, d: number, s: number, w: number): { ds: number; timed: number } {
  let ds = 0;
  let next = 0;
  // The in-progress week is not known yet, so next week's sales repeat this week's.
  const wn = w + 1 <= LAST_COMPLETE_WEEK ? w + 1 : w;
  for (const c of DEPTS[d].cats) {
    ds += cs[c * NW + w] * storeShare(m, c, s, w)[0];
    next += cs[c * NW + wn] * storeShare(m, c, s, wn)[0];
  }
  ds += deptSalesAdj(m, d, s, w, null).g;
  next += deptSalesAdj(m, d, s, wn, null).g;
  if (ds <= 0) return { ds: 0, timed: 0 };
  // Pre-holiday stocking is capped by backroom and cooler space: 1.8× this week's sales, 3.2× for Floral (Valentine's, Mother's Day).
  const cap = DEPTS[d].name === 'Floral' ? 3.2 : 1.8;
  return { ds, timed: ((1 - PURCHASE_LEAD) * ds + PURCHASE_LEAD * Math.min(next, ds * cap)) * purchaseTiming(d, s, w) };
}

function deptStoreWeek(m: Model, cs: Float64Array, d: number, s: number, w: number, fr: PurchaseBreakdown, out: PurchaseBreakdown): number {
  const { ds, timed } = deptStoreTimed(m, cs, d, s, w);
  if (ds <= 0) {
    for (const ch of PURCHASE_CHANNELS) out[ch] = 0;
    return 0;
  }
  purchaseFractions(d, s, w, fr);
  for (const ch of PURCHASE_CHANNELS) out[ch] = (ch === 'scanCredit' || ch === 'wcCredit' ? ds : timed) * fr[ch];
  return ds;
}

export interface StoreWeekFresh {
  sales: number;
  net: number;
  ea: number;
  lb: number;
  /** Gross sales of ea items and of lb items, for Average Retail Price per Unit by unit of measure. */
  gEa: number;
  gLb: number;
  /** Cost of the units sold at landed PO cost. */
  cogs: number;
  purchases: PurchaseBreakdown;
  budget: number;
}

function emptyFresh(): StoreWeekFresh {
  return { sales: 0, net: 0, ea: 0, lb: 0, gEa: 0, gLb: 0, cogs: 0, purchases: zeroBreakdown(), budget: 0 };
}

const freshCache = new Map<string, Map<number, StoreWeekFresh[]>>();

/**
 * Fresh Report inputs per store (index) per requested week, for the products in scope.
 * Department purchases are split to the selection: merchandise channels by the selection's share of
 * cost of goods plus loss, packaging, donations and credits by its share of sales. With whole departments
 * selected both shares are 1, so department figures are exactly the department purchases.
 */
export function freshStoreWeeks(scope: Scope, depts: number[], weeks: number[]): Map<number, StoreWeekFresh[]> {
  const key = `${depts.join('.')}#${scope.productKey}#${scope.storeKey}#${weeks.join('.')}`;
  return memo(freshCache, key, () => {
    const m = getModel();
    const csAll = catWeekSales(null);
    const ccAll = catWeekCost(null);
    const csSel = catWeekSales(scope);
    const ccSel = catWeekCost(scope);
    const [netSel, eaSel, lbSel, gEaSel, gLbSel, cogsSel] = catWeekNetUnits(scope);
    const out = new Map<number, StoreWeekFresh[]>();
    const fr = {} as PurchaseBreakdown;
    const dp = {} as PurchaseBreakdown;
    for (const s of scope.stores) {
      const row: StoreWeekFresh[] = [];
      for (const w of weeks) {
        const cell = emptyFresh();
        if (w >= 0 && w <= LAST_COMPLETE_WEEK) {
          for (const d of depts) {
            let selSales = 0;
            let selCost = 0;
            let allCost = 0;
            for (const c of DEPTS[d].cats) {
              const sh = storeShare(m, c, s, w)[0];
              if (sh === 0) continue;
              selSales += csSel[c * NW + w] * sh;
              selCost += ccSel[c * NW + w] * sh;
              allCost += ccAll[c * NW + w] * sh;
              cell.net += netSel[c * NW + w] * sh;
              cell.ea += eaSel[c * NW + w] * sh;
              cell.lb += lbSel[c * NW + w] * sh;
              cell.gEa += gEaSel[c * NW + w] * sh;
              cell.gLb += gLbSel[c * NW + w] * sh;
              cell.cogs += cogsSel[c * NW + w] * sh;
            }
            const adj = deptSalesAdj(m, d, s, w, scope.itemMask);
            selSales += adj.g;
            cell.net += adj.net;
            cell.ea += adj.ea;
            cell.lb += adj.lb;
            cell.gEa += adj.gEa;
            cell.gLb += adj.gLb;
            cell.cogs += adj.cogs;
            if (selSales <= 0) continue;
            const ds = deptStoreWeek(m, csAll, d, s, w, fr, dp);
            if (ds <= 0) continue;
            const merchShare = allCost > 0 ? selCost / allCost : 0;
            const salesShare = selSales / ds;
            for (const ch of PURCHASE_CHANNELS) cell.purchases[ch] += dp[ch] * (IS_MERCH.has(ch) ? merchShare : salesShare);
            cell.sales += selSales;
            cell.budget += selSales * budgetGp(d, s, w);
          }
        }
        row.push(cell);
      }
      out.set(s, row);
    }
    return out;
  });
}

const dsdCache = new Map<string, Map<number, Float64Array>>();

/**
 * DSD receipts (Retalix HQ) by item and week for the store set. Each department-store-week's DSD purchases (the
 * Fresh Report DSD line) are split across the department's DSD items by their cost of goods sold in that store,
 * so a department's DSD items add up exactly to its Fresh Report DSD purchases.
 */
export function dsdReceipts(scope: Scope, w0: number, w1: number): Map<number, Float64Array> {
  const key = `${scope.storeKey}#${w0}-${w1}`;
  return memo(dsdCache, key, () => {
    const m = getModel();
    const csAll = catWeekSales(null);
    const out = new Map<number, Float64Array>();
    const byDept = DEPTS.map((d) => ITEMS.filter((it) => it.dsd && it.dept === d.idx).map((it) => it.idx));
    for (const list of byDept) for (const i of list) out.set(i, new Float64Array(NW));
    for (let w = Math.max(0, w0); w <= Math.min(w1, LAST_COMPLETE_WEEK); w++) {
      byDept.forEach((list, d) => {
        if (!list.length) return;
        const cats = [...new Set(list.map((i) => ITEMS[i].cat))];
        const catOf = list.map((i) => cats.indexOf(ITEMS[i].cat));
        const chain = list.map((i) => m.units[i * NW + w] * poUnitCostWeek(i, w));
        const unitCost = list.map((i) => poUnitCostWeek(i, w));
        const adj = list.map((i) => m.salesAdjIndex.get(i * NW + w));
        const chainTot = chain.reduce((x, y) => x + y, 0);
        const f = new Float64Array(cats.length);
        const wts = new Float64Array(list.length);
        for (const s of scope.stores) {
          const { ds, timed } = deptStoreTimed(m, csAll, d, s, w);
          if (ds <= 0) continue;
          const dsd = timed * dsdFraction(d, s, w);
          for (let c = 0; c < cats.length; c++) f[c] = storeShare(m, cats[c], s, w)[0];
          let tot = 0;
          for (let k = 0; k < list.length; k++) {
            const a = adj[k];
            const v = a ? Math.max(0, chain[k] * f[catOf[k]] + a.units[s] * unitCost[k]) : chain[k] * f[catOf[k]];
            wts[k] = v;
            tot += v;
          }
          // A store that sold none of them that week still receives: split by the chain's mix, or evenly.
          for (let k = 0; k < list.length; k++) {
            const share = tot > 0 ? wts[k] / tot : chainTot > 0 ? chain[k] / chainTot : 1 / list.length;
            out.get(list[k])![w] += dsd * share;
          }
        }
      });
    }
    return out;
  }, 12);
}

/** Delivery days and their share of a store-department's weekly purchases (2–3 deliveries a week). */
export function deliveryShare(d: number, s: number, dow: number): number {
  const patterns: [number, number][][] = [
    [[1, 0.4], [3, 0.35], [5, 0.25]],
    [[2, 0.55], [5, 0.45]],
    [[1, 0.35], [4, 0.4], [6, 0.25]],
    [[2, 0.4], [4, 0.3], [6, 0.3]],
  ];
  const p = patterns[Math.floor(hash01(d, STORES[s].id, 720) * patterns.length)];
  return p.find(([x]) => x === dow)?.[1] ?? 0;
}

const catDayCache = new Map<string, Float64Array[]>();
/** Chain gross sales, net sales and volume by cat × day for the items in scope. */
function catDaySales(scope: Scope): Float64Array[] {
  return memo(catDayCache, scope.productKey, () => {
    const m = getModel();
    const g = new Float64Array(NC * ND);
    const n = new Float64Array(NC * ND);
    const ea = new Float64Array(NC * ND);
    const lb = new Float64Array(NC * ND);
    const gEa = new Float64Array(NC * ND);
    for (const i of scope.items) {
      const it = ITEMS[i];
      const c = it.cat;
      const vol = it.uom === 'ea' ? ea : lb;
      for (let day = 0; day < ND; day++) {
        const v = m.dSales[i * ND + day];
        g[c * ND + day] += v;
        if (it.uom === 'ea') gEa[c * ND + day] += v;
        n[c * ND + day] += v * (1 - m.disc[it.dept * NW + Math.floor(day / 7)]);
        vol[c * ND + day] += m.dUnits[i * ND + day];
      }
    }
    return [g, n, ea, lb, gEa];
  });
}

/**
 * Fresh Report by day: sales as they ring, purchases as they are received on delivery days.
 * Daily gross profit swings because purchases do not line up with sales; weeks add back up to the weekly figures.
 */
export function freshStoreDays(scope: Scope, depts: number[], days: number[]): Map<number, StoreWeekFresh[]> {
  const key = `${depts.join('.')}#${scope.productKey}#${scope.storeKey}#d${days.join('.')}`;
  return memo(freshCache, key, () => {
    const [g, n, ea, lb, gEa] = catDaySales(scope);
    const m = getModel();
    const out = new Map<number, StoreWeekFresh[]>();
    const fr = {} as PurchaseBreakdown;
    const dp = {} as PurchaseBreakdown;
    const csAll = catWeekSales(null);
    const ccAll = catWeekCost(null);
    const ccSel = catWeekCost(scope);
    const csSel = catWeekSales(scope);
    for (const s of scope.stores) {
      const row: StoreWeekFresh[] = [];
      for (const day of days) {
        const cell = emptyFresh();
        const w = Math.floor(day / 7);
        for (const d of depts) {
          let daySales = 0;
          let weekSales = 0;
          let selCost = 0;
          let allCost = 0;
          for (const c of DEPTS[d].cats) {
            const sh = storeShare(m, c, s, Math.min(w, NW - 1))[0];
            if (sh === 0) continue;
            daySales += g[c * ND + day] * sh;
            cell.net += n[c * ND + day] * sh;
            cell.ea += ea[c * ND + day] * sh;
            cell.lb += lb[c * ND + day] * sh;
            cell.gEa += gEa[c * ND + day] * sh;
            cell.gLb += (g[c * ND + day] - gEa[c * ND + day]) * sh;
            if (w <= LAST_COMPLETE_WEEK) {
              weekSales += csSel[c * NW + w] * sh;
              selCost += ccSel[c * NW + w] * sh;
              allCost += ccAll[c * NW + w] * sh;
            }
          }
          // Planted sales corrections ring on the days the item sells.
          for (const a of m.salesAdj) {
            if (a.week !== w || ITEMS[a.item].dept !== d || !scope.itemMask[a.item]) continue;
            const wk = m.sales[a.item * NW + w];
            const part = wk > 0 ? m.dSales[a.item * ND + day] / wk : 0;
            const u = a.units[s] * part;
            const g = u * a.price;
            daySales += g;
            cell.net += g * (1 - m.disc[d * NW + w]);
            if (ITEMS[a.item].uom === 'ea') {
              cell.ea += u;
              cell.gEa += g;
            } else {
              cell.lb += u;
              cell.gLb += g;
            }
            if (w <= LAST_COMPLETE_WEEK) weekSales += a.units[s] * a.price;
          }
          cell.sales += daySales;
          if (w > LAST_COMPLETE_WEEK || weekSales <= 0) continue;
          const ds = deptStoreWeek(m, csAll, d, s, w, fr, dp);
          if (ds <= 0) continue;
          cell.budget += daySales * budgetGp(d, s, w);
          const merchShare = allCost > 0 ? selCost / allCost : 0;
          const salesShare = weekSales / ds;
          const delivered = deliveryShare(d, s, day % 7);
          const rung = daySales / weekSales;
          // Merchandise and packaging arrive on delivery days; donations and credits post with the day's sales.
          for (const ch of PURCHASE_CHANNELS)
            cell.purchases[ch] += dp[ch] * (IS_MERCH.has(ch) ? merchShare : salesShare) * (IS_MERCH.has(ch) || ch === 'packaging' ? delivered : rung);
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
  const key = `${scope.productKey}#${scope.storeKey}#${r.startWeek}-${r.endWeek}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}-${scope.rule.avg}`;
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
        const delta = e.lossCost - shareCellLoss(m, e.item, e.store, e.week);
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
        if (scope.flagged !== 'excl' || !isEntryError(f)) continue;
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
  const flagged = new Set(findFlags(scope).filter((f) => f.store === store && isEntryError(f)).map((f) => f.item * NW + f.week));
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
  const key = `${scope.productKey}#${scope.storeKey}#${r.startWeek}-${r.endWeek}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}-${scope.rule.avg}`;
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
        const sAdj = scopeSalesAdj(m, scope.stores, i, w);
        const units = m.units[k] * f + sAdj.u;
        a.sales += m.sales[k] * f + sAdj.g;
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
  lyGross: number | null;
  lyNet: number | null;
  lyCost: number | null;
}

const marginCache = new Map<string, MarginPoint[]>();

/** Chain-or-store-set weekly net sales, cost at the selected basis and known loss, with last year. */
export function weeklyMargin(scope: Scope, costBasis: readonly CostElement[], weeks: number[], source: CostSource = 'po'): MarginPoint[] {
  const key = `${scope.productKey}#${scope.storeKey}#${weeks[0]}-${weeks[weeks.length - 1]}#${costBasis.join('.')}#${source}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}-${scope.rule.avg}`;
  return memo(marginCache, key, () => {
    const m = getModel();
    const sh = shareSet(scope);
    const adj = lossAdjustments(scope, weeks[0], weeks[weeks.length - 1]);
    return weeks.map((w) => {
      const p: MarginPoint = { week: w, gross: 0, net: 0, cost: 0, loss: 0, lyGross: w >= 52 ? 0 : null, lyNet: w >= 52 ? 0 : null, lyCost: w >= 52 ? 0 : null };
      for (const i of scope.items) {
        const it = ITEMS[i];
        const c = it.cat;
        const k = i * NW + w;
        const f = sh.sales[c * NW + w];
        const sAdj = scopeSalesAdj(m, scope.stores, i, w);
        const g = m.sales[k] * f + sAdj.g;
        p.gross += g;
        p.net += g * (1 - m.disc[it.dept * NW + w]);
        p.cost += (m.units[k] * f + sAdj.u) * netCostPerUnit(costParts(m, i, w, source), costBasis);
        p.loss += Math.max(0, m.lossCost[k] * sh.loss[c * NW + w] + (adj.get(k) ?? 0));
        if (w >= 52) {
          const kl = k - 52;
          const fl = sh.sales[c * NW + w - 52];
          const la = scopeSalesAdj(m, scope.stores, i, w - 52);
          p.lyGross! += m.sales[kl] * fl + la.g;
          p.lyNet! += (m.sales[kl] * fl + la.g) * (1 - m.disc[it.dept * NW + w - 52]);
          p.lyCost! += (m.units[kl] * fl + la.u) * netCostPerUnit(costParts(m, i, w - 52, source), costBasis);
        }
      }
      return p;
    });
  });
}


// ---------------------------------------------------------------- Item store drill-down

export interface ItemStoreRow {
  store: number;
  unitsSold: number;
  unitsScannedOut: number;
  loss: number;
  errFlags: number;
  reviewFlags: number;
}

/** Stores for one item over the scope's complete weeks: units sold, units scanned out (known loss) and loss $. */
export function itemStores(scope: Scope, item: number): ItemStoreRow[] {
  const m = getModel();
  const r = scope.range;
  const c = ITEMS[item].cat;
  const flags = findFlags(scope).filter((f) => f.item === item);
  const out: ItemStoreRow[] = [];
  for (const s of scope.stores) {
    const row: ItemStoreRow = { store: s, unitsSold: 0, unitsScannedOut: 0, loss: 0, errFlags: 0, reviewFlags: 0 };
    for (let w = r.startWeek; w <= r.endWeek; w++) {
      const [f] = storeShare(m, c, s, w);
      row.unitsSold += m.units[item * NW + w] * f + (m.salesAdjIndex.get(item * NW + w)?.units[s] ?? 0);
      const cl = cellLoss(m, item, s, w);
      row.unitsScannedOut += cl.units;
      row.loss += cl.cost;
    }
    for (const fl of flags)
      if (fl.store === s) {
        if (isEntryError(fl)) row.errFlags++;
        else row.reviewFlags++;
      }
    if (row.unitsSold > 0 || row.unitsScannedOut > 0) out.push(row);
  }
  return out.sort((a, b) => b.loss - a.loss);
}

// ---------------------------------------------------------------- Known Loss Report: stores

export interface StoreKnownLoss {
  store: number;
  gross: number;
  ea: number;
  lb: number;
  loss: number;
  lossUnitsEa: number;
  lossUnitsLb: number;
  /** High Loss Flags (item-store-weeks above $1,000) and how many carry the "Likely entry error" label. */
  flags: number;
  errFlags: number;
}

const klCache = new Map<string, StoreKnownLoss[]>();

/**
 * Known Loss Report store table (KL1011 by store) for the items in scope, or for one SKU. Built on the same
 * store shares and loss adjustments as itemAggregates, so the store rows add up to the item table.
 */
export function storeKnownLoss(scope: Scope, item = -1): StoreKnownLoss[] {
  const r = scope.range;
  const key = `${scope.productKey}#${scope.storeKey}#${r.start}-${r.end}#${item}#${scope.flagged}#${scope.rule.dollars}-${scope.rule.pct}-${scope.rule.avg}`;
  return memo(klCache, key, () => {
    const m = getModel();
    const items = item >= 0 ? [item] : scope.items;
    const w0 = weekOfDay(r.start);
    const w1 = weekOfDay(r.end);
    const lw0 = Math.min(w0, LAST_COMPLETE_WEEK);
    const lw1 = Math.min(w1, LAST_COMPLETE_WEEK);
    const frac = (w: number) => {
      const [da, db] = overlap(r.start, r.end, w);
      return (db - da + 1) / 7;
    };
    // Chain sums by cat × week over the range: sales, units ea, units lb, loss $, loss units ea, loss units lb.
    const K = 6;
    const cw = new Float64Array(NC * NW * K);
    const cats = new Set<number>();
    for (const i of items) {
      const it = ITEMS[i];
      const c = it.cat;
      const ea = it.uom === 'ea';
      cats.add(c);
      for (let w = w0; w <= w1; w++) {
        const [da, db] = overlap(r.start, r.end, w);
        let sv = 0;
        let u = 0;
        if (db - da === 6) {
          sv = m.sales[i * NW + w];
          u = m.units[i * NW + w];
        } else
          for (let day = da; day <= db; day++) {
            sv += m.dSales[i * ND + day];
            u += m.dUnits[i * ND + day];
          }
        const lc = m.lossCost[i * NW + w] * ((db - da + 1) / 7);
        const pc = m.poCost[i * NW + w];
        const o = (c * NW + w) * K;
        cw[o] += sv;
        cw[o + (ea ? 1 : 2)] += u;
        cw[o + 3] += lc;
        if (pc > 0) cw[o + (ea ? 4 : 5)] += lc / pc;
      }
    }
    const rows = new Map<number, StoreKnownLoss>();
    for (const s of scope.stores) {
      const row: StoreKnownLoss = { store: s, gross: 0, ea: 0, lb: 0, loss: 0, lossUnitsEa: 0, lossUnitsLb: 0, flags: 0, errFlags: 0 };
      for (const c of cats)
        for (let w = w0; w <= w1; w++) {
          const o = (c * NW + w) * K;
          if (cw[o] === 0 && cw[o + 3] === 0) continue;
          const [f, lf] = storeShare(m, c, s, w);
          row.gross += cw[o] * f;
          row.ea += cw[o + 1] * f;
          row.lb += cw[o + 2] * f;
          row.loss += cw[o + 3] * lf;
          row.lossUnitsEa += cw[o + 4] * lf;
          row.lossUnitsLb += cw[o + 5] * lf;
        }
      rows.set(s, row);
    }
    const addLoss = (i: number, s: number, w: number, cost: number) => {
      const row = rows.get(s);
      if (!row) return;
      const v = cost * frac(w);
      const pc = m.poCost[i * NW + w];
      row.loss += v;
      if (pc > 0) {
        if (ITEMS[i].uom === 'ea') row.lossUnitsEa += v / pc;
        else row.lossUnitsLb += v / pc;
      }
    };
    for (const e of eventsInScope(scope, lw0, lw1)) if (item < 0 || e.item === item) addLoss(e.item, e.store, e.week, e.lossCost - shareCellLoss(m, e.item, e.store, e.week));
    for (const f of findFlags(scope, lw0, lw1)) {
      if (item >= 0 && f.item !== item) continue;
      const row = rows.get(f.store);
      if (!row) continue;
      row.flags++;
      if (!isEntryError(f)) continue;
      row.errFlags++;
      if (scope.flagged === 'excl') addLoss(f.item, f.store, f.week, -f.cost);
    }
    for (const a of m.salesAdj) {
      if (a.week < w0 || a.week > w1 || (item >= 0 ? a.item !== item : !scope.itemMask[a.item])) continue;
      const wf = frac(a.week);
      const ea = ITEMS[a.item].uom === 'ea';
      for (const row of rows.values()) {
        const u = a.units[row.store] * wf;
        row.gross += u * a.price;
        if (ea) row.ea += u;
        else row.lb += u;
      }
    }
    const out: StoreKnownLoss[] = [];
    for (const row of rows.values()) {
      row.loss = Math.max(0, row.loss);
      row.lossUnitsEa = Math.max(0, row.lossUnitsEa);
      row.lossUnitsLb = Math.max(0, row.lossUnitsLb);
      if (row.gross > 0 || row.loss > 0) out.push(row);
    }
    return out.sort((a, b) => b.loss - a.loss);
  });
}

// ---------------------------------------------------------------- Known Loss Report: new items watch

export interface NewItemWeek {
  week: number;
  /** Volume sold in the item's unit of measure. */
  volume: number;
  sales: number;
  lossUnits: number;
  loss: number;
}

export interface NewItemRow {
  item: number;
  launchWeek: number;
  weeks: number;
  weekly: NewItemWeek[];
  volume: number;
  sales: number;
  lossUnits: number;
  loss: number;
}

/**
 * Items in their first 12 weeks since first sale (as of the scope's last complete week), with weekly volume sold,
 * sales, known loss units and $ for the store set. Mirrors the weekly KL1011 review the Deli team runs.
 */
export function newItemsWatch(scope: Scope): NewItemRow[] {
  const m = getModel();
  const sh = shareSet(scope);
  const end = Math.min(scope.range.endWeek, LAST_COMPLETE_WEEK);
  const adj = lossAdjustments(scope, Math.max(0, end - 12), end);
  const out: NewItemRow[] = [];
  for (const i of scope.items) {
    const it = ITEMS[i];
    if (it.launchWeek === undefined) continue;
    const weeks = weeksOnSale(it.launchWeek, end);
    if (!inNewItemWindow(weeks)) continue;
    const c = it.cat;
    const row: NewItemRow = { item: i, launchWeek: it.launchWeek, weeks, weekly: [], volume: 0, sales: 0, lossUnits: 0, loss: 0 };
    for (let w = it.launchWeek; w <= end; w++) {
      const k = i * NW + w;
      const sAdj = scopeSalesAdj(m, scope.stores, i, w);
      const f = sh.sales[c * NW + w];
      const loss = Math.max(0, m.lossCost[k] * sh.loss[c * NW + w] + (adj.get(k) ?? 0));
      const pc = m.poCost[k];
      const wk: NewItemWeek = { week: w, volume: m.units[k] * f + sAdj.u, sales: m.sales[k] * f + sAdj.g, lossUnits: pc > 0 ? loss / pc : 0, loss };
      row.weekly.push(wk);
      row.volume += wk.volume;
      row.sales += wk.sales;
      row.lossUnits += wk.lossUnits;
      row.loss += wk.loss;
    }
    out.push(row);
  }
  return out.sort((a, b) => a.launchWeek - b.launchWeek);
}
