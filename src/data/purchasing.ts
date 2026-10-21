/**
 * Purchasing model: vendors, case packs, freight, purchase orders (POs) and the default cost held in HQ.
 *
 * - PLU and random-weight items are bought from 1–3 vendors, 2–3 deliveries a week. Each PO line has
 *   cases, case pack, case cost and freight; the landed unit cost is (case cost + freight) ÷ case pack.
 * - HQ (Retalix) keeps one default cost per item, updated rarely (3–14 months ago) and without freight.
 * - UPC items come from the Weis distribution center; their HQ average cost tracks PO cost (reliable).
 * - Composite PLUs are costed from their recipe: HQ holds the Excel standard cost; the real-time cost
 *   re-prices every ingredient at its cost that week.
 * - PO Cost / Unit for a period (week or fiscal period) = total PO spend in the period ÷ volume purchased in
 *   the period. A period without purchases has no PO cost (a gap); margins then use the most recent PO cost.
 * Everything is derived from the seeded model, so it is deterministic.
 */
import { AS_OF_DAY, dayFromYMD, fiscalOfWeek, formatMonth, globalWeek, LAST_COMPLETE_WEEK, periodSpan, weekOfDay, weekday } from './calendar';
import { getModel, ND, NW } from './generate';
import { COMPONENTS, DEPTS, ingredientUnitCost, ITEMS, itemByName, recipeCostAt, type IngredientUnit, type Item } from './products';
import { hash01, hashNormal } from './prng';
import { periodPoCost } from '../lib/kpis';

export interface SupplyVendor {
  name: string;
  /** Share of the item's volume ordered from this vendor. */
  share: number;
  /** Price level relative to the market cost. */
  factor: number;
}

export interface ItemSupply {
  item: number;
  vendors: SupplyVendor[];
  /** Selling units per case (ea or lb). */
  casePack: number;
  caseLabel: string;
  /** Freight as a share of case cost (0 for UPC: delivered cost already includes it). */
  freightRate: number;
  /** Weekdays (0 = Sun) with deliveries. */
  deliveryDays: number[];
  /** Current PO Cost: the per-unit cost held in HQ / Retalix today. */
  hqCost: number;
  hqUpdatedDay: number;
  hqUpdatedLabel: string;
}

export interface PurchaseOrder {
  day: number;
  vendor: string;
  cases: number;
  casePack: number;
  caseCost: number;
  /** Freight per case. */
  freight: number;
  /** Landed cost per selling unit: (case cost + freight) ÷ case pack. */
  unitCost: number;
  units: number;
}

const VENDORS: Record<string, string[]> = {
  Meat: ['Blue Ridge Packing', 'Penn Valley Meats', 'Allegheny Provisions'],
  Produce: ['Susquehanna Valley Growers', 'Keystone Produce Co.', 'Lancaster County Farms', 'Garden State Fresh'],
  Deli: ['Mid-Atlantic Deli Supply', 'Keystone Provisions'],
  Bakery: ['Harvest Mill Supply', 'Weis Bakery Commissary'],
  Seafood: ['Chesapeake Fish Co.', 'Atlantic Seafood Supply', 'Bay Harbor Seafood'],
  Floral: ['Mid-Atlantic Floral', 'Blue Mountain Growers'],
};
const DC = 'Weis Distribution Center';

/** Typical case packs (selling units per case) by department, for lb and ea items. */
const PACK_LB = [[10, 15, 20, 40], [20, 25, 40, 40], [10, 12, 20], [10, 20], [10, 10, 25], [10, 20]];
const PACK_EA = [[6, 12, 12], [12, 18, 24, 36], [6, 8, 12], [6, 12, 12], [6, 12], [6, 10, 12]];

