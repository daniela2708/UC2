import { AlertTriangle, Info } from 'lucide-react';
import { Children, useState, type ReactNode } from 'react';
import { AS_OF_DAY, fiscalOfDay, formatDay } from '../data/calendar';
import { TABS, type TabId } from '../lib/filters';
import { InfoTip } from './ui';

export function SectionHeading({
  eyebrow,
  title,
  question,
  children,
}: {
  eyebrow: string;
  title: string;
  question: string;
  children?: ReactNode;
}) {
  return (
    <section className="section-head" aria-labelledby="section-title">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="section-title" id="section-title">
        {title}
      </h2>
      <p className="section-question">{question}</p>
      {children && <p className="section-narrative">{children}</p>}
    </section>
  );
}

export interface BannerDetails {
  label?: string;
  /** Either an action (applies a filter, opens a panel) or extra text revealed inline. */
  onClick?: () => void;
  content?: ReactNode;
}

export function Banner({
  lead,
  children,
  details,
  kind = 'alert',
}: {
  lead?: string;
  children: ReactNode;
  details?: BannerDetails;
  kind?: 'alert' | 'note' | 'danger';
}) {
  const [open, setOpen] = useState(false);
  const Icon = kind === 'note' ? Info : AlertTriangle;
  return (
    <div className={`banner ${kind === 'alert' ? '' : kind}`} role={kind === 'note' ? 'note' : 'status'}>
      <Icon size={16} aria-hidden="true" />
      <div className="banner-text">
        {lead && <b>{lead} </b>}
        {children}
        {details && (
          <>
            {' '}
            <button
              type="button"
              className="btn-link"
              aria-expanded={details.content ? open : undefined}
              onClick={() => (details.onClick ? details.onClick() : setOpen((o) => !o))}
            >
              {details.label ?? 'Details'}
            </button>
          </>
        )}
        {open && details?.content && <div className="banner-extra">{details.content}</div>}
      </div>
    </div>
  );
}

/**
 * One notice at a time, as in UC1: the first (most important) banner shows, the rest fold into
 * a "+N more notices" line that expands in place.
 */
export function BannerStack({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  const rest = items.slice(1);
  return (
    <div className="banner-stack">
      {items[0]}
      {rest.length > 0 && (
        <>
          {open && rest}
          <button type="button" className="banner-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide other notices' : `+${rest.length} more notice${rest.length > 1 ? 's' : ''}`}
          </button>
        </>
      )}
    </div>
  );
}

export interface Tile {
  label: string;
  info: string;
  value: ReactNode;
  sub?: ReactNode;
  two?: boolean;
}

export function KeyFigures({ caption, tiles, note }: { caption: string; tiles: Tile[]; note?: ReactNode }) {
  return (
    <section className="card kf-card" aria-label="Key figures">
      <p className="card-caption">{caption}</p>
      <div className="kpi-row" style={{ ['--n' as string]: tiles.length }}>
        {tiles.map((t) => (
          <div className="kpi-tile" key={t.label}>
            <div className="kpi-label">
              <span>{t.label}</span>
              <InfoTip text={t.info} label={`${t.label} definition`} below />
            </div>
            <div className={`kpi-value${t.two ? ' two' : ''}`}>{t.value}</div>
            {t.sub && <div className="kpi-sub">{t.sub}</div>}
          </div>
        ))}
      </div>
      {note && (
        <p className="kf-note">
          <Info size={13} aria-hidden="true" />
          {note}
        </p>
      )}
    </section>
  );
}

export function Sparkline({ values, width = 96, height = 24 }: { values: ArrayLike<number>; width?: number; height?: number }) {
  const n = values.length;
  if (n < 2) return null;
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, values[i]);
  const y = (v: number) => (max > 0 ? height - 2 - ((height - 4) * v) / max : height - 2);
  let d = '';
  for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${((i * (width - 4)) / (n - 1) + 2).toFixed(1)},${y(values[i]).toFixed(1)}`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} vectorEffect="non-scaling-stroke" />
      <circle cx={width - 2} cy={y(values[n - 1])} r={2} />
    </svg>
  );
}

export function BottomBar({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const f = fiscalOfDay(AS_OF_DAY);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    onTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };
  return (
    <div className="bottom-bar">
      <nav className="tabs" role="tablist" aria-label="Report pages" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            aria-controls="tab-panel"
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <footer className="app-footer">
        <span>© 2026 Wizeline · Developed for Weis Markets</span>
        <span>
          Simulated data · as of {formatDay(AS_OF_DAY)} (FY{f.fy} W{f.week})
        </span>
        <span />
      </footer>
    </div>
  );
}
