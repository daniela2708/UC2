import { CATALOG, type ItemFlag, type SubSpec, type Volatility } from './catalog';
import { AS_OF_DAY, dayFromYMD, formatMonth, globalWeek, weekOfDay, WEEK_COUNT } from './calendar';
import { hash01, hashNormal } from './prng';
import type { Uom } from '../lib/kpis';

export const DEPT_NAMES = CATALOG.map((d) => d.name);
export type DeptIdx = number;

export interface Dept {
  idx: number;
  name: string;
  cats: number[];
}
export interface Cat {
  idx: number;
  dept: number;
  name: string;
  subs: number[];
}
export interface Sub {
  idx: number;
  cat: number;
  dept: number;
  name: string;
  items: number[];
}

/** One recipe line: quantity of an ingredient per unit of the PLU, in the ingredient's unit of costing. */
export interface Component {
  key: string;
  name: string;
  qty: number;
  unit: IngredientUnit;
  /** Share of the standard cost, used only to size quantities for recipes kept as cost shares. */
  share: number;
}

export type IngredientUnit = 'oz' | 'lb' | 'ea';

export interface Composite {
  components: Component[];
  /** Global week the standard cost was last updated in the Excel recipe file. */
  updatedWeek: number;
  updatedLabel: string;
  ageMonths: number;
  /** Standard cost per unit in use since the last update. */
  standardCost: number;
  /** Recipe family, as grouped in the Deli Excel files. */
  family: string;
  /** Slices are costed as the pie's cost divided by the slice count. */
  sliceOf?: { item: string; slices: number };
}

export interface Item {
  idx: number;
  code: string;
  codeType: 'UPC' | 'PLU';
  name: string;
  dept: number;
  cat: number;
  sub: number;
  uom: Uom;
  rw: boolean;
  flag: ItemFlag;
  vol: Volatility | 'none';
  basePrice: number;
  /** Relative sales weight inside the department. */
  weight: number;
  /** Target gross margin on net sales at the default cost basis. */
  margin: number;
  tags: Record<string, number>;
  /** Allowances as fractions of list cost. */
  tradeRate: number;
  offInvoiceRate: number;
  dealRate: number;
  scanbackRate: number;
  freightRate: number;
  /** Relative known-loss propensity (before department normalisation). */
  lossFactor: number;
  /**
   * How cost is kept. UPC: packaged, average cost in HQ is reliable. PLU: sold by the unit without a
   * manufacturer barcode (e.g. avocados, Deli composite items). RW: random weight, sold by the pound.
   */
  costType: CostType;
  /** First week on sale (global week), for items launched during the horizon. */
  launchWeek?: number;
  composite?: Composite;
}

export type CostType = 'UPC' | 'PLU' | 'RW';
export const COST_TYPE_LABEL: Record<CostType, string> = { UPC: 'UPC', PLU: 'PLU', RW: 'Random weight' };

/**
 * Target margin on net sales at the market cost, by department. Calibrated so item-level Gross Margin Rate on
 * Gross Sales at real-time PO cost (freight included) lands at: Meat 31–33 %, Produce 44–48 %, Deli 55–56 %,
 * Bakery 58–60 %, Seafood 34–37 %, Floral 60–65 %.
 */
const DEPT_MARGIN = [0.35, 0.5, 0.59, 0.615, 0.39, 0.65];
const SUB_LOSS: Record<string, number> = {
  Berries: 1.7,
  'Salad greens': 1.4,
  'Bagged greens': 1.5,
  Tomatoes: 1.3,
  'Cut fruit': 1.5,
  Rolls: 1.2,
  Breads: 1.3,
  Donuts: 1.4,
  Rolls_Sushi: 1.5,
  Salmon: 1.6,
  Whitefish: 1.5,
  'Mixed bouquets': 1.3,
  'Rose bouquets': 1.4,
  Pizza: 1.2,
  'Hot meals': 1.6,
  'Rotisserie chicken': 1.7,
};

