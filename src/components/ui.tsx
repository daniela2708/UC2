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
export function CellBar({ value, max, text, warm = false }: { value: number | null; max: number; text: string; warm?: boolean }) {
  const w = value === null || !Number.isFinite(value) || max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <span className="cell-bar">
      {text}
      <span className="track" aria-hidden="true">
        <span className={`fill${warm ? ' warm' : ''}`} style={{ width: `${(w * 100).toFixed(1)}%` }} />
      </span>
    </span>
  );
}
