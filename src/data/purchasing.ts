/**
 * Purchasing model: vendors, case packs, freight, purchase orders (POs) and the default cost held in HQ.
 *
 * - PLU and random-weight items are bought from 1–3 vendors, 2–3 deliveries a week. Each PO line has
 *   cases, case pack, case cost and freight; the landed unit cost is (case cost + freight) ÷ case pack.
 * - HQ (Retalix) keeps one default cost per item, updated rarely (3–14 months ago) and without freight.
 * - UPC items come from the Weis distribution center; their HQ average cost tracks PO cost (reliable).
 * - Composite PLUs are costed from their recipe: HQ holds the Excel standard cost; the real-time cost
 *   re-prices every component at today's component cost.
 * Everything is derived from the seeded model, so it is deterministic.
 */
import { AS_OF_DAY, dayFromYMD, formatMonth, globalWeek, LAST_COMPLETE_WEEK, weekOfDay, weekday } from './calendar';
import { getModel, ND, NW } from './generate';
import { componentIndex, COMPONENTS, DEPTS, ITEMS, itemByName, type Item } from './products';
import { hash01, hashNormal } from './prng';
import { newPoCostWeighted } from '../lib/kpis';

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
    caseBefore: 19.95,
    caseAfter: 44.95,
    otherVendorCase: 20.95,
    fromWeek: globalWeek(2026, 36),
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
    hqCost = c;
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
  if (it.name === r.item) return v === 0 ? (w >= r.fromWeek ? r.caseAfter : r.caseBefore) : r.otherVendorCase;
  const p = PURCHASING_STORIES.pumpkins;
  if (it.name === p.item) return w >= p.seasonFrom && w <= p.seasonTo ? p.seasonCase : p.normalCase;
  const unit = getModel().poCost[it.idx * NW + w] * sup.vendors[v].factor * (1 + 0.015 * hashNormal(it.idx, v, day, 710));
  return Math.round(unit * sup.casePack * 100) / 100;
}

/** Units the chain buys on a delivery day: next days' sales plus loss, with a little timing noise. */
function unitsOrdered(i: number, day: number, sup: ItemSupply): number {
  const m = getModel();
  const k = sup.deliveryDays.indexOf(weekday(day));
  const nextDay = sup.deliveryDays[(k + 1) % sup.deliveryDays.length];
  const span = ((nextDay - sup.deliveryDays[k] + 7) % 7) || 7;
  let units = 0;
  for (let x = day; x < day + span; x++) {
    const dd = Math.min(x, ND - 1);
    units += m.dUnits[i * ND + dd];
  }
  const w = Math.min(weekOfDay(day), LAST_COMPLETE_WEEK);
  const lossUnits = m.poCost[i * NW + w] > 0 ? m.lossCost[i * NW + w] / m.poCost[i * NW + w] : 0;
  units += (lossUnits * span) / 7;
  return Math.max(0, units * (1 + 0.08 * hashNormal(i, day, 711)));
}

const orderCache = new Map<number, PurchaseOrder[]>();

/** Every chain-level PO line for an item, oldest first, through the as-of date. Cached per item. */
export function ordersOf(i: number): PurchaseOrder[] {
  const hit = orderCache.get(i);
  if (hit) return hit;
  const it = ITEMS[i];
  const sup = supplyOf(i);
  const out: PurchaseOrder[] = [];
  if (!it.composite) {
    for (let day = 0; day <= AS_OF_DAY; day++) {
      if (!sup.deliveryDays.includes(weekday(day))) continue;
      const units = unitsOrdered(i, day, sup);
      if (units <= 0) continue;
      sup.vendors.forEach((v, k) => {
        // Smaller vendors do not ship every delivery day.
        if (v.share < 0.3 && hash01(i, day, k, 712) > 0.6) return;
        const cases = Math.max(1, Math.round((units * v.share) / sup.casePack));
        const cc = caseCostFor(it, sup, k, day);
        const freight = Math.round(cc * sup.freightRate * 100) / 100;
        out.push({
          day,
          vendor: v.name,
          cases,
          casePack: sup.casePack,
          caseCost: cc,
          freight,
          unitCost: (cc + freight) / sup.casePack,
          units: cases * sup.casePack,
        });
      });
    }
  }
  orderCache.set(i, out);
  return out;
}