// ---------------------------------------------------------------- Composite recipe components

export interface ComponentDef {
  key: string;
  name: string;
  /** No longer bought; kept in old recipes until they are re-costed. */
  discontinued?: boolean;
  /** Cost change from 03/2025 to 10/2026. */
  change: number;
  /** Unit of costing. */
  unit: IngredientUnit;
  /** $ per unit of costing at 03/2025. */
  base: number;
}

const C = (key: string, name: string, unit: IngredientUnit, base: number, change: number, discontinued?: boolean): ComponentDef => ({ key, name, unit, base, change, discontinued });

/** Ingredients, packaging included, with their unit of costing and 03/2025 cost. Base ingredients are shared across recipes. */
export const COMPONENTS: Record<string, ComponentDef> = Object.fromEntries(
  [
    C('dough16', 'Pizza dough ball', 'lb', 0.6, 0.18),
    C('mozzarella', 'Shredded mozzarella', 'oz', 0.16, 0.12),
    C('pepperoni', 'Sliced pepperoni', 'oz', 0.26, 0.12),
    C('pizzaSauce', 'Pizza sauce', 'oz', 0.05, 0.09),
    C('pizzaBox', '16 in. pizza box', 'ea', 0.85, 0.32),
    C('pizzaBox12', '12 in. pizza box', 'ea', 0.62, 0.3),
    C('sausage', 'Italian sausage crumbles', 'oz', 0.2, 0.06),
    C('vegTopping', 'Peppers, onions and mushrooms', 'oz', 0.08, 0.05),
    C('chickenTopping', 'Diced chicken', 'oz', 0.22, 0.04),
    C('subRoll', '12 in. sub roll', 'ea', 0.55, 0.07),
    C('deliMeat', 'Deli meats', 'oz', 0.32, 0.05),
    C('sliceCheese', 'Sliced cheese', 'oz', 0.24, 0.06),
    C('produceFill', 'Lettuce, tomato and onion', 'oz', 0.06, 0.08),
    C('condiments', 'Condiments and dressing', 'oz', 0.05, 0.04),
    C('wrapPack', 'Wrap film and label', 'ea', 0.12, 0.09),
    C('protein', 'Main protein', 'lb', 2.6, 0.04),
    C('fryOil', 'Breading and fry oil', 'oz', 0.04, 0.11),
    C('starch', 'Pasta, potatoes or rice', 'oz', 0.05, 0.03),
    C('vegSide', 'Vegetable side', 'oz', 0.07, 0.05),
    C('sauce', 'Sauce and gravy', 'oz', 0.06, 0.04),
    C('container', 'Hot food container', 'ea', 0.35, 0.09),
    C('trayMeat', 'Tray meats', 'lb', 4.2, 0.05),
    C('trayCheese', 'Tray cheeses', 'lb', 3.8, 0.06),
    C('crackers', 'Club crackers (discontinued)', 'oz', 0.14, 0.03, true),
    C('garnish', 'Garnish and dip', 'oz', 0.08, 0.05),
    C('trayLid', 'Platter and lid', 'ea', 2.4, 0.08),
    C('cakeBase', 'Cake base', 'oz', 0.09, 0.06),
    C('icing', 'Buttercream icing', 'oz', 0.11, 0.07),
    C('filling', 'Filling', 'oz', 0.12, 0.05),
    C('decoration', 'Decorations', 'ea', 0.6, 0.03),
    C('cakeBoard', 'Cake board and dome', 'ea', 1.1, 0.08),
  ].map((c) => [c.key, c]),
);

/**
 * Pizza & stromboli recipes in real quantities per unit (one pie or one stromboli). Dough, mozzarella and
 * sauce are shared by every pizza and stromboli; pepperoni by five of them. Slices take the pie's recipe ÷ 8.
 */
