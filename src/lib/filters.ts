/**
 * Filter state, URL (de)serialisation, period resolution and cascading options.
 * Pure functions only; the React store lives in filterStore.tsx.
 */
import {
  AS_OF_DAY,
  CURRENT_WEEK,
  dayFromISO,
  FISCAL_YEARS,
  fiscalOfDay,
  fiscalOfWeek,
  formatDay,
  HOLIDAYS,
  holidayAvailable,
  holidaySpanFY,
  isoFromDay,
  LAST_COMPLETE_WEEK,
  LY_OFFSET_DAYS,
  periodSpan,
  quarterSpan,
  snapToSunday,
  weekEndDay,
  weekOfDay,
  weekStartDay,
  yearSpan,
  type HolidayId,
} from '../data/calendar';
import { CATS, DEPTS, ITEMS, SUBS, type CostType } from '../data/products';
import { DISTRICTS, isIdStore, STORE_BY_ID, STORES } from '../data/stores';
import {
  clamp,
  clampLossRule,
  COST_ELEMENTS,
  DEFAULT_COST_BASIS,
  DEFAULT_LOSS_RULE,
  DEFAULT_MARGIN_BASE,
  DEFAULT_EXPECTED_LOSS,
  clampExpectedLoss,
  type CostElement,
  type LossBasis,
  type LossRule,
  type MarginBase,
} from './kpis';

// ---------------------------------------------------------------- Types

export type TabId = 'items' | 'itemcost' | 'fresh' | 'loss' | 'cost';
/** The three workbook views come first; the rest are proposed additional views. */
export const TABS: { id: TabId; label: string; required: boolean }[] = [
  { id: 'items', label: 'Category-Item Summary', required: true },
  { id: 'itemcost', label: 'Item Cost Over Time', required: true },
  { id: 'fresh', label: 'Fresh Report', required: true },
  { id: 'loss', label: 'Loss Review', required: false },
  { id: 'cost', label: 'Cost Watch', required: false },
];
/** Tab ids from earlier builds, so shared links keep working. */
const TAB_ALIASES: Record<string, TabId> = { shrink: 'loss', storeloss: 'loss', plu: 'cost' };

export type TimeMode = 'todate' | 'rolling' | 'fiscal' | 'custom';
export type ToDateOpt = 'day' | 'wtd' | 'ptd' | 'qtd' | 'ytd';
export type RollingOpt = 6 | 13 | 26 | 52;
export type FiscalGrain = 'year' | 'quarter' | 'period' | 'week' | 'day' | 'holiday';

export interface TimeSel {
  mode: TimeMode;
  toDate: ToDateOpt;
  rolling: RollingOpt;
  grain: FiscalGrain;
  fy: number;
  quarter: number;
  period: number;
  /** Day index of the Sunday that starts the chosen week. */
  weekStart: number;
  holiday: HolidayId;
  /** Day index chosen with the Day filter. */
  day: number;
  from: number;
  to: number;
}

export type CostTypeFilter = 'all' | CostType;
export type CostSource = 'po' | 'hq';

export interface FilterState {
  tab: TabId;
  /** null = the tab's default period (user has not touched the time filter). */
  time: TimeSel | null;
  dept: number;
  cat: number;
  sub: number;
  item: number;
  region: number;
  districts: string[];
  /** Store ids (not indexes). */
  stores: number[];
  idStores: boolean;
  lossBasis: LossBasis;
  flagged: 'excl' | 'incl';
  costBasis: CostElement[];
  rule: LossRule;
  /** Gross Margin Rate denominator: Gross Sales (workbook) or Net Sales (proposed). */
  marginBase: MarginBase;
  costType: CostTypeFilter;
  /** PO (real-time) or HQ cost for PLU and random-weight items; UPC always uses HQ average cost. */
  costSource: CostSource;
  /** Item shown in Item Cost Over Time (-1 = default: largest cost change). */
  icItem: number;
  /** Visible columns per table, only when changed from the table's default. */
  cols: Record<string, string[]>;
  /** Margin After Loss: subtract actual known loss or the expected rate. */
  lossRateBasis: 'actual' | 'expected';
  /** Expected loss rates by department name (Proposed defaults, editable 0–30 %). */
  expLoss: Record<string, number>;
}