/**
 * New PO Cost: recency-weighted landed cost of the last 4 weeks of orders ending on `endDay`.
 * Week k back (0 = newest) weighs PO_WEEK_WEIGHTS[k] × quantity. Composite PLUs use the recipe at today's
 * component costs. Null when nothing was bought.
 */
export function newPoCost(i: number, endDay = AS_OF_DAY): number | null {
  const it = ITEMS[i];
  if (it.composite) return compositeCostAt(it, weekOfDay(endDay));
  const lines = ordersOf(i)
    .filter((o) => o.day <= endDay && o.day > endDay - 28)
    .map((o) => ({ weeksBack: Math.floor((endDay - o.day) / 7), units: o.units, unitCost: o.unitCost }));
  return newPoCostWeighted(lines);
}

/** Current PO Cost: the per-unit cost held in HQ / Retalix. */
export function currentPoCost(i: number): number {
  return supplyOf(i).hqCost;
}

/** Recipe cost of a composite PLU with every component at its cost in week `w`. */
export function compositeCostAt(it: Item, w: number): number {
  const c = it.composite!;
  let cost = 0;
  for (const comp of c.components) cost += c.standardCost * comp.share * (componentIndex(comp.key, w) / componentIndex(comp.key, c.updatedWeek));
  return cost;
}

export interface CostPoint {
  /** First day of the bucket (a day, or a week's Sunday). */
  day: number;
  /** Quantity-weighted landed PO cost per unit, null when nothing was bought in the bucket. */
  cost: number | null;
  units: number;
  cases: number;
}

/**
 * Real-time PO cost and quantity purchased over [d0, d1] at day grain, or week grain when the range
 * is longer than 26 weeks. Composite PLUs: recipe cost by week, quantity = units sold (made to sell).
 */
export function costSeries(i: number, d0: number, d1: number): { grain: 'day' | 'week'; points: CostPoint[] } {
  const grain: 'day' | 'week' = d1 - d0 + 1 > 26 * 7 ? 'week' : 'day';
  const it = ITEMS[i];
  const m = getModel();
  const key = (day: number) => (grain === 'day' ? day : weekOfDay(day) * 7);
  const buckets = new Map<number, { num: number; units: number; cases: number }>();
  for (let day = d0; day <= d1; day += grain === 'day' ? 1 : 7) buckets.set(key(day), { num: 0, units: 0, cases: 0 });
  if (it.composite) {
    for (let day = d0; day <= d1; day++) {
      const b = buckets.get(key(day));
      if (!b) continue;
      const u = m.dUnits[i * ND + Math.min(day, ND - 1)];
      b.num += u * compositeCostAt(it, weekOfDay(day));
      b.units += u;
    }
  } else {
    for (const o of ordersOf(i)) {
      if (o.day < d0 || o.day > d1) continue;
      const b = buckets.get(key(o.day));
      if (!b) continue;
      b.num += o.unitCost * o.units;
      b.units += o.units;
      b.cases += o.cases;
    }
  }
  const points = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, b]) => ({ day, cost: b.units > 0 ? b.num / b.units : null, units: b.units, cases: b.cases }));
  return { grain, points };
}

// ---------------------------------------------------------------- Recipe components

export interface ComponentUnit {
  unit: string;
  /** $ per unit at 03/2025 (component index = 1). */
  base: number;
}

/** Costing unit and base cost of each recipe component (03/2025 prices). */
export const COMPONENT_UNITS: Record<string, ComponentUnit> = {
  dough16: { unit: 'ea', base: 0.92 },
  mozzarella: { unit: 'oz', base: 0.19 },
  pepperoni: { unit: 'oz', base: 0.29 },
  pizzaSauce: { unit: 'oz', base: 0.062 },
  pizzaBox: { unit: 'ea', base: 0.92 },
  sausage: { unit: 'oz', base: 0.22 },
  vegTopping: { unit: 'oz', base: 0.09 },
  chickenTopping: { unit: 'oz', base: 0.25 },
  subRoll: { unit: 'ea', base: 0.55 },
  deliMeat: { unit: 'oz', base: 0.32 },
  sliceCheese: { unit: 'oz', base: 0.24 },
  produceFill: { unit: 'oz', base: 0.06 },
  condiments: { unit: 'oz', base: 0.05 },
  wrapPack: { unit: 'ea', base: 0.12 },
  protein: { unit: 'lb', base: 2.6 },
  fryOil: { unit: 'oz', base: 0.04 },
  starch: { unit: 'oz', base: 0.05 },
  vegSide: { unit: 'oz', base: 0.07 },
  sauce: { unit: 'oz', base: 0.06 },
  container: { unit: 'ea', base: 0.35 },
  trayMeat: { unit: 'lb', base: 4.2 },
  trayCheese: { unit: 'lb', base: 3.8 },
  crackers: { unit: 'oz', base: 0.14 },
  garnish: { unit: 'oz', base: 0.08 },
  trayLid: { unit: 'ea', base: 2.4 },
  cakeBase: { unit: 'oz', base: 0.09 },
  icing: { unit: 'oz', base: 0.11 },
  filling: { unit: 'oz', base: 0.12 },
  decoration: { unit: 'ea', base: 0.6 },
  cakeBoard: { unit: 'ea', base: 1.1 },
};