/** Planted purchasing stories. */
export const PURCHASING_STORIES = {
  roma: {
    item: 'Roma Tomatoes',
    casePack: 25,
    mainVendor: 'Susquehanna Valley Growers',
    /** Case cost from the Produce category manager: $19.95 normally, a glut in W35, a spike in W36, then back to normal. */
    caseNormal: 19.95,
    caseByWeek: new Map<number, number>([
      [globalWeek(2026, 35), 4.95],
      [globalWeek(2026, 36), 44.95],
      [globalWeek(2026, 37), 32.95],
      [globalWeek(2026, 38), 24.95],
    ]),
    /** The second vendor charges $1.00 more per case and moves with the market. */
    otherVendorPremium: 1,
    glutWeek: globalWeek(2026, 35),
    spikeWeek: globalWeek(2026, 36),
    hqCase: 19.45,
    hqUpdated: [2025, 11] as [number, number],
  },
  pumpkins: {
    item: 'Pie Pumpkins',
    casePack: 80,
    hqCase: 150,
    seasonCase: 250,
    normalCase: 152,
    seasonFrom: globalWeek(2026, 36),
    // Season runs from Labor Day through the last complete week, so New PO Cost reads $250 at the as-of date.
    seasonTo: globalWeek(2026, 42),
    hqUpdated: [2025, 8] as [number, number],
  },
};

const supplyCache = new Map<number, ItemSupply>();

/** Items whose cost fell after HQ was last updated (end of season, falling commodity costs). */
export function costFellSinceHq(i: number): boolean {
  return ITEMS[i].costType !== 'UPC' && !ITEMS[i].composite && hash01(i, 713) < FELL_SHARE;
}
const FELL_SHARE = 0.2;

export function supplyOf(i: number): ItemSupply {
  const hit = supplyCache.get(i);
  if (hit) return hit;
  const it = ITEMS[i];
  const m = getModel();
  const deptName = DEPTS[it.dept].name;
  let vendors: SupplyVendor[];
  let casePack: number;
  let caseLabel: string;
  let freightRate: number;
  if (it.costType === 'UPC') {
    vendors = [{ name: DC, share: 1, factor: 1 }];
    const packs = PACK_EA[it.dept];
    casePack = packs[Math.floor(hash01(i, 701) * packs.length)];
    caseLabel = `Case of ${casePack}`;
    freightRate = 0;
  } else {
    const pool = VENDORS[deptName];
    const n = Math.min(pool.length, 1 + Math.floor(hash01(i, 702) * 3));
    const start = Math.floor(hash01(i, 703) * pool.length);
    const raw = Array.from({ length: n }, (_, k) => 0.4 + hash01(i, k, 704));
    const tot = raw.reduce((a, b) => a + b, 0);
    vendors = raw.map((r, k) => ({ name: pool[(start + k) % pool.length], share: r / tot, factor: 0.96 + 0.08 * hash01(i, k, 705) }));
    const packs = it.uom === 'lb' ? PACK_LB[it.dept] : PACK_EA[it.dept];
    casePack = packs[Math.floor(hash01(i, 706) * packs.length)];
    caseLabel = it.uom === 'lb' ? `${casePack} lb case` : `Case of ${casePack}`;
    freightRate = (deptName === 'Produce' ? 0.045 : 0.025) + 0.03 * hash01(i, 707);
  }
  // Delivery days: Mon/Wed/Fri or Tue/Fri, or Mon/Thu for slower items.
  const patterns = [[1, 3, 5], [2, 5], [1, 4], [1, 3, 5], [2, 4, 6]];
  const deliveryDays = patterns[Math.floor(hash01(i, 708) * patterns.length)];

  // HQ cost: UPC tracks the latest average cost; PLU / RW hold an old default without freight.
  let hqUpdatedDay: number;
  let hqCost: number;
  if (it.costType === 'UPC') {
    hqUpdatedDay = AS_OF_DAY - weekday(AS_OF_DAY);
    hqCost = m.poCost[i * NW + LAST_COMPLETE_WEEK];
  } else if (it.composite) {
    hqUpdatedDay = it.composite.updatedWeek * 7;
    hqCost = it.composite.standardCost;
  } else {
    const monthsAgo = 3 + Math.floor(hash01(i, 709) * 12);
    const y = 2026 - (monthsAgo >= 10 ? 1 : 0);
    const mo = ((10 - monthsAgo - 1 + 24) % 12) + 1;
    hqUpdatedDay = dayFromYMD(y, mo, 1);
    const w = weekOfDay(hqUpdatedDay);
    let c = 0;
    for (let x = w - 2; x <= w + 1; x++) c += m.poCost[i * NW + Math.max(0, Math.min(LAST_COMPLETE_WEEK, x))] / 4;
    // Some HQ costs were set at a seasonal or commodity high that has since come down, so POs now cost less.
    hqCost = c * (costFellSinceHq(i) ? 1.1 + 0.1 * hash01(i, 714) : 1);
  }
  const s: ItemSupply = {
    item: i,
    vendors,
    casePack,
    caseLabel,
    freightRate,
    deliveryDays,
    hqCost,
    hqUpdatedDay,
    hqUpdatedLabel: it.composite ? it.composite.updatedLabel : formatMonth(hqUpdatedDay),
  };
  // Planted stories.
  if (it.name === PURCHASING_STORIES.roma.item) {
    const r = PURCHASING_STORIES.roma;
    s.casePack = r.casePack;
    s.caseLabel = `${r.casePack} lb case`;
    s.vendors = [
      { name: r.mainVendor, share: 0.7, factor: 1 },
      { name: 'Keystone Produce Co.', share: 0.3, factor: 1 },
    ];
    s.hqUpdatedDay = dayFromYMD(r.hqUpdated[0], r.hqUpdated[1], 1);
    s.hqUpdatedLabel = formatMonth(s.hqUpdatedDay);
    s.hqCost = r.hqCase / r.casePack;
  }
  if (it.name === PURCHASING_STORIES.pumpkins.item) {
    const p = PURCHASING_STORIES.pumpkins;
    s.casePack = p.casePack;
    s.caseLabel = `Bin of ${p.casePack}`;
    s.vendors = [{ name: 'Lancaster County Farms', share: 1, factor: 1 }];
    s.freightRate = 0;
    s.hqUpdatedDay = dayFromYMD(p.hqUpdated[0], p.hqUpdated[1], 1);
    s.hqUpdatedLabel = formatMonth(s.hqUpdatedDay);
    s.hqCost = p.hqCase / p.casePack;
  }
  supplyCache.set(i, s);
  return s;
}