export const TO_DATE_LABEL: Record<ToDateOpt, string> = {
  day: 'Current Day',
  wtd: 'Week-to-Date',
  ptd: 'Period-to-Date',
  qtd: 'Quarter-to-Date',
  ytd: 'Year-to-Date',
};
export const ROLLING_OPTS: RollingOpt[] = [6, 13, 26, 52];
export const GRAIN_LABEL: Record<FiscalGrain, string> = {
  year: 'Year',
  quarter: 'Quarter',
  period: 'Period',
  week: 'Week beginning',
  day: 'Day',
  holiday: 'Holiday period',
};

const LAST_FY = FISCAL_YEARS[FISCAL_YEARS.length - 1];

export const BASE_TIME: TimeSel = {
  mode: 'todate',
  toDate: 'ytd',
  rolling: 13,
  grain: 'period',
  fy: LAST_FY,
  quarter: fiscalOfWeek(LAST_COMPLETE_WEEK).quarter,
  period: fiscalOfWeek(LAST_COMPLETE_WEEK).period,
  weekStart: weekStartDay(LAST_COMPLETE_WEEK),
  holiday: 'july4',
  day: AS_OF_DAY - 1,
  from: weekStartDay(LAST_COMPLETE_WEEK),
  to: AS_OF_DAY,
};

export function tabDefaultTime(tab: TabId): TimeSel {
  switch (tab) {
    case 'fresh':
      return { ...BASE_TIME, mode: 'todate', toDate: 'ptd' };
    case 'itemcost':
      return { ...BASE_TIME, mode: 'rolling', rolling: 26 };
    default:
      return { ...BASE_TIME };
  }
}

export const DEFAULT_STATE: FilterState = {
  tab: 'items',
  time: null,
  dept: -1,
  cat: -1,
  sub: -1,
  item: -1,
  region: 0,
  districts: [],
  stores: [],
  idStores: false,
  lossBasis: 'cost',
  flagged: 'excl',
  costBasis: [...DEFAULT_COST_BASIS],
  rule: { ...DEFAULT_LOSS_RULE },
  marginBase: DEFAULT_MARGIN_BASE,
  costType: 'all',
  costSource: 'po',
  icItem: -1,
  cols: {},
  lossRateBasis: 'actual',
  expLoss: { ...DEFAULT_EXPECTED_LOSS },
};

/** Which filters a tab does not use, and why. */
/** Which filters a view does not use, and why (they are greyed out with this tooltip). */
export function unusedFilters(tab: TabId): { time?: string; product?: string; sku?: string; stores?: string } {
  if (tab === 'fresh') return { sku: 'The Fresh Report works by department, category and subcategory; the workbook does not list SKU for this view.' };
  if (tab === 'itemcost')
    return {
      stores: 'Purchase orders are placed for the chain, so Region, District and Store do not apply. Business filters only narrow the SKU list.',
      sku: 'Pick the item with the SKU / PLU picker at the top of the view.',
    };
  if (tab === 'cost')
    return {
      time: 'Cost Watch compares the cost in HQ with the last 4 weeks of purchase orders, as of 10/18/2026.',
      stores: 'Purchase orders and HQ costs are chain level.',
      sku: 'Cost Watch ranks every item; click a row to open it in Item Cost Over Time.',
    };
  return {};
}

export function effectiveTime(s: FilterState): TimeSel {
  return s.time ?? tabDefaultTime(s.tab);
}

// ---------------------------------------------------------------- Time resolution

export interface ResolvedRange {
  start: number;
  end: number;
  lyStart: number;
  lyEnd: number;
  /** False when last year falls before FY2024 (no history). */
  lyAvailable: boolean;
  label: string;
  /** Short description, e.g. "Year-to-Date" or "P10 FY2026". */
  name: string;
  fyLabel: string;
  /** Complete fiscal weeks for weekly sources (purchases, known loss). */
  startWeek: number;
  endWeek: number;
  /** True when weekly sources had to be widened or clipped to complete weeks. */
  snapped: boolean;
  isDaily: boolean;
}

