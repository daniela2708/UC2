import { useEffect, useMemo, useRef, useState } from 'react';
import { KPI_DEFINITIONS, OPEN_QUESTIONS } from '../lib/definitions';
import { sanitizeSearch, SEARCH_MAX } from '../lib/filters';

/** KPI definitions modal, in the UC1 format: one table with definition, calculation, source and status. */
export function DefinitionsDrawer({ open, focusId, onClose }: { open: boolean; focusId: string | null; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeRef.current?.focus();
    if (focusId) document.getElementById(`def-${focusId}`)?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, focusId, onClose]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return KPI_DEFINITIONS;
    return KPI_DEFINITIONS.filter((d) => [d.name, d.definition, d.formula, d.source, d.status].some((f) => f.toLowerCase().includes(q)));
  }, [query]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="defs-modal" role="dialog" aria-modal="true" aria-labelledby="defs-title" onClick={(e) => e.stopPropagation()}>
        <div className="defs-head">
          <h2 id="defs-title">KPI definitions</h2>
          <div className="defs-intro">
            <p>
              Prototype definitions for validation with Weis. They are not official definitions; the three required views are Category-Item Summary, Item Cost Over Time and Fresh Report; open questions are listed at the end. All figures are simulated.
            </p>
            <input
              className="text-input defs-search"
              type="search"
              placeholder="Search KPIs"
              aria-label="Search KPI definitions"
              maxLength={SEARCH_MAX}
              value={query}
              onChange={(e) => setQuery(sanitizeSearch(e.target.value))}
            />
          </div>
        </div>
        <div className="defs-body">
          <table className="defs-table">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Business definition</th>
                <th>Calculation</th>
                <th>Data source</th>
                <th>Views</th>
                <th>Validation status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} id={`def-${d.id}`} className={d.id === focusId ? 'is-focus' : undefined}>
                  <th scope="row">
                    {d.name} <span className="defs-unit">({d.unit})</span>
                  </th>
                  <td>
                    {d.definition}
                    {d.note && <> {d.note}</>}
                  </td>
                  <td>{d.formula}</td>
                  <td>
                    {d.source}
                    <span className="defs-recon">Reconciles to: {d.reconciliation}</span>
                  </td>
                  <td className="defs-views">{d.views.join(' · ')}</td>
                  <td>
                    {d.status}
                    {d.priority && <span className="defs-recon">{d.priority}</span>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No KPI matches “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <h3 className="defs-q-title">Open questions from the workbook</h3>
          <ul className="defs-questions">
            {OPEN_QUESTIONS.map((q) => (
              <li key={q.id}>
                <span className="chip amber">Open question</span>
                <b>{q.question}</b>
                <span className="defs-recon">{q.context}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="defs-foot">
          <button ref={closeRef} type="button" className="defs-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