const PIZZA_RECIPES: Record<string, [string, number][]> = {
  '16 in. Pepperoni Pizza': [['dough16', 1.25], ['mozzarella', 12], ['pizzaSauce', 6], ['pepperoni', 4], ['pizzaBox', 1]],
  '16 in. Cheese Pizza': [['dough16', 1.25], ['mozzarella', 14], ['pizzaSauce', 6], ['pizzaBox', 1]],
  '16 in. Supreme Pizza': [['dough16', 1.25], ['mozzarella', 12], ['pizzaSauce', 6], ['pepperoni', 2], ['sausage', 3], ['vegTopping', 4], ['pizzaBox', 1]],
  '16 in. Meat Lovers Pizza': [['dough16', 1.25], ['mozzarella', 12], ['pizzaSauce', 6], ['pepperoni', 3], ['sausage', 4], ['pizzaBox', 1]],
  '12 in. Pepperoni Pizza': [['dough16', 0.75], ['mozzarella', 7], ['pizzaSauce', 4], ['pepperoni', 2.5], ['pizzaBox12', 1]],
  '12 in. Cheese Pizza': [['dough16', 0.75], ['mozzarella', 8], ['pizzaSauce', 4], ['pizzaBox12', 1]],
  '16 in. Buffalo Chicken Pizza': [['dough16', 1.25], ['mozzarella', 12], ['chickenTopping', 6], ['condiments', 2], ['pizzaBox', 1]],
  '16 in. White Pizza': [['dough16', 1.25], ['mozzarella', 14], ['condiments', 1.5], ['pizzaBox', 1]],
  '16 in. Veggie Pizza': [['dough16', 1.25], ['mozzarella', 12], ['pizzaSauce', 6], ['vegTopping', 6], ['pizzaBox', 1]],
  'Pepperoni Stromboli': [['dough16', 1], ['mozzarella', 8], ['pizzaSauce', 3], ['pepperoni', 4], ['wrapPack', 1]],
  'Italian Stromboli': [['dough16', 1], ['mozzarella', 7], ['pizzaSauce', 3], ['pepperoni', 2], ['deliMeat', 3], ['wrapPack', 1]],
};


/** Recipes as [component, share] lists. Names select a variant; the default is the first. */
const RECIPES: Record<string, (name: string) => [string, number][]> = {
  pizza: (n) => {
    const base: [string, number][] = [
      ['dough16', 0.16],
      ['mozzarella', 0.38],
      ['pizzaSauce', 0.08],
      ['pizzaBox', 0.16],
    ];
    if (/Pepperoni/.test(n)) return [...base, ['pepperoni', 0.22]];
    if (/Supreme/.test(n)) return [...base, ['pepperoni', 0.1], ['sausage', 0.07], ['vegTopping', 0.05]];
    if (/Meat Lovers/.test(n)) return [...base, ['pepperoni', 0.1], ['sausage', 0.12]];
    if (/Chicken/.test(n)) return [...base, ['chickenTopping', 0.22]];
    if (/Veggie/.test(n)) return [...base, ['vegTopping', 0.22]];
    return base;
  },
  sub: (n) => {
    const r: [string, number][] = [
      ['subRoll', 0.2],
      ['deliMeat', 0.42],
      ['sliceCheese', 0.16],
      ['wrapPack', 0.06],
    ];
    if (!/Philly|Caesar/.test(n)) r.push(['produceFill', 0.1]);
    if (/Italian|Club|Caesar|Croissant/.test(n)) r.push(['condiments', 0.06]);
    return r;
  },
  meal: (n) => {
    const r: [string, number][] = [
      ['protein', 0.48],
      ['container', 0.1],
    ];
    if (/Fried|Tenders/.test(n)) r.push(['fryOil', 0.22], ['condiments', 0.05]);
    else r.push(['starch', 0.16], ['sauce', 0.12], ['vegSide', 0.1]);
    return r;
  },
  tray: (n) => {
    const r: [string, number][] = [
      ['trayLid', 0.12],
      ['garnish', 0.08],
    ];
    if (/Wing|Tender|Slider|Shrimp/.test(n)) r.push(['protein', 0.55], ['fryOil', 0.12], ['condiments', 0.06]);
    else r.push(['trayMeat', 0.4], ['trayCheese', 0.28], ['crackers', 0.1]);
    if (/Sub|Pinwheel|Slider/.test(n)) r.push(['subRoll', 0.08]);
    return r;
  },
  cake: (n) => {
    const r: [string, number][] = [
      ['cakeBase', 0.38],
      ['icing', 0.28],
      ['decoration', 0.08],
      ['cakeBoard', 0.12],
    ];
    if (/Double|Ice Cream|Full/.test(n)) r.push(['filling', 0.12]);
    return r;
  },
};