export function clampDay(day: number): number {
  return Math.round(clamp(day, 0, AS_OF_DAY));
}

function spanDays(startWeek: number, endWeek: number): [number, number] {
  return [weekStartDay(startWeek), Math.min(weekEndDay(endWeek), AS_OF_DAY)];
}

export function resolveTime(t: TimeSel): ResolvedRange {
  let start: number;
  let end: number;
  let name: string;
  let ly: [number, number] | null = null;
  const asOf = fiscalOfDay(AS_OF_DAY);
  switch (t.mode) {
    case 'todate': {
      end = AS_OF_DAY;
      name = TO_DATE_LABEL[t.toDate];
      if (t.toDate === 'day') start = AS_OF_DAY;
      else if (t.toDate === 'wtd') start = weekStartDay(CURRENT_WEEK);
      else if (t.toDate === 'ptd') start = weekStartDay(periodSpan(asOf.fy, asOf.period).startWeek);
      else if (t.toDate === 'qtd') start = weekStartDay(quarterSpan(asOf.fy, asOf.quarter).startWeek);
      else start = weekStartDay(yearSpan(asOf.fy).startWeek);
      break;
    }
    case 'rolling': {
      [start, end] = spanDays(LAST_COMPLETE_WEEK - t.rolling + 1, LAST_COMPLETE_WEEK);
      name = `Rolling ${t.rolling} weeks`;
      break;
    }
    case 'fiscal': {
      const fy = clamp(Math.round(t.fy), FISCAL_YEARS[0], LAST_FY);
      if (t.grain === 'year') {
        const sp = yearSpan(fy);
        [start, end] = spanDays(sp.startWeek, sp.endWeek);
        name = `FY${fy}`;
      } else if (t.grain === 'quarter') {
        const q = clamp(Math.round(t.quarter), 1, 4);
        const sp = quarterSpan(fy, q);
        [start, end] = spanDays(sp.startWeek, sp.endWeek);
        name = `Q${q} FY${fy}`;
      } else if (t.grain === 'period') {
        const p = clamp(Math.round(t.period), 1, 12);
        const sp = periodSpan(fy, p);
        [start, end] = spanDays(sp.startWeek, sp.endWeek);
        name = `P${p} FY${fy}`;
      } else if (t.grain === 'day') {
        start = end = clampDay(t.day);
        name = formatDay(start);
      } else if (t.grain === 'week') {
        const ws = snapToSunday(clampDay(t.weekStart));
        start = ws;
        end = Math.min(ws + 6, AS_OF_DAY);
        const f = fiscalOfDay(ws);
        name = `FY${f.fy} W${f.week}`;
      } else {
        const sp = holidaySpanFY(t.holiday, fy);
        const label = HOLIDAYS.find((h) => h.id === t.holiday)?.label ?? 'Holiday';
        if (sp && holidayAvailable(t.holiday, fy)) {
          [start, end] = spanDays(sp.startWeek, sp.endWeek);
          const prev = holidaySpanFY(t.holiday, fy - 1);
          ly = prev ? spanDays(prev.startWeek, prev.endWeek) : [start - LY_OFFSET_DAYS, end - LY_OFFSET_DAYS];
        } else {
          [start, end] = [AS_OF_DAY, AS_OF_DAY];
        }
        name = `${label} FY${fy}`;
      }
      if (start > AS_OF_DAY) [start, end] = [AS_OF_DAY, AS_OF_DAY];
      break;
    }
    case 'custom': {
      let a = clampDay(t.from);
      let b = clampDay(t.to);
      if (a > b) [a, b] = [b, a];
      start = a;
      end = b;
      name = 'Custom range';
      break;
    }
  }
  const [lyStart, lyEnd] = ly ?? [start - LY_OFFSET_DAYS, end - LY_OFFSET_DAYS];
  const sw = weekOfDay(start);
  let ew = Math.min(weekOfDay(end), LAST_COMPLETE_WEEK);
  let startWeek = sw;
  if (startWeek > ew) startWeek = ew = LAST_COMPLETE_WEEK;
  const snapped = start !== weekStartDay(startWeek) || end !== weekEndDay(ew);
  const fyA = fiscalOfDay(start).fy;
  const fyB = fiscalOfDay(end).fy;
  return {
    start,
    end,
    lyStart,
    lyEnd,
    lyAvailable: lyStart >= 0,
    label: start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`,
    name,
    fyLabel: fyA === fyB ? `FY${fyB}` : `FY${fyA}–FY${fyB}`,
    startWeek,
    endWeek: ew,
    snapped,
    isDaily: start === end || (t.mode === 'todate' && (t.toDate === 'day' || t.toDate === 'wtd')),
  };
}

/** Options for the fiscal PERIOD selectors; future periods are disabled. */
export function fiscalOptionAvailable(grain: FiscalGrain, fy: number, n: number): boolean {
  if (grain === 'quarter') return quarterSpan(fy, n).startWeek <= CURRENT_WEEK;
  if (grain === 'period') return periodSpan(fy, n).startWeek <= CURRENT_WEEK;
  return true;
}

export function weeksOfRange(r: ResolvedRange): number[] {
  const out: number[] = [];
  for (let w = r.startWeek; w <= r.endWeek; w++) out.push(w);
  return out;
}

// ---------------------------------------------------------------- Product and store scope

export function categoriesOf(dept: number) {
  return dept < 0 ? CATS : CATS.filter((c) => c.dept === dept);
}
export function subcategoriesOf(cat: number) {
  return cat < 0 ? [] : SUBS.filter((s) => s.cat === cat);
}

export function itemIndices(s: Pick<FilterState, 'dept' | 'cat' | 'sub' | 'item'> & { costType?: CostTypeFilter }, onlyDepts?: number[]): number[] {
  const out: number[] = [];
  for (const it of ITEMS) {
    if (s.item >= 0 && it.idx !== s.item) continue;
    if (s.sub >= 0 && it.sub !== s.sub) continue;
    if (s.cat >= 0 && it.cat !== s.cat) continue;
    if (s.dept >= 0 && it.dept !== s.dept) continue;
    if (s.costType && s.costType !== 'all' && it.costType !== s.costType) continue;
    if (onlyDepts && !onlyDepts.includes(it.dept)) continue;
    out.push(it.idx);
  }
  return out;
}

export function districtsOf(region: number) {
  return region > 0 ? DISTRICTS.filter((d) => d.region === region) : DISTRICTS;
}

/**
 * Store indexes in scope: the union of the chosen districts and the individually chosen stores
 * (everything in the region when neither is chosen). ID stores keeps stores open across the
 * whole range and last year's range.
 */
export function storeIndices(
  s: Pick<FilterState, 'region' | 'districts' | 'stores' | 'idStores'>,
  range: Pick<ResolvedRange, 'startWeek' | 'endWeek'> & { start?: number; end?: number },
): number[] {
  const sw = range.start !== undefined ? weekOfDay(range.start) : range.startWeek;
  const ew = range.end !== undefined ? weekOfDay(range.end) : range.endWeek;
  const distSet = new Set(s.districts);
  const storeSet = new Set(s.stores);
  const pickAll = distSet.size === 0 && storeSet.size === 0;
  const out: number[] = [];
  for (const st of STORES) {
    if (s.region > 0 && st.region !== s.region) continue;
    if (!pickAll && !distSet.has(st.district) && !storeSet.has(st.id)) continue;
    if (s.idStores && !isIdStore(st, sw, ew)) continue;
    out.push(st.idx);
  }
  return out;
}

export function describeProductScope(s: Pick<FilterState, 'dept' | 'cat' | 'sub' | 'item'>): string {
  if (s.item >= 0) return ITEMS[s.item].name;
  if (s.sub >= 0) return `${CATS[SUBS[s.sub].cat].name} › ${SUBS[s.sub].name}`;
  if (s.cat >= 0) return `${DEPTS[CATS[s.cat].dept].name} › ${CATS[s.cat].name}`;
  if (s.dept >= 0) return DEPTS[s.dept].name;
  return 'All fresh';
}

export function describeStoreScope(s: Pick<FilterState, 'region' | 'districts' | 'stores' | 'idStores'>): string {
  const parts: string[] = [];
  if (s.districts.length === 1) parts.push(`District ${s.districts[0]}`);
  else if (s.districts.length > 1) parts.push(`${s.districts.length} districts`);
  if (s.stores.length === 1) parts.push(`Store ${String(s.stores[0]).padStart(3, '0')}`);
  else if (s.stores.length > 1) parts.push(`${s.stores.length} stores`);
  let out = parts.join(' + ');
  if (!out) out = s.region > 0 ? `Region ${s.region}` : 'Weis Markets';
  return s.idStores ? `${out} · ID stores` : out;
}

// ---------------------------------------------------------------- Input hygiene

export const SEARCH_MAX = 40;
/** Keeps letters, digits, spaces and a few punctuation marks used in item names; caps length. */
export function sanitizeSearch(raw: string): string {
  return raw
    .slice(0, SEARCH_MAX * 2)
    .replace(/[^\p{L}\p{N} .&'/%-]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, SEARCH_MAX);
}

export function searchItems(raw: string, limit = 8): number[] {
  const q = sanitizeSearch(raw).trim().toLowerCase();
  if (q.length < 2) return [];
  const digits = /^\d+$/.test(q);
  const scored: [number, number][] = [];
  for (const it of ITEMS) {
    let score = -1;
    if (digits) {
      if (it.code === q) score = 0;
      else if (it.code.startsWith(q)) score = 1;
      else if (it.code.includes(q)) score = 2;
    } else {
      const n = it.name.toLowerCase();
      if (n.startsWith(q)) score = 0;
      else if (n.includes(` ${q}`)) score = 1;
      else if (n.includes(q)) score = 2;
    }
    if (score >= 0) scored.push([score, it.idx]);
  }
  scored.sort((a, b) => a[0] - b[0] || ITEMS[a[1]].name.localeCompare(ITEMS[b[1]].name));
  return scored.slice(0, limit).map((x) => x[1]);
}

// ---------------------------------------------------------------- URL sync

const TAB_IDS = [...TABS.map((t) => t.id), ...Object.keys(TAB_ALIASES)];
const MODES: TimeMode[] = ['todate', 'rolling', 'fiscal', 'custom'];
const TO_DATES: ToDateOpt[] = ['day', 'wtd', 'ptd', 'qtd', 'ytd'];
const GRAINS: FiscalGrain[] = ['year', 'quarter', 'period', 'week', 'day', 'holiday'];
const HOLIDAY_IDS = HOLIDAYS.map((h) => h.id);

function oneOf<T extends string | number>(v: string | null, allowed: readonly T[]): T | undefined {
  if (v === null) return undefined;
  return allowed.find((a) => String(a) === v);
}
function intIn(v: string | null, min: number, max: number): number | undefined {
  if (v === null || !/^-?\d{1,7}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= min && n <= max ? n : undefined;
}
function dayParam(v: string | null): number | undefined {
  if (v === null || v.length > 10) return undefined;
  const d = dayFromISO(v);
  return d === null ? undefined : clampDay(d);
}

export function toQuery(s: FilterState): string {
  const p = new URLSearchParams();
  p.set('tab', s.tab);
  if (s.time) {
    const t = s.time;
    p.set('tm', t.mode);
    if (t.mode === 'todate') p.set('td', t.toDate);
    if (t.mode === 'rolling') p.set('rw', String(t.rolling));
    if (t.mode === 'fiscal') {
      p.set('fg', t.grain);
      p.set('fy', String(t.fy));
      if (t.grain === 'quarter') p.set('q', String(t.quarter));
      if (t.grain === 'period') p.set('p', String(t.period));
      if (t.grain === 'week') p.set('wk', isoFromDay(t.weekStart));
      if (t.grain === 'day') p.set('dy', isoFromDay(t.day));
      if (t.grain === 'holiday') p.set('hol', t.holiday);
    }
    if (t.mode === 'custom') {
      p.set('from', isoFromDay(t.from));
      p.set('to', isoFromDay(t.to));
    }
  }
  if (s.dept >= 0) p.set('dept', String(s.dept));
  if (s.cat >= 0) p.set('cat', String(s.cat));
  if (s.sub >= 0) p.set('sub', String(s.sub));
  if (s.item >= 0) p.set('item', ITEMS[s.item].code);
  if (s.region > 0) p.set('reg', String(s.region));
  if (s.districts.length) p.set('dist', s.districts.join(','));
  if (s.stores.length) p.set('st', s.stores.join(','));
  if (s.idStores) p.set('id', '1');
  if (s.lossBasis !== 'cost') p.set('lb', s.lossBasis);
  if (s.flagged !== 'excl') p.set('fl', s.flagged);
  const cb = [...s.costBasis].sort().join(',');
  if (cb !== [...DEFAULT_COST_BASIS].sort().join(',')) p.set('cb', cb || 'none');
  if (s.rule.dollars !== DEFAULT_LOSS_RULE.dollars) p.set('rd', String(s.rule.dollars));
  if (s.rule.pct !== DEFAULT_LOSS_RULE.pct) p.set('rp', String(Math.round(s.rule.pct * 100)));
  if (s.marginBase !== DEFAULT_MARGIN_BASE) p.set('mb', s.marginBase);
  if (s.costType !== 'all') p.set('ct', s.costType);
  if (s.costSource !== 'po') p.set('cs', s.costSource);
  if (s.icItem >= 0) p.set('ic', ITEMS[s.icItem].code);
  const cols = Object.entries(s.cols)
    .map(([t, keys]) => `${t}:${keys.join('.')}`)
    .join(';');
  if (cols) p.set('cols', cols);
  if (s.lossRateBasis !== 'actual') p.set('lr', s.lossRateBasis);
  const el = Object.entries(s.expLoss)
    .filter(([d, v]) => DEFAULT_EXPECTED_LOSS[d] !== v)
    .map(([d, v]) => `${d}:${Math.round(v * 1000) / 10}`)
    .join(';');
  if (el) p.set('el', el);
  return p.toString();
}

/** Parses a query string. Anything invalid, out of range or inconsistent falls back to the default. */
export function fromQuery(query: string): FilterState {
  const p = new URLSearchParams(query.length > 2000 ? '' : query);
  const s: FilterState = structuredClone(DEFAULT_STATE);
  const tabRaw = oneOf(p.get('tab'), TAB_IDS);
  s.tab = tabRaw ? (TAB_ALIASES[tabRaw] ?? (tabRaw as TabId)) : s.tab;
  const mode = oneOf(p.get('tm'), MODES);
  if (mode) {
    const t: TimeSel = { ...tabDefaultTime(s.tab), mode };
    t.toDate = oneOf(p.get('td'), TO_DATES) ?? t.toDate;
    t.rolling = oneOf(p.get('rw'), ROLLING_OPTS.map(String))
      ? (Number(p.get('rw')) as RollingOpt)
      : t.rolling;
    t.grain = oneOf(p.get('fg'), GRAINS) ?? t.grain;
    t.fy = intIn(p.get('fy'), FISCAL_YEARS[0], LAST_FY) ?? t.fy;
    t.quarter = intIn(p.get('q'), 1, 4) ?? t.quarter;
    t.period = intIn(p.get('p'), 1, 12) ?? t.period;
    const wk = dayParam(p.get('wk'));
    if (wk !== undefined) t.weekStart = snapToSunday(wk);
    t.day = dayParam(p.get('dy')) ?? t.day;
    t.holiday = oneOf(p.get('hol'), HOLIDAY_IDS) ?? t.holiday;
    t.from = dayParam(p.get('from')) ?? t.from;
    t.to = dayParam(p.get('to')) ?? t.to;
    s.time = t;
  }
  s.dept = intIn(p.get('dept'), 0, DEPTS.length - 1) ?? -1;
  const cat = intIn(p.get('cat'), 0, CATS.length - 1);
  if (cat !== undefined && (s.dept < 0 || CATS[cat].dept === s.dept)) {
    s.cat = cat;
    s.dept = CATS[cat].dept;
  }
  const sub = intIn(p.get('sub'), 0, SUBS.length - 1);
  if (sub !== undefined && s.cat >= 0 && SUBS[sub].cat === s.cat) s.sub = sub;
  const code = p.get('item');
  if (code && /^\d{4,12}$/.test(code)) {
    const it = ITEMS.find((x) => x.code === code);
    if (it) Object.assign(s, { item: it.idx, sub: it.sub, cat: it.cat, dept: it.dept });
  }
  s.region = intIn(p.get('reg'), 1, 3) ?? 0;
  const dist = (p.get('dist') ?? '').split(',').filter((d) => DISTRICTS.some((x) => x.id === d && (s.region === 0 || x.region === s.region)));
  s.districts = [...new Set(dist)].slice(0, DISTRICTS.length);
  const stores = (p.get('st') ?? '')
    .split(',')
    .filter((x) => /^\d{1,3}$/.test(x))
    .map(Number)
    .filter((id) => STORE_BY_ID.has(id));
  s.stores = [...new Set(stores)].slice(0, STORES.length);
  s.idStores = p.get('id') === '1';
  s.lossBasis = p.get('lb') === 'retail' ? 'retail' : 'cost';
  s.flagged = p.get('fl') === 'incl' ? 'incl' : 'excl';
  const cb = p.get('cb');
  if (cb !== null) {
    const els = cb === 'none' ? [] : cb.split(',').filter((e): e is CostElement => (COST_ELEMENTS as string[]).includes(e));
    s.costBasis = [...new Set(els)];
  }
  const rd = p.get('rd');
  const rp = p.get('rp');
  s.marginBase = p.get('mb') === 'net' ? 'net' : DEFAULT_MARGIN_BASE;
  s.costType = oneOf(p.get('ct'), ['UPC', 'PLU', 'RW'] as const) ?? 'all';
  s.costSource = p.get('cs') === 'hq' ? 'hq' : 'po';
  const ic = p.get('ic');
  if (ic && /^\d{4,12}$/.test(ic)) s.icItem = ITEMS.find((x) => x.code === ic)?.idx ?? -1;
  // Column choices: "table:key.key;table:key", tokens limited to letters and digits.
  const colsRaw = p.get('cols');
  if (colsRaw && colsRaw.length <= 1000) {
    for (const part of colsRaw.split(';').slice(0, 10)) {
      const [t, keys] = part.split(':');
      if (!t || !/^[a-z]{1,12}$/.test(t) || keys === undefined) continue;
      s.cols[t] = keys
        .split('.')
        .filter((k) => /^[A-Za-z0-9]{1,16}$/.test(k))
        .slice(0, 60);
    }
  }
  s.lossRateBasis = p.get('lr') === 'expected' ? 'expected' : 'actual';
  const elRaw = p.get('el');
  if (elRaw && elRaw.length <= 300)
    for (const part of elRaw.split(';')) {
      const [d, v] = part.split(':');
      if (!(d in DEFAULT_EXPECTED_LOSS) || !v || !/^\d{1,3}(\.\d)?$/.test(v)) continue;
      const r = clampExpectedLoss(Number(v) / 100);
      if (r !== null) s.expLoss[d] = r;
    }
  s.rule = clampLossRule({
    dollars: rd !== null && /^\d{1,7}$/.test(rd) ? Number(rd) : DEFAULT_LOSS_RULE.dollars,
    pct: rp !== null && /^\d{1,5}$/.test(rp) ? Number(rp) / 100 : DEFAULT_LOSS_RULE.pct,
  });
  return s;
}
