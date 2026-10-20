import { CATALOG, type ItemFlag, type Volatility } from './catalog';
import { AS_OF_DAY, dayFromYMD, formatMonth, weekOfDay, WEEK_COUNT } from './calendar';
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

export interface Component {
  key: string;
  name: string;
  /** Share of the recipe's standard cost when it was last updated. */
  share: number;
}

export interface Composite {
  components: Component[];
  /** Global week the standard cost was last updated in the Excel recipe file. */
  updatedWeek: number;
  updatedLabel: string;
  ageMonths: number;
  /** Standard cost per unit in use since the last update. */
  standardCost: number;
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
  composite?: Composite;
}

/** Target gross margin on net sales at list − trade cost, by department. */
const DEPT_MARGIN = [0.31, 0.4, 0.45, 0.53, 0.32, 0.55];
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
  /** Cost change from 03/2025 to 10/2026. */
  change: number;
}

export const COMPONENTS: Record<string, ComponentDef> = {
  dough16: { key: 'dough16', name: 'Pizza dough ball', change: 0.18 },
  mozzarella: { key: 'mozzarella', name: 'Shredded mozzarella', change: 0.12 },
  pepperoni: { key: 'pepperoni', name: 'Sliced pepperoni', change: 0.12 },
  pizzaSauce: { key: 'pizzaSauce', name: 'Pizza sauce', change: 0.09 },
  pizzaBox: { key: 'pizzaBox', name: '16 in. pizza box', change: 0.32 },
  sausage: { key: 'sausage', name: 'Italian sausage crumbles', change: 0.06 },
  vegTopping: { key: 'vegTopping', name: 'Peppers, onions and mushrooms', change: 0.05 },
  chickenTopping: { key: 'chickenTopping', name: 'Diced chicken', change: 0.04 },
  subRoll: { key: 'subRoll', name: '12 in. sub roll', change: 0.07 },
  deliMeat: { key: 'deliMeat', name: 'Deli meats', change: 0.05 },
  sliceCheese: { key: 'sliceCheese', name: 'Sliced cheese', change: 0.06 },
  produceFill: { key: 'produceFill', name: 'Lettuce, tomato and onion', change: 0.08 },
  condiments: { key: 'condiments', name: 'Condiments and dressing', change: 0.04 },
  wrapPack: { key: 'wrapPack', name: 'Wrap film and label', change: 0.09 },
  protein: { key: 'protein', name: 'Main protein', change: 0.04 },
  fryOil: { key: 'fryOil', name: 'Breading and fry oil', change: 0.11 },
  starch: { key: 'starch', name: 'Pasta, potatoes or rice', change: 0.03 },
  vegSide: { key: 'vegSide', name: 'Vegetable side', change: 0.05 },
  sauce: { key: 'sauce', name: 'Sauce and gravy', change: 0.04 },
  container: { key: 'container', name: 'Hot food container', change: 0.09 },
  trayMeat: { key: 'trayMeat', name: 'Tray meats', change: 0.05 },
  trayCheese: { key: 'trayCheese', name: 'Tray cheeses', change: 0.06 },
  crackers: { key: 'crackers', name: 'Crackers and bread', change: 0.03 },
  garnish: { key: 'garnish', name: 'Garnish and dip', change: 0.05 },
  trayLid: { key: 'trayLid', name: 'Platter and lid', change: 0.08 },
  cakeBase: { key: 'cakeBase', name: 'Cake base', change: 0.06 },
  icing: { key: 'icing', name: 'Buttercream icing', change: 0.07 },
  filling: { key: 'filling', name: 'Filling', change: 0.05 },
  decoration: { key: 'decoration', name: 'Decorations', change: 0.03 },
  cakeBoard: { key: 'cakeBoard', name: 'Cake board and dome', change: 0.08 },
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

/** Month a composite PLU's cost was last updated. Most are 03/2025–11/2025; one in five was refreshed in 2026. */
const PLANTED_UPDATE: Record<string, [number, number]> = { '16 in. Pepperoni Pizza': [2025, 3] };

function updateMonth(name: string, i: number): [number, number] {
  if (PLANTED_UPDATE[name]) return PLANTED_UPDATE[name];
  const h = hash01(i, 401);
  if (h < 0.2) return [2026, 1 + Math.floor(hash01(i, 402) * 8)];
  return [2025, 3 + Math.floor(hash01(i, 403) * 9)];
}

const AS_OF_MONTHS = 2026 * 12 + 10;
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
          weight: (catSpec.weight / catWeightSum) * (subSpec.weight / subWeightSum) * (zipf[k] / zipfSum),
          margin: Math.min(0.68, Math.max(0.12, DEPT_MARGIN[d] + marginNoise)),
          tags: parseTags(tagStr),
          tradeRate: flag === 'c' ? 0 : flag === 'e' ? 0.03 + 0.04 * hash01(i, 506) : 0.015 + 0.025 * hash01(i, 506),
          offInvoiceRate: flag !== 'c' && hash01(i, 507) < 0.4 ? 0.01 + 0.02 * hash01(i, 508) : 0,
          dealRate: flag === 'c' ? 0 : 0.06 + 0.06 * hash01(i, 509),
          scanbackRate: flag === 'e' ? 0.03 + 0.03 * hash01(i, 510) : 0,
          freightRate: flag !== 'c' && hash01(i, 511) < 0.3 ? 0.01 + 0.015 * hash01(i, 512) : 0,
          lossFactor: (ITEM_LOSS[name] ?? 1) * subLoss * Math.exp(hashNormal(i, 513) * 0.25),
        };
        if (flag === 'c' && subSpec.recipe) {
          const recipe = RECIPES[subSpec.recipe](name);
          const total = recipe.reduce((a, [, s]) => a + s, 0);
          const [uy, um] = updateMonth(name, i);
          const updatedDay = dayFromYMD(uy, um, 1);
          item.margin = name === '16 in. Pepperoni Pizza' ? 0.41 : Math.min(0.6, Math.max(0.3, 0.44 + marginNoise));
          item.composite = {
            components: recipe.map(([key, share]) => ({ key, name: COMPONENTS[key].name, share: share / total })),
            updatedWeek: Math.max(0, Math.min(WEEK_COUNT - 1, weekOfDay(updatedDay))),
            updatedLabel: formatMonth(updatedDay),
            ageMonths: AS_OF_MONTHS - (uy * 12 + um),
            standardCost: 0,
          };
        }
        ITEMS.push(item);
        sub.items.push(i);
      });
    }
  }
});

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

/** Estimated current cost of a composite PLU from component cost movement since its last update. */
export function estimatedCompositeCost(c: Composite, week = AS_OF_WEEK): number {
  let cost = 0;
  for (const comp of c.components) {
    cost += c.standardCost * comp.share * (componentIndex(comp.key, week) / componentIndex(comp.key, c.updatedWeek));
  }
  return cost;
}