/**
 * Month a composite PLU's cost was last updated. The Deli team re-costs recipes about once a year, so at 10/2026:
 * about half within the last 6 months (04–09/2026), about 40 % 7–12 months ago (10/2025–03/2026) and about one in
 * ten older than a year (04–09/2025). 16 in. Pepperoni Pizza (03/2025) is the oldest.
 */
const PLANTED_UPDATE: Record<string, [number, number]> = { '16 in. Pepperoni Pizza': [2025, 3] };

function updateMonth(name: string, i: number): [number, number] {
  if (PLANTED_UPDATE[name]) return PLANTED_UPDATE[name];
  if (/Slice$/.test(name)) return updateMonth(name.replace(/ Slice$/, ''), ITEM_BY_NAME_EARLY.get(name.replace(/ Slice$/, '')) ?? i);
  const h = hash01(i, 401);
  const k = hash01(i, 402);
  if (h < 0.5) return [2026, 4 + Math.floor(k * 6)];
  if (h < 0.9) {
    const m = 10 + Math.floor(k * 6); // 10/2025 … 03/2026
    return m <= 12 ? [2025, m] : [2026, m - 12];
  }
  return [2025, 4 + Math.floor(k * 6)];
}

const AS_OF_MONTHS = 2026 * 12 + 10;
/** Item indexes by name while building (slices look up their pie). */
const ITEM_BY_NAME_EARLY = new Map<string, number>();
/** Items whose shrink is structurally higher than their subcategory (fresh fillets lose weight and date out fast). */
const ITEM_LOSS: Record<string, number> = { 'Atlantic Salmon Fillet': 2.2 };

// ---------------------------------------------------------------- Codes

function upcCheck(digits11: string): number {
  let odd = 0;
  let even = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(digits11[i]);
    if (i % 2 === 0) odd += d;
    else even += d;
  }
  return (10 - ((odd * 3 + even) % 10)) % 10;
}

const KNOWN_PLU: Record<string, string> = {
  Bananas: '4011',
  'Organic Bananas': '94011',
  Plantains: '4235',
  'Honeycrisp Apples': '3283',
  'Gala Apples': '4133',
  'Fuji Apples': '4131',
  'Granny Smith Apples': '4139',
  'Red Delicious Apples': '4016',
  Lemons: '4053',
  Limes: '4048',
  'Avocados Hass': '4225',
};
const PLU_PREFIX = ['21', '', '24', '26', '28', '29'];

// ---------------------------------------------------------------- Build

export const DEPTS: Dept[] = [];
export const CATS: Cat[] = [];
export const SUBS: Sub[] = [];
export const ITEMS: Item[] = [];

const usedCodes = new Set<string>();
function uniqueCode(make: (attempt: number) => string): string {
  for (let a = 0; ; a++) {
    const c = make(a);
    if (!usedCodes.has(c)) {
      usedCodes.add(c);
      return c;
    }
  }
}

function parseTags(s: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!s) return out;
  for (const t of s.split(/\s+/)) {
    const m = /^([a-z][a-z0-9])([0-9.]+)$/.exec(t);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}


interface ItemContext {
  d: number;
  cat: Cat;
  sub: Sub;
  subSpec: SubSpec;
  weight: number;
}

