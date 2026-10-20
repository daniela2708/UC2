/**
 * Weis fiscal calendar. Weeks run Sunday to Saturday; a fiscal year has 52 weeks
 * in 12 periods (P3, P6, P9 and P11 have 5 weeks). All dates are handled as
 * integer day indexes from FY2024 day 1 (Sun 12/31/2023), so arithmetic is exact
 * and free of time zones.
 */
const DAY_MS = 86_400_000;
const EPOCH_UTC = Date.UTC(2023, 11, 31);

export const FISCAL_YEARS = [2024, 2025, 2026] as const;
export type FiscalYear = (typeof FISCAL_YEARS)[number];
export const FIRST_FY: FiscalYear = 2024;
export const WEEKS_PER_YEAR = 52;
export const PERIOD_WEEKS = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 5, 4] as const;
export const LY_OFFSET_DAYS = 364;
export const LY_OFFSET_WEEKS = 52;

export function dayFromYMD(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

/** Parses YYYY-MM-DD. Returns null for anything else, including impossible dates. */
export function dayFromISO(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return dayFromYMD(y, mo, d);
}

function dateOf(day: number): Date {
  return new Date(EPOCH_UTC + day * DAY_MS);
}

export function isoFromDay(day: number): string {
  return dateOf(day).toISOString().slice(0, 10);
}

/** MM/DD/YYYY */
export function formatDay(day: number): string {
  const d = dateOf(day);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** MM/YYYY */
export function formatMonth(day: number): string {
  const d = dateOf(day);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** 0 = Sunday … 6 = Saturday. FY2024 day 0 is a Sunday. */
export function weekday(day: number): number {
  return ((day % 7) + 7) % 7;
}

export const AS_OF_DAY = dayFromYMD(2026, 10, 18);
export const DAY_COUNT = AS_OF_DAY + 1;
/** Global week index (0 = FY2024 W1). */
export function weekOfDay(day: number): number {
  return Math.floor(day / 7);
}
export function weekStartDay(week: number): number {
  return week * 7;
}
export function weekEndDay(week: number): number {
  return week * 7 + 6;
}
/** Weeks with data, including the partial current week. */
export const WEEK_COUNT = weekOfDay(AS_OF_DAY) + 1;
export const CURRENT_WEEK = weekOfDay(AS_OF_DAY);
export const LAST_COMPLETE_WEEK = CURRENT_WEEK - 1;

export interface FiscalWeek {
  fy: FiscalYear;
  week: number;
  period: number;
  weekInPeriod: number;
  quarter: number;
}

const PERIOD_OF_WEEK: number[] = [];
const WEEK_IN_PERIOD: number[] = [];
PERIOD_WEEKS.forEach((n, p) => {
  for (let i = 0; i < n; i++) {
    PERIOD_OF_WEEK.push(p + 1);
    WEEK_IN_PERIOD.push(i + 1);
  }
});

export function fiscalOfWeek(globalWeek: number): FiscalWeek {
  const fy = (FIRST_FY + Math.floor(globalWeek / WEEKS_PER_YEAR)) as FiscalYear;
  const w = ((globalWeek % WEEKS_PER_YEAR) + WEEKS_PER_YEAR) % WEEKS_PER_YEAR;
  const period = PERIOD_OF_WEEK[w];
  return { fy, week: w + 1, period, weekInPeriod: WEEK_IN_PERIOD[w], quarter: Math.ceil(period / 3) };
}

export function fiscalOfDay(day: number): FiscalWeek {
  return fiscalOfWeek(weekOfDay(day));
}

export function globalWeek(fy: number, week: number): number {
  return (fy - FIRST_FY) * WEEKS_PER_YEAR + week - 1;
}

export interface WeekSpan {
  startWeek: number;
  endWeek: number;
}

export function periodSpan(fy: number, period: number): WeekSpan {
  let first = 0;
  for (let p = 1; p < period; p++) first += PERIOD_WEEKS[p - 1];
  const start = globalWeek(fy, first + 1);
  return { startWeek: start, endWeek: start + PERIOD_WEEKS[period - 1] - 1 };
}

export function quarterSpan(fy: number, quarter: number): WeekSpan {
  return { startWeek: periodSpan(fy, quarter * 3 - 2).startWeek, endWeek: periodSpan(fy, quarter * 3).endWeek };
}

export function yearSpan(fy: number): WeekSpan {
  return { startWeek: globalWeek(fy, 1), endWeek: globalWeek(fy, WEEKS_PER_YEAR) };
}

export function lastYearDay(day: number): number {
  return day - LY_OFFSET_DAYS;
}

export function weekLabel(week: number): string {
  const f = fiscalOfWeek(week);
  return `FY${f.fy} W${f.week}`;
}

/** Snaps any day back to the Sunday that starts its fiscal week. */
export function snapToSunday(day: number): number {
  return day - weekday(day);
}

// ---------------------------------------------------------------- Holidays

export type HolidayId =
  | 'valentines'
  | 'easter'
  | 'mothersday'
  | 'memorial'
  | 'july4'
  | 'backtoschool'
  | 'laborday'
  | 'halloween'
  | 'thanksgiving'
  | 'christmas';

export interface HolidayDef {
  id: HolidayId;
  label: string;
  note?: string;
}

export const HOLIDAYS: HolidayDef[] = [
  { id: 'valentines', label: "Valentine's / Super Bowl" },
  { id: 'easter', label: 'Easter' },
  { id: 'mothersday', label: "Mother's Day", note: 'Floral' },
  { id: 'memorial', label: 'Memorial Day' },
  { id: 'july4', label: 'July 4' },
  { id: 'backtoschool', label: 'Back-to-School' },
  { id: 'laborday', label: 'Labor Day' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'thanksgiving', label: 'Thanksgiving' },
  { id: 'christmas', label: 'Christmas / New Year' },
];

const MOVABLE: Record<number, { superBowl: number[]; easter: number[]; mothers: number[]; memorial: number[]; labor: number[]; thanks: number[] }> = {
  2024: { superBowl: [2, 11], easter: [3, 31], mothers: [5, 12], memorial: [5, 27], labor: [9, 2], thanks: [11, 28] },
  2025: { superBowl: [2, 9], easter: [4, 20], mothers: [5, 11], memorial: [5, 26], labor: [9, 1], thanks: [11, 27] },
  2026: { superBowl: [2, 8], easter: [4, 5], mothers: [5, 10], memorial: [5, 25], labor: [9, 7], thanks: [11, 26] },
};

/** The shopping week before a Sunday or Monday holiday is the one that sells. */
function shoppingWeek(day: number): number {
  const wd = weekday(day);
  return weekOfDay(wd === 0 ? day - 1 : wd === 1 ? day - 2 : day);
}

/** Holiday window for a calendar year, in global weeks. */
export function holidaySpan(id: HolidayId, year: number): WeekSpan {
  const m = MOVABLE[year];
  const d = (md: number[]) => dayFromYMD(year, md[0], md[1]);
  switch (id) {
    case 'valentines':
      return { startWeek: shoppingWeek(d(m.superBowl)), endWeek: shoppingWeek(dayFromYMD(year, 2, 14)) };
    case 'easter':
      return single(shoppingWeek(d(m.easter)));
    case 'mothersday':
      return single(shoppingWeek(d(m.mothers)));
    case 'memorial':
      return single(shoppingWeek(d(m.memorial)));
    case 'july4':
      return single(shoppingWeek(dayFromYMD(year, 7, 4)));
    case 'backtoschool':
      return { startWeek: weekOfDay(dayFromYMD(year, 8, 10)), endWeek: weekOfDay(dayFromYMD(year, 8, 24)) };
    case 'laborday':
      return single(shoppingWeek(d(m.labor)));
    case 'halloween':
      return single(shoppingWeek(dayFromYMD(year, 10, 31)));
    case 'thanksgiving':
      return single(weekOfDay(d(m.thanks)));
    case 'christmas':
      return { startWeek: weekOfDay(dayFromYMD(year, 12, 24)), endWeek: weekOfDay(dayFromYMD(year, 12, 31)) };
  }
}

function single(w: number): WeekSpan {
  return { startWeek: w, endWeek: w };
}

/** Holiday window in fiscal year `fy`. Every holiday here starts inside its calendar year's fiscal year. */
export function holidaySpanFY(id: HolidayId, fy: number): WeekSpan | null {
  if (!(fy in MOVABLE)) return null;
  return holidaySpan(id, fy);
}

export function holidayAvailable(id: HolidayId, fy: number): boolean {
  const s = holidaySpanFY(id, fy);
  return s !== null && s.endWeek <= LAST_COMPLETE_WEEK && s.startWeek >= 0;
}

/** Holiday multipliers are looked up per global week; built once. */
export function holidayWeeks(id: HolidayId): number[] {
  const out: number[] = [];
  for (const y of [2023, 2024, 2025, 2026]) {
    if (!(y in MOVABLE)) continue;
    const s = holidaySpan(id, y);
    for (let w = s.startWeek; w <= s.endWeek; w++) out.push(w);
  }
  return out;
}

/** Specific single-day anchors, used by the generator to place holiday spikes on the right week. */
export function anchorWeek(id: 'valentinesDay' | 'superBowl' | 'christmasEve' | 'newYear', year: number): number {
  const m = MOVABLE[year];
  switch (id) {
    case 'valentinesDay':
      return shoppingWeek(dayFromYMD(year, 2, 14));
    case 'superBowl':
      return shoppingWeek(dayFromYMD(year, m.superBowl[0], m.superBowl[1]));
    case 'christmasEve':
      return weekOfDay(dayFromYMD(year, 12, 24));
    case 'newYear':
      return weekOfDay(dayFromYMD(year, 12, 31));
  }
}

export const HOLIDAY_YEARS = Object.keys(MOVABLE).map(Number);