/** Case cost (before freight) from one vendor on one day. */
export function caseCostFor(it: Item, sup: ItemSupply, v: number, day: number): number {
  const w = Math.min(weekOfDay(day), NW - 1);
  const r = PURCHASING_STORIES.roma;
  if (it.name === r.item) return (r.caseByWeek.get(w) ?? r.caseNormal) + (v === 0 ? 0 : r.otherVendorPremium);
  const p = PURCHASING_STORIES.pumpkins;
  if (it.name === p.item) return w >= p.seasonFrom && w <= p.seasonTo ? p.seasonCase : p.normalCase;
  const unit = getModel().poCost[it.idx * NW + w] * sup.vendors[v].factor * (1 + 0.015 * hashNormal(it.idx, v, day, 710));
  return Math.round(unit * sup.casePack * 100) / 100;
}

/** Units the chain uses on a day: units sold plus that week's known loss units spread over the week. */
function unitsUsed(i: number, day: number): number {
  const m = getModel();
  const d = Math.min(day, ND - 1);
  const w = Math.min(weekOfDay(d), LAST_COMPLETE_WEEK);
  const pc = m.poCost[i * NW + w];
  return m.dUnits[i * ND + d] + (pc > 0 ? m.lossCost[i * NW + w] / pc / 7 : 0);
}

/**
 * Calls `cb` for every chain-level PO line of an item, oldest first, through the as-of date. Stores reorder up to
 * par: on each delivery day the order covers use until the next delivery plus a safety stock, less what is on
 * hand, in whole cases. So stock never runs out, and slow items with large cases skip deliveries (weeks without
 * purchases). Composite PLUs are made in store (no POs).
 */