function buildItem(raw: string, ctx: ItemContext): Item {
  const { d, cat, sub, subSpec } = ctx;
          const [name, priceStr, flagStr, tagStr] = raw.split('|');
  const flag = (flagStr || subSpec.flag) as ItemFlag;
  const i = ITEMS.length;
  const rw = flag === 'w';
  const uom: Uom = rw ? 'lb' : 'ea';
  const codeType: 'UPC' | 'PLU' = flag === 'e' ? 'UPC' : 'PLU';
  const code = uniqueCode((a) => {
    if (codeType === 'UPC') {
      const mfr = String(30000 + Math.floor(hash01(cat.idx, 501, a) * 59999)).padStart(5, '0');
      const item = String(Math.floor(hash01(i, 502, a) * 99999)).padStart(5, '0');
      const d11 = `0${mfr}${item}`;
      return `${d11}${upcCheck(d11)}`;
    }
    if (a === 0 && KNOWN_PLU[name]) return KNOWN_PLU[name];
    if (d === 1) {
      const base = String(3000 + Math.floor(hash01(i, 503, a) * 2000));
      return /^Organic/.test(name) ? `9${base}` : base;
    }
    return `${PLU_PREFIX[d]}${String(Math.floor(hash01(i, 504, a) * 1000)).padStart(3, '0')}`;
  });
  const vol: Volatility | 'none' =
    flag === 'c' ? 'none' : subSpec.vol ?? (rw ? 'med' : 'step');
  const marginNoise = hashNormal(i, 505) * 0.035;
  const subLoss = SUB_LOSS[subSpec.name === 'Rolls' && d === 4 ? 'Rolls_Sushi' : subSpec.name] ?? 1;
  const item: Item = {
    idx: i,
    code,
    codeType,
    name,
    dept: d,
    cat: cat.idx,
    sub: sub.idx,
    uom,
    rw,
    flag,
    vol,
    basePrice: Number(priceStr),
    weight: ctx.weight,
    margin: Math.min(0.68, Math.max(0.12, DEPT_MARGIN[d] + marginNoise)),
    tags: parseTags(tagStr),
    tradeRate: flag === 'c' ? 0 : flag === 'e' ? 0.03 + 0.04 * hash01(i, 506) : 0.015 + 0.025 * hash01(i, 506),
    offInvoiceRate: flag !== 'c' && hash01(i, 507) < 0.4 ? 0.01 + 0.02 * hash01(i, 508) : 0,
    dealRate: flag === 'c' ? 0 : 0.06 + 0.06 * hash01(i, 509),
    scanbackRate: flag === 'e' ? 0.03 + 0.03 * hash01(i, 510) : 0,
    freightRate: flag !== 'c' && hash01(i, 511) < 0.3 ? 0.01 + 0.015 * hash01(i, 512) : 0,
    lossFactor: (ITEM_LOSS[name] ?? 1) * subLoss * Math.exp(hashNormal(i, 513) * 0.25),
    costType: flag === 'e' ? 'UPC' : flag === 'w' ? 'RW' : 'PLU',
  };
  if (flag === 'c' && subSpec.recipe) {
    const pieName = name.replace(/ Slice$/, '');
    const fixed = PIZZA_RECIPES[pieName];
    const recipe = fixed ?? RECIPES[subSpec.recipe](name);
    const total = recipe.reduce((a, [, s]) => a + s, 0);
    const [uy, um] = updateMonth(name, i);
    const updatedDay = dayFromYMD(uy, um, 1);
    item.margin = Math.min(0.66, Math.max(0.42, (d === 2 ? 0.56 : 0.6) + marginNoise));
    const family =
      subSpec.recipe === 'pizza'
        ? 'Pizza & stromboli'
        : subSpec.recipe === 'sub'
          ? 'Sandwiches & subs'
          : subSpec.recipe === 'tray'
            ? 'Platters'
            : subSpec.recipe === 'cake'
              ? 'Bakery cakes'
              : /Fried|Tender/.test(name)
                ? 'Chicken'
                : 'Meals';
    item.composite = {
      family,
      sliceOf: /Slice$/.test(name) ? { item: name.replace(/ Slice$/, ''), slices: 8 } : undefined,
      // Fixed recipes carry quantities now; share recipes get quantities when the standard cost is set (generate.ts).
      components: recipe.map(([key, v]) => {
        const def = COMPONENTS[key];
        const slices = /Slice$/.test(name) ? 8 : 1;
        return fixed ? { key, name: def.name, unit: def.unit, qty: v / slices, share: 0 } : { key, name: def.name, unit: def.unit, qty: 0, share: v / total };
      }),
      updatedWeek: Math.max(0, Math.min(WEEK_COUNT - 1, weekOfDay(updatedDay))),
      updatedLabel: formatMonth(updatedDay),
      ageMonths: AS_OF_MONTHS - (uy * 12 + um),
      standardCost: 0,
    };
  }
  ITEM_BY_NAME_EARLY.set(name, i);
  return item;
}

