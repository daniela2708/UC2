/* eslint-disable react-refresh/only-export-components -- context provider, hook and actions belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CATS, ITEMS, SUBS } from '../data/products';
import { STORE_BY_ID } from '../data/stores';
import { DEFAULT_STATE, effectiveTime, fromQuery, toQuery, type FilterState, type TabId, type TimeSel } from './filters';

interface FilterApi {
  state: FilterState;
  update: (fn: (s: FilterState) => FilterState) => void;
}

const FilterContext = createContext<FilterApi | null>(null);

function readUrl(): FilterState {
  try {
    return fromQuery(window.location.search.replace(/^\?/, ''));
  } catch (err) {
    console.error('Could not read filters from the URL', err);
    return structuredClone(DEFAULT_STATE);
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FilterState>(readUrl);

  useEffect(() => {
    try {
      const q = toQuery(state);
      window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    } catch (err) {
      console.error('Could not write filters to the URL', err);
    }
  }, [state]);

  const update = useCallback((fn: (s: FilterState) => FilterState) => setState((s) => fn(s)), []);
  const api = useMemo(() => ({ state, update }), [state, update]);
  return <FilterContext.Provider value={api}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterApi {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used inside FilterProvider');
  return ctx;
}

// ---------------------------------------------------------------- Actions (pure state transitions)

export const actions = {
  tab: (tab: TabId) => (s: FilterState): FilterState => ({ ...s, tab }),
  time: (patch: Partial<TimeSel>) => (s: FilterState): FilterState => ({ ...s, time: { ...effectiveTime(s), ...patch } }),
  dept: (dept: number) => (s: FilterState): FilterState => ({ ...s, dept, cat: -1, sub: -1, item: -1 }),
  cat: (cat: number) => (s: FilterState): FilterState => ({
    ...s,
    cat,
    dept: cat >= 0 ? CATS[cat].dept : s.dept,
    sub: -1,
    item: -1,
  }),
  sub: (sub: number) => (s: FilterState): FilterState => ({ ...s, sub, item: -1 }),
  item: (item: number) => (s: FilterState): FilterState => {
    if (item < 0) return { ...s, item: -1 };
    const it = ITEMS[item];
    return { ...s, item, sub: it.sub, cat: SUBS[it.sub].cat, dept: it.dept };
  },
  region: (region: number) => (s: FilterState): FilterState => ({
    ...s,
    region,
    districts: [],
    stores: region > 0 ? s.stores.filter((id) => STORE_BY_ID.get(id)?.region === region) : s.stores,
  }),
  places: (districts: string[], stores: number[]) => (s: FilterState): FilterState => ({ ...s, districts, stores }),
  reset: () => (s: FilterState): FilterState => ({ ...structuredClone(DEFAULT_STATE), tab: s.tab }),
};