function forEachOrder(i: number, cb: (o: PurchaseOrder) => void): void {
  const it = ITEMS[i];
  if (it.composite) return;
  const sup = supplyOf(i);
  const main = sup.vendors.reduce((best, v, k) => (v.share > sup.vendors[best].share ? k : best), 0);
  // Opening stock: one week of use.
  let onHand = 0;
  for (let day = 0; day < 7; day++) onHand += unitsUsed(i, day);
  for (let day = 0; day <= AS_OF_DAY; day++) {
    const k = sup.deliveryDays.indexOf(weekday(day));
    if (k >= 0) {
      const nextDay = sup.deliveryDays[(k + 1) % sup.deliveryDays.length];
      const span = (nextDay - sup.deliveryDays[k] + 7) % 7 || 7;
      let need = 0;
      for (let x = day; x < day + span; x++) need += unitsUsed(i, x);
      const target = need * (1.12 + 0.12 * hash01(i, day, 711));
      const order = target - onHand;
      if (need > 0 && order > 0) {
        // Smaller vendors do not ship every delivery day; the main vendor covers their share.
        const shares = sup.vendors.map((v, j) => (j !== main && v.share < 0.3 && hash01(i, day, j, 712) > 0.6 ? 0 : v.share));
        shares[main] += 1 - shares.reduce((x, y) => x + y, 0);
        sup.vendors.forEach((v, j) => {
          if (shares[j] <= 0) return;
          const cases = Math.ceil((order * shares[j]) / sup.casePack);
          if (cases <= 0) return;
          const cc = caseCostFor(it, sup, j, day);
          const freight = Math.round(cc * sup.freightRate * 100) / 100;
          onHand += cases * sup.casePack;
          cb({ day, vendor: v.name, cases, casePack: sup.casePack, caseCost: cc, freight, unitCost: (cc + freight) / sup.casePack, units: cases * sup.casePack });
        });
      }
    }
    onHand -= unitsUsed(i, day);
  }
}

const orderCache = new Map<number, PurchaseOrder[]>();

/** Every chain-level PO line for an item (UPC: Weis Distribution Center shipments to stores), oldest first. Cached per item. */
export function ordersOf(i: number): PurchaseOrder[] {
  const hit = orderCache.get(i);
  if (hit) return hit;
  const out: PurchaseOrder[] = [];
  forEachOrder(i, (o) => out.push(o));
  if (orderCache.size > 60) orderCache.delete(orderCache.keys().next().value as number);
  orderCache.set(i, out);
  return out;
}

// ---------------------------------------------------------------- Daily PO spend and volume (Biceps)

let daily: { spend: Float32Array; units: Float32Array } | null = null;

/** PO spend (landed $) and volume purchased per item × day, for every item. UPC: bill-out at average cost. */
function dailyPo(): { spend: Float32Array; units: Float32Array } {
  if (daily) return daily;
  const spend = new Float32Array(ITEMS.length * ND);
  const units = new Float32Array(ITEMS.length * ND);
  for (const it of ITEMS)
    forEachOrder(it.idx, (o) => {
      const k = it.idx * ND + Math.min(o.day, ND - 1);
      spend[k] += (o.caseCost + o.freight) * o.cases;
      units[k] += o.units;
    });
  daily = { spend, units };
  return daily;
}

/** PO spend and volume purchased for one item over the days [d0, d1] (chain). */
export function poTotals(i: number, d0: number, d1: number): { spend: number; units: number } {
  const { spend, units } = dailyPo();
  let sp = 0;
  let u = 0;
  for (let day = Math.max(0, d0); day <= Math.min(d1, ND - 1); day++) {
    sp += spend[i * ND + day];
    u += units[i * ND + day];
  }
  return { spend: sp, units: u };
}

/** Period-based PO Cost / Unit over [d0, d1]: PO spend ÷ volume purchased; null when nothing was bought. */
export function poCostForDays(i: number, d0: number, d1: number): number | null {
  const t = poTotals(i, d0, d1);
  return periodPoCost(t.spend, t.units);
}

export interface NewPoCost {
  cost: number | null;
  /** Week the cost comes from (the last complete week, or the latest earlier week with purchases). */
  week: number;
}

/**
 * New PO Cost (Cost Watch): period-based PO cost of the last complete week. When nothing was bought that week,
 * the latest earlier week with purchases ("as of W41"). Composite PLUs: the recipe at that week's ingredient costs.
 */
