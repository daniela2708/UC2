import { Info } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { pts, pctChange, tone } from '../lib/format';

export function InfoTip({ text, below = false, label = 'More information' }: { text: string; below?: boolean; label?: string }) {
  const id = useId();
  return (
    <span className={`tip${below ? ' below' : ''}`} tabIndex={0} aria-label={label} aria-describedby={id} role="button">
      <Info size={13} aria-hidden="true" />
      <span className="tip-body" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}

export type Status = 'Draft' | 'Proposed' | 'Pending validation';
const STATUS_CLASS: Record<Status, string> = {
  Draft: 'status-draft',
  Proposed: 'status-proposed',
  'Pending validation': 'status-pending',
};

export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip ${STATUS_CLASS[status]}`}>{status}</span>;
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  small = false,
  disabled = false,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented${small ? ' small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Variance with arrow and colour, so direction never relies on colour alone. */
export function Var({
  value,
  kind = 'pts',
  invert = false,
}: {
  value: number | null | undefined;
  kind?: 'pts' | 'pct';
  invert?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="flat">—</span>;
  // Direction follows the value as displayed (one decimal), so 0.0 never carries an arrow.
  const shown = kind === 'pts' ? Number(value.toFixed(1)) : Number((value * 100).toFixed(1));
  const t = shown === 0 ? 'flat' : tone(value, invert);
  const arrow = shown > 0 ? '▲' : shown < 0 ? '▼' : '';
  const text = kind === 'pts' ? pts(value) : pctChange(value);
  return (
    <span className={`var ${t}`}>
      {arrow && <span aria-hidden="true">{arrow} </span>}
      {text}
    </span>
  );
}

export function Field({
  label,
  children,
  disabledReason,
  htmlFor,
  className,
}: {
  label: string;
  children: ReactNode;
  disabledReason?: string | null;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`field${disabledReason ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`} title={disabledReason ?? undefined}>
      <span className="field-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {disabledReason && <InfoTip text={disabledReason} label={`${label} is not used here`} />}
      </span>
      {children}
    </div>
  );
}

/** Number with a small proportional bar, for scanning a column. */
export function CellBar({
  value,
  max,
  text,
  warm = false,
  band,
}: {
  value: number | null;
  max: number;
  text: string;
  warm?: boolean;
  /** Target band, drawn as a shaded range on the track. */
  band?: { lo: number; hi: number };
}) {
  const at = (v: number) => (max <= 0 ? 0 : Math.max(0, Math.min(1, v / max)) * 100);
  const w = value === null || !Number.isFinite(value) ? 0 : at(value);
  const below = band && value !== null && value < band.lo;
  return (
    <span className="cell-bar" title={band ? `Target ${(band.lo * 100).toFixed(0)}–${(band.hi * 100).toFixed(0)} %` : undefined}>
      {text}
      <span className={`track${band ? ' banded' : ''}`} aria-hidden="true">
        {band && <span className="band" style={{ left: `${at(band.lo)}%`, width: `${at(band.hi) - at(band.lo)}%` }} />}
        <span className={`fill${warm || below ? ' warm' : ''}`} style={{ width: `${w.toFixed(1)}%` }} />
      </span>
    </span>
  );
}

/** High Loss Flag (weekly loss above $1,000) with the proposed reason labels as a secondary line. */
export function FlagCell({ flags, errors, extra }: { flags: number; errors: number; extra?: ReactNode }) {
  if (!flags && !extra) return null;
  const review = flags - errors;
  const reasons = [errors > 0 ? `${errors} likely entry error${errors === 1 ? '' : 's'}` : '', review > 0 ? `${review} to review` : ''].filter(Boolean).join(' · ');
  return (
    <span className="flag-cell">
      {flags > 0 && (
        <span className="flag-stack">
          <span className={`chip ${errors > 0 ? 'error' : 'amber'}`}>
            {flags} flag{flags === 1 ? '' : 's'}
          </span>
          <span className="flag-reason" title="Reason labels (Proposed)">
            {reasons}
          </span>
        </span>
      )}
      {extra}
    </span>
  );
}
