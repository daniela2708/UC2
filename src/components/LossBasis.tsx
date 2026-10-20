import { Percent } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEPTS } from '../data/products';
import { useFilters } from '../lib/filterStore';
import { clampExpectedLoss, DEFAULT_EXPECTED_LOSS } from '../lib/kpis';
import { InfoTip, Segmented, StatusChip } from './ui';

/** Loss basis for Margin After Loss %, with the expected loss rates as editable assumptions (Proposed). */
export function LossBasisControl() {
  const { state, update } = useFilters();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(DEPTS.map((d) => [d.name, String(Math.round((state.expLoss[d.name] ?? 0) * 1000) / 10)])));
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the draft when the popover opens
  }, [open]);
  const commit = (dept: string, text: string) => {
    setDraft((d) => ({ ...d, [dept]: text.slice(0, 5) }));
    if (!/^\d{1,2}(\.\d)?$/.test(text.trim())) return;
    const r = clampExpectedLoss(Number(text) / 100);
    if (r !== null) update((s) => ({ ...s, expLoss: { ...s.expLoss, [dept]: r } }));
  };
  return (
    <span className="toggle-group">
      <span className="toggle-label">Loss basis</span>
      <Segmented<'actual' | 'expected'>
        small
        label="Loss basis for Margin After Loss"
        value={state.lossRateBasis}
        onChange={(v) => update((s) => ({ ...s, lossRateBasis: v }))}
        options={[
          { value: 'actual', label: 'Actual known loss' },
          { value: 'expected', label: 'Expected rate' },
        ]}
      />
      <InfoTip text="Margin After Loss % (Proposed column) = Gross Margin Rate − loss rate. The Deli team subtracts an expected total loss rate (12 % today) from gross profit." />
      <div className="popover-anchor" ref={ref}>
        <button type="button" className="chart-view-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
          <Percent size={13} aria-hidden="true" />
          Assumptions
        </button>
        {open && (
          <div className="popover assumptions-popover" role="dialog" aria-label="Expected loss rates">
            <div className="popover-head">
              <b>
                Expected loss rates <StatusChip status="Proposed" />
              </b>
            </div>
            <div className="popover-body" style={{ padding: '6px 12px' }}>
              {DEPTS.map((d) => (
                <label key={d.name} className="check-row assumption-row">
                  <span>{d.name}</span>
                  <input
                    className="text-input"
                    inputMode="decimal"
                    aria-label={`${d.name} expected loss %`}
                    maxLength={5}
                    value={draft[d.name] ?? ''}
                    onChange={(e) => commit(d.name, e.target.value)}
                  />
                  %
                </label>
              ))}
            </div>
            <div className="popover-foot">
              <span>0–30 %, clamped</span>
              <button type="button" className="btn-link" onClick={() => update((s) => ({ ...s, expLoss: { ...DEFAULT_EXPECTED_LOSS } }))}>
                Reset
              </button>
            </div>
          </div>
        )}
      </div>
    </span>
  );
}