export function newPoCostInfo(i: number, endWeek = LAST_COMPLETE_WEEK): NewPoCost {
  const it = ITEMS[i];
  if (it.composite) return { cost: recipeCostAt(it.composite, endWeek), week: endWeek };
  for (let w = endWeek; w >= Math.max(0, endWeek - 52); w--) {
    const c = poCostForDays(i, w * 7, w * 7 + 6);
    if (c !== null) return { cost: c, week: w };
  }
  return { cost: null, week: endWeek };
}

export function newPoCost(i: number, endWeek = LAST_COMPLETE_WEEK): number | null {
  return newPoCostInfo(i, endWeek).cost;
}

/** Current PO Cost: the per-unit cost held in HQ / Retalix. */
export function currentPoCost(i: number): number {
  return supplyOf(i).hqCost;
}

/** Recipe cost of a composite PLU with every ingredient at its cost in week `w`. */
export function compositeCostAt(it: Item, w: number): number {
  return recipeCostAt(it.composite!, w);
}

export type CostPeriod = 'week' | 'period';

export interface CostPoint {
  /** First day of the bucket (the week's or the fiscal period's Sunday). */
  day: number;
  /** Last global week in the bucket. */
  week: number;
  /** Period-based PO Cost / Unit: PO spend ÷ volume purchased; null when nothing was bought (a gap). */
  cost: number | null;
  /** Current PO Cost (HQ) in force at the end of the bucket. */
  hq: number;
  /** Volume purchased (composite PLUs: units produced = sold + known loss units). */
  units: number;
  spend: number;
}

/**
 * PO Cost / Unit and volume purchased by fiscal week or fiscal period over the weeks [w0, w1].
 * Composite PLUs: recipe cost weighted by units produced.
 */
export function costSeries(i: number, w0: number, w1: number, grain: CostPeriod = 'week'): CostPoint[] {
  const it = ITEMS[i];
  const m = getModel();
  const buckets: { w0: number; w1: number }[] = [];
  for (let w = w0; w <= w1; ) {
    if (grain === 'week') {
      buckets.push({ w0: w, w1: w });
      w++;
    } else {
      const f = fiscalOfWeek(w);
      const pe = periodSpan(f.fy, f.period).endWeek;
      const end = Math.min(pe, w1);
      buckets.push({ w0: w, w1: end });
      w = end + 1;
    }
  }
  return buckets.map((b) => {
    let spend = 0;
    let units = 0;
    if (it.composite) {
      for (let w = b.w0; w <= b.w1; w++) {
        const pc = m.poCost[i * NW + w];
        const u = m.units[i * NW + w] + (pc > 0 ? m.lossCost[i * NW + w] / pc : 0);
        units += u;
        spend += u * recipeCostAt(it.composite, w);
      }
    } else {
      const t = poTotals(i, b.w0 * 7, b.w1 * 7 + 6);
      spend = t.spend;
      units = t.units;
    }
    return { day: b.w0 * 7, week: b.w1, cost: periodPoCost(spend, units), hq: hqUnitCostWeek(i, b.w1), units, spend };
  });
}

// ---------------------------------------------------------------- Recipe lines

export interface RecipeLine {
  key: string;
  name: string;
  qty: number;
  unit: IngredientUnit;
  discontinued: boolean;
  /** Ingredient cost per unit when the recipe was last costed (behind the Current PO Cost in HQ). */
  currentUnitCost: number;
  /** Ingredient cost per unit in week `w` (behind the New PO Cost). */
  newUnitCost: number;
  change: number;
  /** $ the ingredient adds to the PLU's cost change. */
  contribution: number;
}

/** Recipe lines of a composite PLU: quantity × ingredient cost when last costed vs in week `w`. */
export function recipeLines(it: Item, w = LAST_COMPLETE_WEEK): RecipeLine[] {
  const c = it.composite;
  if (!c) return [];
  return c.components.map((comp) => {
    const cur = ingredientUnitCost(comp.key, c.updatedWeek);
    const now = ingredientUnitCost(comp.key, w);
    return {
      key: comp.key,
      name: COMPONENTS[comp.key].name,
      qty: comp.qty,
      unit: comp.unit,
      discontinued: !!COMPONENTS[comp.key].discontinued,
      currentUnitCost: cur,
      newUnitCost: now,
      change: now / cur - 1,
      contribution: comp.qty * (now - cur),
    };
  });
}

