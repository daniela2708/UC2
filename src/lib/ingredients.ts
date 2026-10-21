/**
 * Ingredients View (user story 6, legacy source "Pizza Ingredients.xlsx"): each ingredient's contribution to a
 * composite PLU's unit cost, the PLU's totals, and where an ingredient is used, with a read-only cost simulation.
 * Recipes and ingredient costs are the same in every store, so everything here is chain level.
 */
import { LAST_COMPLETE_WEEK } from '../data/calendar';
import { getModel, ND, NW } from '../data/generate';
import { COMPONENTS, DEPTS, ingredientUnitCost, ITEMS, itemByName, recipeCostAt, type IngredientUnit, type Item } from '../data/products';
import { marginImpactOf, safeDiv } from './kpis';
import { itemIndices } from './filters';

const COMPOSITE_DEPTS = new Set(['Deli', 'Bakery']);
export const DEFAULT_INGREDIENTS_ITEM = '16 in. Pepperoni Pizza';

/** Composite Deli and Bakery PLUs the picker offers; Department and Category narrow the list. */
export function ingredientPickerItems(dept: number, cat: number): number[] {
  return itemIndices({ dept, cat, sub: -1, item: -1 }).filter((i) => !!ITEMS[i].composite && COMPOSITE_DEPTS.has(DEPTS[ITEMS[i].dept].name));
}

/** The requested PLU if it is in the list, else 16 in. Pepperoni Pizza, else the first; -1 for an empty list. */
export function resolveIngredientsItem(list: number[], requested: number): number {
  if (list.length === 0) return -1;
  if (requested >= 0 && list.includes(requested)) return requested;
  const def = itemByName(DEFAULT_INGREDIENTS_ITEM).idx;
  return list.includes(def) ? def : list[0];
}

/** Units sold and gross sales of an item in one week, restricted to the days [d0, d1] (chain). */
function weekSales(i: number, w: number, d0: number, d1: number): { units: number; sales: number } {
  const m = getModel();
  const a = Math.max(d0, w * 7);
  const b = Math.min(d1, w * 7 + 6, ND - 1);
  if (b < a) return { units: 0, sales: 0 };
  if (b - a === 6) return { units: m.units[i * NW + w], sales: m.sales[i * NW + w] };
  let units = 0;
  let sales = 0;
  for (let day = a; day <= b; day++) {
    units += m.dUnits[i * ND + day];
    sales += m.dSales[i * ND + day];
  }
  return { units, sales };
}

export interface IngredientRow {
  key: string;
  name: string;
  qty: number;
  unit: IngredientUnit;
  discontinued: boolean;
  /** Ingredient cost per unit of costing over the range, weighted by the PLU's units sold each week. */
  unitCost: number;
  /** Units per item × cost per unit. */
  contribution: number;
  share: number;
}

export interface IngredientsSummary {
  rows: IngredientRow[];
  /** Σ contributions = recipe cost per unit over the range. */
  costPerUnit: number;
  /** Units sold in the range. */
  units: number;
  /** Recipe cost × units sold, week by week. */
  totalCost: number;
  grossSales: number;
  /** Retail price at the end of the range (reference only). */
  retail: number;
  /** Gross Sales − (recipe cost × units sold). */
  grossProfit: number;
  /** Gross Profit ÷ Gross Sales, consistent with Gross Margin Rate. */
  grossProfitPct: number | null;
}

/** Ingredient contributions and totals for one PLU over the days [d0, d1]. */
export function ingredientsSummary(it: Item, d0: number, d1: number): IngredientsSummary {
  const c = it.composite!;
  const m = getModel();
  const w0 = Math.floor(d0 / 7);
  const w1 = Math.min(Math.floor(d1 / 7), NW - 1);
  const acc = c.components.map(() => 0);
  let units = 0;
  let sales = 0;
  let totalCost = 0;
  for (let w = w0; w <= w1; w++) {
    const s = weekSales(it.idx, w, d0, d1);
    if (s.units <= 0) continue;
    units += s.units;
    sales += s.sales;
    c.components.forEach((comp, k) => {
      const v = comp.qty * ingredientUnitCost(comp.key, w) * s.units;
      acc[k] += v;
      totalCost += v;
    });
  }
  // With no sales in the range, show the recipe at the range's last week.
  const costAt = (k: number) => (units > 0 ? acc[k] / units : c.components[k].qty * ingredientUnitCost(c.components[k].key, Math.min(w1, LAST_COMPLETE_WEEK)));
  const costPerUnit = c.components.reduce((a, _, k) => a + costAt(k), 0);
  const rows = c.components.map((comp, k) => ({
    key: comp.key,
    name: COMPONENTS[comp.key].name,
    qty: comp.qty,
    unit: comp.unit,
    discontinued: !!COMPONENTS[comp.key].discontinued,
    unitCost: costAt(k) / comp.qty,
    contribution: costAt(k),
    share: costPerUnit > 0 ? costAt(k) / costPerUnit : 0,
  }));
  const grossProfit = sales - totalCost;
  return {
    rows,
    costPerUnit,
    units,
    totalCost,
    grossSales: sales,
    retail: m.retail[it.idx * NW + Math.min(w1, NW - 1)],
    grossProfit,
    grossProfitPct: safeDiv(grossProfit, sales),
  };
}

