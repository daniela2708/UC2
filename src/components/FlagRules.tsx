import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFilters } from '../lib/filterStore';
import { money } from '../lib/format';
import { clampLossRule, DEFAULT_LOSS_RULE, ENTRY_ERROR_MULTIPLE, FLAG_BASIS_NOTE, LOSS_RULE_LIMITS } from '../lib/kpis';
import { EXTREME_ENTRY_DOLLARS } from '../data/planted';
import { Field, InfoTip, StatusChip } from './ui';

/**
 * High Loss Flag rules. The workbook flag is weekly loss above $1,000; the reason labels and the
 * 26-week rule are proposed refinements. Values are validated and clamped.
 */
export function FlagRulesForm() {
  const { state, update } = useFilters();
  const [dollars, setDollars] = useState(String(state.rule.dollars));
  const [pctText, setPctText] = useState(String(Math.round(state.rule.pct * 100)));
  useEffect(() => {
    setDollars(String(state.rule.dollars));
    setPctText(String(Math.round(state.rule.pct * 100)));
  }, [state.rule]);
  const commit = (d: string, p: string) => {
    if (!/^\d{1,7}$/.test(d.trim()) || !/^\d{1,5}$/.test(p.trim())) return;
    update((s) => ({ ...s, rule: clampLossRule({ dollars: Number(d), pct: Number(p) / 100, avg: s.rule.avg }) }));
  };
  return (
    <div className="flag-rules">
      <p className="rule-line">
        <b>High Loss Flag</b> (workbook): known loss higher than <b>{money(state.rule.dollars)}</b> for an item in a store in a given week.
      </p>
      <p className="rule-line">
        Threshold basis: <b>at cost</b>, assumed <StatusChip status="Pending validation" /> <InfoTip text={FLAG_BASIS_NOTE} />
      </p>
      <p className="rule-line">
        Reason labels <StatusChip status="Proposed" />: <span className="chip error">Likely entry error</span> loss units above {ENTRY_ERROR_MULTIPLE}× the
        item-store typical weekly units, or above {money(EXTREME_ENTRY_DOLLARS)}; otherwise <span className="chip amber">High loss to review</span>.
      </p>
      <div className="rules-grid">
        <Field label={`Threshold $ (${LOSS_RULE_LIMITS.dollars.min}–${LOSS_RULE_LIMITS.dollars.max.toLocaleString('en-US')})`} htmlFor="rule-dollars">
          <input
            id="rule-dollars"
            className="text-input"
            inputMode="numeric"
            maxLength={7}
            value={dollars}
            onChange={(e) => {
              setDollars(e.target.value.slice(0, 7));
              commit(e.target.value, pctText);
            }}
            onBlur={() => setDollars(String(state.rule.dollars))}
          />
        </Field>
        <Field label={`Above 26-week avg % (${LOSS_RULE_LIMITS.pct.min * 100}–${LOSS_RULE_LIMITS.pct.max * 100})`} htmlFor="rule-pct">
          <input
            id="rule-pct"
            className="text-input"
            inputMode="numeric"
            maxLength={5}
            disabled={!state.rule.avg}
            value={pctText}
            onChange={(e) => {
              setPctText(e.target.value.slice(0, 5));
              commit(dollars, e.target.value);
            }}
            onBlur={() => setPctText(String(Math.round(state.rule.pct * 100)))}
          />
        </Field>
        <button type="button" className="btn-outline" onClick={() => update((s) => ({ ...s, rule: { ...DEFAULT_LOSS_RULE } }))}>
          Reset rule
        </button>
      </div>
      <label className="check-row rule-line">
        <input type="checkbox" checked={state.rule.avg} onChange={(e) => update((s) => ({ ...s, rule: { ...s.rule, avg: e.target.checked } }))} />
        <span>
          Also require loss more than <b>{Math.round(state.rule.pct * 100)} %</b> above the item-store <b>26-week average</b> <StatusChip status="Proposed" />
        </span>
      </label>
      <p className="rule-line muted">Today reports hide any entry above about $1,000 per SKU.</p>
    </div>
  );
}

export function FlagRulesButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="chart-view-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        Flag rules
      </button>
      {open && (
        <div className="popover rules-popover" role="dialog" aria-label="High Loss Flag rules">
          <div className="popover-head">
            <b>
              High Loss Flag rules <StatusChip status="Pending validation" />
            </b>
          </div>
          <div className="popover-body" style={{ padding: '6px 12px 12px' }}>
            <FlagRulesForm />
          </div>
        </div>
      )}
    </div>
  );
}