export interface RecipeLine {
  key: string;
  name: string;
  qty: number;
  unit: string;
  /** Unit cost the recipe was costed at (Current PO Cost of the component). */
  currentUnitCost: number;
  /** Unit cost today (New PO Cost of the component). */
  newUnitCost: number;
  change: number;
  /** $ the component adds to the PLU's cost change. */
  contribution: number;
}

/** Recipe lines of a composite PLU: quantity × unit cost at costing time vs today. */
export function recipeLines(it: Item, w = LAST_COMPLETE_WEEK): RecipeLine[] {
  const c = it.composite;
  if (!c) return [];
  return c.components.map((comp) => {
    const u = COMPONENT_UNITS[comp.key];
    const cur = u.base * componentIndex(comp.key, c.updatedWeek);
    const now = u.base * componentIndex(comp.key, w);
    const qty = (comp.share * c.standardCost) / cur;
    return {
      key: comp.key,
      name: COMPONENTS[comp.key].name,
      qty,
      unit: u.unit,
      currentUnitCost: cur,
      newUnitCost: now,
      change: now / cur - 1,
      contribution: qty * (now - cur),
    };
  });
}

/** Recomputes a PLU's cost from its recipe lines, optionally overriding one component's unit cost. */
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
let hqWeekly: Float32Array | null = null;

/**
 * Weekly unit cost by source, for every item:
 * - PO (real-time): landed cost from purchase orders = vendor-weighted case cost + freight, per selling unit.
 * - HQ: the default cost in HQ / Retalix in force that week (last update on or before the week, no freight).
 * UPC items use the average cost for both; composite PLUs use the recipe (today's components vs the Excel standard).
 */
function buildWeekly(): void {
  const m = getModel();
  const po = new Float32Array(ITEMS.length * NW);
  const hq = new Float32Array(ITEMS.length * NW);
  for (const it of ITEMS) {
    const i = it.idx;
    const sup = supplyOf(i);
    const hqWeek = weekOfDay(sup.hqUpdatedDay);
    for (let w = 0; w < NW; w++) {
      const k = i * NW + w;
      if (it.costType === 'UPC') {
        po[k] = hq[k] = m.poCost[k];
        continue;
      }
      if (it.composite) {
        po[k] = compositeCostAt(it, w);
        hq[k] = w >= it.composite.updatedWeek ? it.composite.standardCost : it.composite.standardCost * 0.94;
        continue;
      }
      let landed = 0;
      sup.vendors.forEach((v, j) => {
        const cc = caseCostFor(it, sup, j, w * 7 + 3);
        landed += v.share * (cc * (1 + sup.freightRate)) / sup.casePack;
      });
      po[k] = landed;
      // HQ is refreshed about once a year: the value in force is the last update on or before this week.
      let u = hqWeek;
      while (u > w) u -= 52;
      hq[k] = u === hqWeek ? sup.hqCost : sup.hqCost * Math.pow(0.97, (hqWeek - u) / 52);
    }
  }
  poWeekly = po;
  hqWeekly = hq;
}

export function poUnitCostWeek(i: number, w: number): number {
  if (!poWeekly) buildWeekly();
  return poWeekly![i * NW + Math.max(0, Math.min(NW - 1, w))];
}

export function hqUnitCostWeek(i: number, w: number): number {
  if (!hqWeekly) buildWeekly();
  return hqWeekly![i * NW + Math.max(0, Math.min(NW - 1, w))];
}