CATALOG.forEach((deptSpec, d) => {
  const dept: Dept = { idx: d, name: deptSpec.name, cats: [] };
  DEPTS.push(dept);
  const catWeightSum = deptSpec.cats.reduce((a, c) => a + c.weight, 0);
  for (const catSpec of deptSpec.cats) {
    const cat: Cat = { idx: CATS.length, dept: d, name: catSpec.name, subs: [] };
    CATS.push(cat);
    dept.cats.push(cat.idx);
    const subWeightSum = catSpec.subs.reduce((a, s) => a + s.weight, 0);
    for (const subSpec of catSpec.subs) {
      const sub: Sub = { idx: SUBS.length, cat: cat.idx, dept: d, name: subSpec.name, items: [] };
      SUBS.push(sub);
      cat.subs.push(sub.idx);
      const zipf = subSpec.items.map((_, k) => (0.75 + 0.5 * hash01(sub.idx, k, 31)) / Math.pow(k + 1, 0.85));
      const zipfSum = zipf.reduce((a, b) => a + b, 0);
      subSpec.items.forEach((raw, k) => {
        const item = buildItem(raw, {
          d,
          cat,
          sub,
          subSpec,
          weight: (catSpec.weight / catWeightSum) * (subSpec.weight / subWeightSum) * (zipf[k] / zipfSum),
        });
        ITEMS.push(item);
        sub.items.push(item.idx);
      });
    }
  }
});

/**
 * Items added after the first build. They are appended so existing item indexes (and every seeded
 * number keyed on them) stay the same. Weight is the item's share of its department's sales.
 */
/** Items from the original catalog; seeded event sampling stays on these so stories do not move. */
export const BASE_ITEM_COUNT = ITEMS.length;

