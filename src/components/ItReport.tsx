/* eslint-disable react-refresh/only-export-components -- provider, hook and panels belong together */
import { Download, FileSpreadsheet, Send, Trash2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { weekLabel } from '../data/calendar';
import { ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import { downloadCsv, toCsv } from '../lib/csv';
import { money, volume } from '../lib/format';
import { IT_HEAD, itEntryOf, itKey, itRows, itSheet, type ItEntry } from '../lib/itReport';
import type { FlagHit } from '../lib/selectors';
import { downloadXlsx } from '../lib/xlsx';

interface ItList {
  entries: ItEntry[];
  has: (f: { item: number; store: number; week: number }) => boolean;
  add: (flags: FlagHit[]) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const ItContext = createContext<ItList>({ entries: [], has: () => false, add: () => undefined, remove: () => undefined, clear: () => undefined });

export function useItReport() {
  return useContext(ItContext);
}

/** Session-only review list; it is lost on reload by design (no backend). */
export function ItReportProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ItEntry[]>([]);
  const keys = useMemo(() => new Set(entries.map(itKey)), [entries]);
  const has = useCallback((f: { item: number; store: number; week: number }) => keys.has(itKey(f)), [keys]);
  const add = useCallback(
    (flags: FlagHit[]) =>
      setEntries((list) => {
        const seen = new Set(list.map(itKey));
        const added = flags.filter((f) => !seen.has(itKey(f))).map(itEntryOf);
        return added.length ? [...list, ...added].slice(0, 500) : list;
      }),
    [],
  );
  const remove = useCallback((key: string) => setEntries((list) => list.filter((e) => itKey(e) !== key)), []);
  const clear = useCallback(() => setEntries([]), []);
  const value = useMemo(() => ({ entries, has, add, remove, clear }), [entries, has, add, remove, clear]);
  return <ItContext.Provider value={value}>{children}</ItContext.Provider>;
}

/** "Report to IT" action for one or more flagged entries. */
export function ReportToItButton({ flags, label = 'Report to IT' }: { flags: FlagHit[]; label?: string }) {
  const { has, add } = useItReport();
  const pending = flags.filter((f) => !has(f));
  if (flags.length === 0) return null;
  const done = pending.length === 0;
  return (
    <button
      type="button"
      className={`chart-view-btn it-btn${done ? ' is-done' : ''}`}
      disabled={done}
      title={done ? 'Already on the IT review list' : 'Add to the IT review list'}
      onClick={(e) => {
        e.stopPropagation();
        add(pending);
      }}
    >
      <Send size={13} aria-hidden="true" />
      {done ? 'On IT list' : label}
    </button>
  );
}

/** The review list with the hand-off exports (CSV and Excel). */
export function ItReviewList() {
  const { entries, remove, clear } = useItReport();
  const stamp = new Date().toISOString().slice(0, 10);
  const total = entries.reduce((a, e) => a + e.cost, 0);
  return (
    <section className="card side-card" aria-label="IT review list">
      <div className="side-actions">
        <div>
          <h3 className="side-title">IT review list · {entries.length}</h3>
          <p className="side-sub">Entries to remove from known loss. Kept for this session only; the export is the hand-off to IT.</p>
        </div>
        <div className="side-buttons">
          <button type="button" className="chart-view-btn" disabled={!entries.length} onClick={() => downloadCsv(toCsv(IT_HEAD, itRows(entries)), `Known loss for IT ${stamp}`)}>
            <Download size={14} aria-hidden="true" />
            Export list for IT (CSV)
          </button>
          <button type="button" className="chart-view-btn" disabled={!entries.length} onClick={() => downloadXlsx(itSheet(entries), `Known loss for IT ${stamp}`)}>
            <FileSpreadsheet size={14} aria-hidden="true" />
            Excel
          </button>
          <button type="button" className="chart-view-btn" disabled={!entries.length} onClick={clear}>
            <Trash2 size={14} aria-hidden="true" />
            Clear
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="empty">No entries yet. Use “Report to IT” on a flagged row.</p>
      ) : (
        <div className="po-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th className="left">Item</th>
                <th className="left">Store</th>
                <th className="left">Week</th>
                <th title="Known Loss (Units)">Units</th>
                <th title="Known Loss ($), at cost">Loss ($) · at cost</th>
                <th className="left">Reason</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const it = ITEMS[e.item];
                const k = itKey(e);
                return (
                  <tr key={k}>
                    <td className="left wrap">
                      <span className="code-tag">{it.code}</span>
                      {it.name}
                    </td>
                    <td className="left" title={STORES[e.store].district}>
                      {STORES[e.store].code}
                    </td>
                    <td className="left">{weekLabel(e.week)}</td>
                    <td>{volume(e.units, it.uom)}</td>
                    <td>{money(e.cost)}</td>
                    <td className="left wrap">{e.reason}</td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={`Remove ${it.name}, store ${STORES[e.store].code}`} onClick={() => remove(k)}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td className="left" colSpan={4}>
                  Total
                </td>
                <td>{money(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
