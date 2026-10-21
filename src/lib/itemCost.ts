/** Item Cost Over Time: which items the SKU picker offers, and which one is shown. Pure helpers. */
import { ITEMS } from '../data/products';
import { currentPoCost, newPoCost, romaItem } from '../data/purchasing';
import { itemIndices } from './filters';

/** Items the picker offers: the business filters only narrow this list. */
export function pickerItems(dept: number, cat: number, sub: number, costType: string): number[] {
  return itemIndices({ dept, cat, sub, item: -1 }).filter((i) => costType === 'all' || ITEMS[i].costType === costType);
}

const defaultCache = new Map<string, number>();

/** Default item: Roma tomatoes when in the list (the demo story), else the largest gap between New PO Cost and the cost in HQ (-1 for an empty list). */
export function defaultItem(list: number[]): number {
  const key = list.join('.');
  const hit = defaultCache.get(key);
  if (hit !== undefined) return hit;
  const roma = romaItem().idx;
  if (list.includes(roma)) {
    defaultCache.set(key, roma);
    return roma;
  }
  let best = list[0] ?? -1;
  let bestGap = -1;
  for (const i of list) {
    if (ITEMS[i].costType === 'UPC') continue;
    const n = newPoCost(i);
    const c = currentPoCost(i);
    if (n === null || c <= 0) continue;
    const gap = Math.abs(n / c - 1);
    if (gap > bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  defaultCache.set(key, best);
  return best;
}

/** One SKU at a time: the requested item if it is in the list, otherwise the default; -1 means show the empty state. */
export function resolveIcItem(list: number[], requested: number): number {
  if (list.length === 0) return -1;
  return requested >= 0 && list.includes(requested) ? requested : defaultItem(list);
}