const EXTRA_ITEMS: { dept: string; sub: string; raw: string; weight: number; launch?: number }[] = [
  { dept: 'Produce', sub: 'Cooking vegetables', raw: 'Pie Pumpkins|4.99|p|zz1', weight: 0.036 },
  { dept: 'Deli', sub: 'Pizza', raw: 'Pepperoni Stromboli|8.99||sb1.6', weight: 0.008 },
  { dept: 'Deli', sub: 'Pizza', raw: 'Italian Stromboli|9.49', weight: 0.006 },
  { dept: 'Deli', sub: 'Pizza', raw: '16 in. Pepperoni Pizza Slice|2.79', weight: 0.009 },
  { dept: 'Deli', sub: 'Pizza', raw: '16 in. Cheese Pizza Slice|2.49', weight: 0.006 },
  // FY2026 launches (new items watch).
  { dept: 'Deli', sub: 'Hot meals', raw: 'Korean BBQ Chicken Bowl|9.99', weight: 0.006, launch: 31 },
  { dept: 'Deli', sub: 'Subs & sandwiches', raw: 'Hot Honey Chicken Sandwich|7.99', weight: 0.007, launch: 34 },
  { dept: 'Deli', sub: 'Hot meals', raw: 'Mediterranean Grain Bowl|8.99', weight: 0.004, launch: 38 },
  { dept: 'Bakery', sub: 'Donuts', raw: 'Apple Cider Donuts 6 ct|5.49|p|fa1.5', weight: 0.012, launch: 35 },
  { dept: 'Bakery', sub: 'Pastries & muffins', raw: 'Pumpkin Cream Cheese Muffins 4 ct|5.99|p|fa1.4', weight: 0.008, launch: 36 },
  { dept: 'Produce', sub: 'Cut fruit', raw: 'Honeycrisp Apple Slices 10 oz|3.99', weight: 0.004, launch: 33 },
  { dept: 'Seafood', sub: 'Platters & bowls', raw: 'Spicy Salmon Poke Bowl|12.99', weight: 0.01, launch: 30 },
  { dept: 'Floral', sub: 'Potted plants', raw: 'Fall Succulent Planter|14.99|e|fa1.6', weight: 0.012, launch: 32 },
];
for (const x of EXTRA_ITEMS) {
  const sub = SUBS.find((s) => s.name === x.sub && DEPTS[s.dept].name === x.dept);
  if (!sub) throw new Error(`Unknown subcategory ${x.sub}`);
  const subSpec = CATALOG[sub.dept].cats.find((c) => c.name === CATS[sub.cat].name)!.subs.find((s) => s.name === sub.name)!;
  const item = buildItem(x.raw, { d: sub.dept, cat: CATS[sub.cat], sub, subSpec, weight: x.weight });
  if (x.launch) {
    item.launchWeek = globalWeek(2026, x.launch);
    // New items run higher loss while ordering settles.
    item.lossFactor *= 1.6;
  }
  ITEMS.push(item);
  sub.items.push(item.idx);
}

export const ITEM_BY_NAME = new Map(ITEMS.map((it) => [it.name, it]));

export function itemByName(name: string): Item {
  const it = ITEM_BY_NAME.get(name);
  if (!it) throw new Error(`Unknown item ${name}`);
  return it;
}

/** Weeks since 03/2025 when component cost changes are measured from. */
const COMPONENT_BASE_WEEK = weekOfDay(dayFromYMD(2025, 3, 1));
const AS_OF_WEEK = weekOfDay(AS_OF_DAY);

/** Component cost index, 1.0 at 03/2025, smooth compounding to its 10/2026 change. */
export function componentIndex(key: string, week: number): number {
  const def = COMPONENTS[key];
  const rate = Math.log(1 + def.change) / (AS_OF_WEEK - COMPONENT_BASE_WEEK);
  return Math.exp(rate * (week - COMPONENT_BASE_WEEK));
}

const KEY_SALT = new Map(Object.keys(COMPONENTS).map((k, n) => [k, 900 + n]));

/**
 * Ingredient cost per unit of costing in a week: the 03/2025 cost along its trend, with small week-to-week
 * movement from the ingredient's own purchase orders.
 */
export function ingredientUnitCost(key: string, week: number): number {
  const def = COMPONENTS[key];
  return def.base * componentIndex(key, week) * (1 + 0.012 * hashNormal(KEY_SALT.get(key) ?? 899, week, 931));
}

/** Recipe cost of a composite PLU with every ingredient at its cost in week `w` (optionally one ingredient overridden). */
export function recipeCostAt(c: Composite, week: number, override?: { key: string; unitCost: number }): number {
  let cost = 0;
  for (const comp of c.components) cost += comp.qty * (override && override.key === comp.key ? override.unitCost : ingredientUnitCost(comp.key, week));
  return cost;
}

/** Estimated current cost of a composite PLU: its recipe at today's ingredient costs. */
export function estimatedCompositeCost(c: Composite, week = AS_OF_WEEK): number {
  return recipeCostAt(c, week);
}

/** Rounds a recipe quantity to the step a recipe card would use. */
export function roundQty(qty: number, unit: IngredientUnit): number {
  const step = unit === 'oz' ? 0.5 : unit === 'lb' ? 0.05 : 0.25;
  return Math.max(step, Math.round(qty / step) * step);
}
