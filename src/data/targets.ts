/**
 * Margin target bands (Proposed), on item-level Gross Margin Rate. Centered on each department's item-level
 * margin; Produce follows the band the Produce team uses (45–50 %). Categories inherit their department's band.
 */
import { CATS, DEPTS } from './products';

export interface TargetBand {
  lo: number;
  hi: number;
}

const DEPT_BANDS: Record<string, TargetBand> = {
  Meat: { lo: 0.3, hi: 0.35 },
  Produce: { lo: 0.45, hi: 0.5 },
  Deli: { lo: 0.53, hi: 0.58 },
  Bakery: { lo: 0.56, hi: 0.61 },
  Seafood: { lo: 0.33, hi: 0.38 },
  Floral: { lo: 0.58, hi: 0.66 },
};

export const TARGETS_STATUS = 'Proposed' as const;

export function deptBand(dept: number): TargetBand {
  return DEPT_BANDS[DEPTS[dept].name];
}

export function catBand(cat: number): TargetBand {
  return deptBand(CATS[cat].dept);
}

/** Below the band (null rates are not judged). */
export function belowTarget(rate: number | null, band: TargetBand): boolean {
  return rate !== null && rate < band.lo;
}
