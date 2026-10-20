import { globalWeek } from './calendar';

/**
 * The six demo stories. The generator applies them as explicit overrides on top
 * of the seeded data, and the views read these constants to raise banners.
 */
export const PLANTED = {
  /** 1. Fat-finger loss: 1,110 lb keyed instead of about 11 lb. */
  fatFinger: {
    item: 'Atlantic Salmon Fillet',
    store: 152,
    week: globalWeek(2026, 38),
    lossUnits: 1110,
    lossCost: 11_700,
  },
  /** 2. Extreme entry error that must not distort totals. */
  extreme: {
    item: 'Strawberries 1 lb Clamshell',
    store: 217,
    week: globalWeek(2026, 29),
    lossUnits: 3_560_000,
    lossCost: 8_900_000,
  },
  /** 3. Stale composite cost (the cost date and component moves live in products.ts). */
  staleCost: {
    item: '16 in. Pepperoni Pizza',
  },
  /** 4. Seafood squeeze: shrimp cost +18 % from FY2026 P8 with no retail change. */
  shrimpSqueeze: {
    dept: 'Seafood',
    namePattern: /Shrimp/,
    fromWeek: globalWeek(2026, 31),
    retailFrozenFrom: globalWeek(2026, 14),
    costLift: 0.18,
  },
  /** 5. Store 154 Meat runs about 8 pts below budget for 4 weeks, driven by DSD. */
  storeOutlier: {
    store: 154,
    dept: 'Meat',
    fromWeek: globalWeek(2026, 39),
    toWeek: globalWeek(2026, 42),
    dsdShare: 0.09,
    whseLift: 0,
  },
  /** 6. Stores that have not posted known loss for W42. */
  incomplete: {
    stores: [213, 386, 290],
    week: globalWeek(2026, 42),
  },
} as const;

/** Single entries above this are treated as implausible and listed separately from the ranked flags. */
export const EXTREME_ENTRY_DOLLARS = 100_000;