/** Recomputes a PLU's cost from its recipe lines, optionally overriding one ingredient's unit cost. */
export function recipeCost(lines: RecipeLine[], override?: { key: string; unitCost: number }): number {
  let cost = 0;
  for (const l of lines) cost += l.qty * (override && override.key === l.key ? override.unitCost : l.newUnitCost);
  return cost;
}

export function pumpkinItem(): Item {
  return itemByName(PURCHASING_STORIES.pumpkins.item);
}
export function romaItem(): Item {
  return itemByName(PURCHASING_STORIES.roma.item);
}

// ---------------------------------------------------------------- Weekly unit cost by source (for margins)

let poWeekly: Float32Array | null = null;
let poFrom: Int16Array | null = null;
let hqWeekly: Float32Array | null = null;

/**
 * Weekly unit cost by source, for every item:
 * - PO (real-time): the week's period-based PO cost (PO spend ÷ volume purchased). A week without purchases
 *   carries the most recent PO cost forward, and `poCostFromWeek` says which week it came from.
 * - HQ: the default cost in HQ / Retalix in force that week (last update on or before the week, no freight).
 * UPC items use the average cost for both; composite PLUs use the recipe (that week's ingredients vs the Excel standard).
 */
function buildWeekly(): void {
  const m = getModel();
  const { spend, units } = dailyPo();
  const po = new Float32Array(ITEMS.length * NW);
  const from = new Int16Array(ITEMS.length * NW);
  const hq = new Float32Array(ITEMS.length * NW);
  for (const it of ITEMS) {
    const i = it.idx;
    const sup = supplyOf(i);
    const hqWeek = weekOfDay(sup.hqUpdatedDay);
    let last = -1;
    let lastCost = 0;
    for (let w = 0; w < NW; w++) {
      const k = i * NW + w;
      from[k] = w;
      if (it.costType === 'UPC') {
        po[k] = hq[k] = m.poCost[k];
        continue;
      }
      if (it.composite) {
        po[k] = recipeCostAt(it.composite, w);
        hq[k] = w >= it.composite.updatedWeek ? it.composite.standardCost : it.composite.standardCost * 0.94;
        continue;
      }
      let sp = 0;
      let u = 0;
      for (let day = w * 7; day <= Math.min(w * 7 + 6, ND - 1); day++) {
        sp += spend[i * ND + day];
        u += units[i * ND + day];
      }
      if (u > 0) {
        last = w;
        lastCost = sp / u;
        po[k] = lastCost;
      } else if (last >= 0) {
        po[k] = lastCost;
        from[k] = last;
      } else {
        // Before the first purchase on record: the vendor-weighted landed cost for that week.
        let landed = 0;
        sup.vendors.forEach((v, j) => {
          landed += (v.share * (caseCostFor(it, sup, j, w * 7 + 3) * (1 + sup.freightRate))) / sup.casePack;
        });
        po[k] = landed;
      }
      // HQ is refreshed about once a year: the value in force is the last update on or before this week.
      let hu = hqWeek;
      while (hu > w) hu -= 52;
      hq[k] = hu === hqWeek ? sup.hqCost : sup.hqCost * Math.pow(0.97, (hqWeek - hu) / 52);
    }
  }
  poWeekly = po;
  poFrom = from;
  hqWeekly = hq;
}

export function poUnitCostWeek(i: number, w: number): number {
  if (!poWeekly) buildWeekly();
  return poWeekly![i * NW + Math.max(0, Math.min(NW - 1, w))];
}

/** Week the PO cost used for week `w` comes from (equal to `w` unless nothing was bought that week). */
export function poCostFromWeek(i: number, w: number): number {
  if (!poFrom) buildWeekly();
  return poFrom![i * NW + Math.max(0, Math.min(NW - 1, w))];
}

export function hqUnitCostWeek(i: number, w: number): number {
  if (!hqWeekly) buildWeekly();
  return hqWeekly![i * NW + Math.max(0, Math.min(NW - 1, w))];
}
