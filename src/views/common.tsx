/* eslint-disable react-refresh/only-export-components -- shared view helpers */
import { useMemo } from 'react';
import { globalWeek, LAST_COMPLETE_WEEK, periodSpan, weekLabel, weekStartDay } from '../data/calendar';
import { getModel, NW } from '../data/generate';
import { DEPTS, ITEMS, itemByName } from '../data/products';
import { PLANTED } from '../data/planted';
import { STORE_BY_ID } from '../data/stores';
import { effectiveTime, resolveTime, type FilterState } from '../lib/filters';
import { actions, useFilters } from '../lib/filterStore';
import { buildScope, findFlags, type Scope } from '../lib/selectors';
import type { LossBasis } from '../lib/kpis';
import { Segmented, StatusChip } from '../components/ui';

export interface ViewProps {
  openDefinitions: (id?: string) => void;
}

export function useScope(opts: { onlyDepts?: number[]; deptOnly?: boolean; noItem?: boolean } = {}) {
  const { state, update } = useFilters();
  const timeKey = JSON.stringify(effectiveTime(state));
  const range = useMemo(() => resolveTime(JSON.parse(timeKey)), [timeKey]);
  const { dept, cat, sub, item, region, districts, stores, idStores, flagged, rule } = state;
  const onlyKey = opts.onlyDepts?.join('.');
  const scope = useMemo(
    () => buildScope(state, range, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the fields the scope reads
    [range, dept, cat, sub, item, region, districts, stores, idStores, flagged, rule, onlyKey, opts.deptOnly, opts.noItem],
  );
  return { state, update, range, scope };
}

/** Loss valuation in words, for loss column headers, tiles and tooltips. */
export function lossBasisWord(basis: LossBasis): string {
  return basis === 'cost' ? 'at cost' : 'at retail';
}

/** Tooltip for a loss $ column or tile under the current valuation. */
export function lossTitle(basis: LossBasis, what = 'Known loss (KL1011)'): string {
  return `${what}, valued ${lossBasisWord(basis)} (toggle: At cost | At retail). The workbook Recon Map maps Total Loss ($) to KL1011 "Known Loss Retail $"; cost vs retail is pending validation with the business.`;
}

export function ViewToggles({
  loss = false,
  flagged = false,
  margin = false,
  children,
}: {
  loss?: boolean;
  flagged?: boolean;
  margin?: boolean;
  children?: React.ReactNode;
}) {
  const { state, update } = useFilters();
  return (
    <div className="toggle-row">
      <Segmented<'all' | 'id'>
        small
        label="Store comparability"
        value={state.idStores ? 'id' : 'all'}
        onChange={(v) => update((s) => ({ ...s, idStores: v === 'id' }))}
        options={[
          { value: 'all', label: 'All stores' },
          { value: 'id', label: 'ID stores' },
        ]}
      />
      {loss && (
        <span className="toggle-group">
          <Segmented<'cost' | 'retail'>
            small
            label="Loss valuation"
            value={state.lossBasis}
            onChange={(v) => update((s) => ({ ...s, lossBasis: v }))}
            options={[
              { value: 'cost', label: 'At cost' },
              { value: 'retail', label: 'At retail' },
            ]}
          />
          <StatusChip status="Pending validation" />
        </span>
      )}
      {flagged && (
        <Segmented<'excl' | 'incl'>
          small
          label="Likely entry errors in loss totals"
          value={state.flagged}
          onChange={(v) => update((s) => ({ ...s, flagged: v }))}
          options={[
            { value: 'excl', label: 'Excl. errors' },
            { value: 'incl', label: 'Incl. errors' },
          ]}
        />
      )}
      {margin && (
        <span className="toggle-group">
          <span className="toggle-label">Margin on</span>
          <Segmented<'gross' | 'net'>
            small
            label="Gross Margin Rate denominator"
            value={state.marginBase}
            onChange={(v) => update((s) => ({ ...s, marginBase: v }))}
            options={[
              { value: 'gross', label: 'Gross Sales' },
              { value: 'net', label: 'Net Sales' },
            ]}
          />
          {state.marginBase === 'net' && <StatusChip status="Proposed" />}
        </span>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Planted story detectors (numbers always come from the data)

export function incompleteStores(scope: Scope): number[] {
  const w = PLANTED.incomplete.week;
  if (w < scope.range.startWeek || w > scope.range.endWeek) return [];
  return PLANTED.incomplete.stores.filter((id) => {
    const st = STORE_BY_ID.get(id);
    return st && scope.storeMask[st.idx];
  });
}

export interface ExtremeHit {
  item: string;
  store: string;
  week: string;
  cost: number;
  flagged: boolean;
}

export function extremeInScope(scope: Scope): ExtremeHit | null {
  const p = PLANTED.extreme;
  const it = itemByName(p.item);
  const st = STORE_BY_ID.get(p.store);
  if (!st || !scope.itemMask[it.idx] || !scope.storeMask[st.idx]) return null;
  if (p.week < scope.range.startWeek || p.week > scope.range.endWeek) return null;
  const flagged = findFlags(scope).some((f) => f.item === it.idx && f.store === st.idx && f.week === p.week);
  return { item: it.name, store: st.code, week: weekLabel(p.week), cost: p.lossCost, flagged };
}

export function goToExtreme(update: ReturnType<typeof useFilters>['update']) {
  const p = PLANTED.extreme;
  const it = itemByName(p.item);
  update((s: FilterState) => ({
    ...actions.item(it.idx)(s),
    tab: 'loss',
    region: 0,
    districts: [],
    stores: [p.store],
    time: { ...effectiveTime(s), mode: 'fiscal', grain: 'week', weekStart: weekStartDay(p.week) },
  }));
}

export interface ShrimpStory {
  costChange: number;
  retailChange: number;
  gmNow: number;
  gmLy: number;
  fromLabel: string;
}

let shrimpCache: ShrimpStory | null = null;
/** Shrimp cost movement from FY2026 P7 to P8+ and Seafood GM % vs LY over the same weeks (chain level, default cost basis). */
export function shrimpStory(): ShrimpStory {
  if (shrimpCache) return shrimpCache;
  const m = getModel();
  const seafood = DEPTS.findIndex((d) => d.name === PLANTED.shrimpSqueeze.dept);
  const from = PLANTED.shrimpSqueeze.fromWeek;
  const p7 = periodSpan(2026, 7);
  const shrimp = ITEMS.filter((i) => i.dept === seafood && PLANTED.shrimpSqueeze.namePattern.test(i.name));
  const avg = (arr: Float32Array, w0: number, w1: number) => {
    let v = 0;
    let u = 0;
    for (const it of shrimp)
      for (let w = w0; w <= w1; w++) {
        v += arr[it.idx * NW + w] * m.units[it.idx * NW + w];
        u += m.units[it.idx * NW + w];
      }
    return v / u;
  };
  const gm = (w0: number, w1: number) => {
    let net = 0;
    let cost = 0;
    for (const it of ITEMS) {
      if (it.dept !== seafood) continue;
      for (let w = w0; w <= w1; w++) {
        const k = it.idx * NW + w;
        net += m.sales[k] * (1 - m.disc[seafood * NW + w]);
        cost += m.units[k] * m.poCost[k];
      }
    }
    return (net - cost) / net;
  };
  shrimpCache = {
    costChange: avg(m.poCost, from, LAST_COMPLETE_WEEK) / avg(m.poCost, p7.startWeek, p7.endWeek) - 1,
    retailChange: avg(m.retail, from, LAST_COMPLETE_WEEK) / avg(m.retail, p7.startWeek, p7.endWeek) - 1,
    gmNow: gm(from, LAST_COMPLETE_WEEK),
    gmLy: gm(from - 52, LAST_COMPLETE_WEEK - 52),
    fromLabel: 'FY2026 P8',
  };
  return shrimpCache;
}

export function goToShrimp(update: ReturnType<typeof useFilters>['update']) {
  const seafood = DEPTS.findIndex((d) => d.name === PLANTED.shrimpSqueeze.dept);
  update((s: FilterState) => ({
    ...actions.dept(seafood)(s),
    tab: 'items',
    time: { ...effectiveTime(s), mode: 'custom', from: weekStartDay(PLANTED.shrimpSqueeze.fromWeek), to: weekStartDay(LAST_COMPLETE_WEEK) + 6 },
  }));
}

export const P8_FY2026 = globalWeek(2026, 31);
