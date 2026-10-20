import { globalWeek } from './calendar';
import { hash01 } from './prng';

/** Real Weis region and district structure (200 stores). */
const STRUCTURE: Record<number, Record<string, number[]>> = {
  1: {
    D01: [74, 75, 91, 116, 152, 154, 198, 213, 214, 215, 217, 218, 219, 220, 222],
    D03: [106, 126, 135, 136, 143, 145, 147, 151, 155, 156, 157, 158, 159, 161, 165, 166, 170, 171, 190, 201, 230, 234],
    D06: [4, 7, 9, 10, 19, 20, 21, 24, 28, 31, 36, 37, 52, 177, 192, 197, 226],
    D08: [14, 22, 30, 33, 35, 40, 48, 51, 64, 118, 137, 140, 176, 187, 203, 291, 293],
  },
  2: {
    D04: [8, 29, 50, 68, 72, 76, 78, 83, 148, 175, 181, 184, 188, 189, 196, 223],
    D05: [39, 112, 141, 142, 144, 164, 168, 169, 182, 195, 202, 227, 231, 232, 233, 237, 386],
    D07: [17, 41, 49, 55, 63, 67, 77, 79, 80, 88, 94, 125, 127, 131, 133, 138, 191, 225],
    D09: [5, 16, 38, 43, 56, 58, 71, 92, 95, 98, 104, 120, 173, 199, 200, 240],
  },
  3: {
    D11: [60, 81, 100, 108, 110, 119, 129, 149, 167, 178, 179, 183, 238, 239, 289],
    D14: [84, 85, 86, 87, 111, 123, 128, 139, 172, 180, 193, 206, 228, 294, 295],
    D16: [276, 278, 279, 282, 283, 284, 285, 296, 297, 298, 301, 303, 304, 305, 307, 308],
    D17: [44, 45, 62, 70, 89, 122, 229, 271, 272, 273, 275, 277, 280, 287, 290, 292],
  },
};

/** Opened during FY2025 (first open week, fiscal week number). Not ID stores for FY2025/26 comparisons. */
const OPENED_FY2025: Record<number, number> = { 291: 10, 293: 22, 294: 30, 295: 38, 307: 17, 308: 45 };
/** Closed during FY2026 (first closed fiscal week). */
const CLOSED_FY2026: Record<number, number> = { 19: 20, 60: 33 };
/** Size factors for stores used in the planted demo stories, so the stories land on the right magnitudes. */
const SIZE_OVERRIDE: Record<number, number> = { 152: 1.32, 154: 1.08, 217: 1.15 };

export interface Store {
  idx: number;
  id: number;
  code: string;
  region: number;
  district: string;
  /** Relative sales volume, 0.5–1.6. */
  size: number;
  /** Relative known-loss propensity, 0.7–1.4. */
  lossFactor: number;
  /** First global week the store trades. */
  openWeek: number;
  /** First global week the store no longer trades. */
  closeWeek: number;
}

export interface District {
  id: string;
  region: number;
  stores: number[];
}

export const REGIONS = [1, 2, 3] as const;

export const STORES: Store[] = [];
export const DISTRICTS: District[] = [];

for (const [regionKey, districts] of Object.entries(STRUCTURE)) {
  const region = Number(regionKey);
  for (const [district, ids] of Object.entries(districts)) {
    const d: District = { id: district, region, stores: [] };
    for (const id of ids) {
      const idx = STORES.length;
      const size = SIZE_OVERRIDE[id] ?? Math.round((0.5 + 1.1 * Math.pow(hash01(id, 11), 1.15)) * 100) / 100;
      STORES.push({
        idx,
        id,
        code: String(id).padStart(3, '0'),
        region,
        district,
        size,
        lossFactor: 0.7 + 0.7 * hash01(id, 12),
        openWeek: id in OPENED_FY2025 ? globalWeek(2025, OPENED_FY2025[id]) : 0,
        closeWeek: id in CLOSED_FY2026 ? globalWeek(2026, CLOSED_FY2026[id]) : Number.MAX_SAFE_INTEGER,
      });
      d.stores.push(idx);
    }
    DISTRICTS.push(d);
  }
}

export const STORE_BY_ID = new Map(STORES.map((s) => [s.id, s]));

export function storeIdx(id: number): number {
  const s = STORE_BY_ID.get(id);
  if (!s) throw new Error(`Unknown store ${id}`);
  return s.idx;
}

export function isOpen(s: Store, week: number): boolean {
  return week >= s.openWeek && week < s.closeWeek;
}

/** Comparable ("ID") store: trades every week of the range and of the same weeks last year. */
export function isIdStore(s: Store, startWeek: number, endWeek: number): boolean {
  const lyStart = startWeek - 52;
  const from = lyStart >= 0 ? lyStart : startWeek;
  return s.openWeek <= from && s.closeWeek > endWeek;
}