/** Each ingredient's contribution to unit cost by fiscal week, for the stacked chart. */
export function ingredientWeeks(it: Item, w0: number, w1: number): { week: number; values: Record<string, number> }[] {
  const out: { week: number; values: Record<string, number> }[] = [];
  for (let w = w0; w <= w1; w++) {
    const values: Record<string, number> = {};
    for (const comp of it.composite!.components) values[comp.key] = comp.qty * ingredientUnitCost(comp.key, w);
    out.push({ week: w, values });
  }
  return out;
}

export interface WhereUsedRow {
  item: number;
  qty: number;
  unit: IngredientUnit;
  currentCost: number;
  newCost: number;
  retail: number | null;
  gpBefore: number | null;
  gpAfter: number | null;
  /** Units produced over the trailing 52 weeks: units sold + known loss units. */
  unitsProduced: number;
  /** (new cost − current cost) × units produced. Positive = the PLU costs more. */
  annualCostChange: number;
  /** −annual cost change: a cost increase is a margin loss. */
  marginImpact: number;
}

/** Average gross price per unit over the 4 weeks ending at week `w`. */
function retailAt(i: number, w: number): number | null {
  const m = getModel();
  let s = 0;
  let u = 0;
  for (let x = Math.max(0, w - 3); x <= w; x++) {
    s += m.sales[i * NW + x];
    u += m.units[i * NW + x];
  }
  return safeDiv(s, u);
}

/** Units produced over the trailing 52 complete weeks: units sold + known loss units (chain). */
export function unitsProduced52(i: number, endWeek = LAST_COMPLETE_WEEK): number {
  const m = getModel();
  let u = 0;
  for (let w = Math.max(0, endWeek - 51); w <= endWeek; w++) {
    const k = i * NW + w;
    u += m.units[k] + (m.poCost[k] > 0 ? m.lossCost[k] / m.poCost[k] : 0);
  }
  return u;
}

/** Composite PLUs that use an ingredient. */
export function pluUsing(key: string): number[] {
  return ITEMS.filter((it) => it.composite?.components.some((c) => c.key === key)).map((it) => it.idx);
}

/**
 * Where used: every PLU whose recipe uses the ingredient, with its cost now and with the ingredient at `newUnitCost`
 * (null = no change). The change flows through each recipe; read-only, nothing is saved.
 */
export function whereUsed(key: string, newUnitCost: number | null, week = LAST_COMPLETE_WEEK): WhereUsedRow[] {
  return pluUsing(key)
    .map((i) => {
      const c = ITEMS[i].composite!;
      const comp = c.components.find((x) => x.key === key)!;
      const currentCost = recipeCostAt(c, week);
      const newCost = newUnitCost === null ? currentCost : recipeCostAt(c, week, { key, unitCost: newUnitCost });
      const retail = retailAt(i, week);
      const unitsProduced = unitsProduced52(i, week);
      return {
        item: i,
        qty: comp.qty,
        unit: comp.unit,
        currentCost,
        newCost,
        retail,
        gpBefore: retail ? (retail - currentCost) / retail : null,
        gpAfter: retail ? (retail - newCost) / retail : null,
        unitsProduced,
        annualCostChange: (newCost - currentCost) * unitsProduced,
        marginImpact: marginImpactOf((newCost - currentCost) * unitsProduced),
      };
    })
    .sort((a, b) => b.unitsProduced * b.qty - a.unitsProduced * a.qty);
}

/** Simulated ingredient cost: a number above 0 and at most 10× today's cost; anything else is refused. */
export function clampIngredientCost(raw: unknown, current: number): number | null {
  const v = typeof raw === 'string' ? (/^\s*\$?\d{0,5}(\.\d{0,4})?\s*$/.test(raw) && raw.trim() !== '' && raw.trim() !== '$' ? Number(raw.replace('$', '')) : NaN) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(v) || v <= 0 || !(current > 0) || v > current * 10) return null;
  return v;
}
