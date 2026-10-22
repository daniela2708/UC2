/* eslint-disable react-refresh/only-export-components -- chart palette constants live with the charts */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BarChart3, Table2 } from 'lucide-react';
import { ExportButton, nodeText } from './ExportButton';
import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Customized,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Chart palette. Categorical slots validated with the dataviz validator (light surface):
 * blue → orange → aqua passes CVD and normal-vision separation; aqua needs labels or the table view.
 * Last year and budgets-as-context use the neutral de-emphasis gray. Variances use the pos/neg tokens
 * and always carry ▲ / ▼ text.
 */
export const C = {
  // Sober categorical steps (validated: lightness, chroma, CVD and normal-vision separation pass on the light surface).
  s1: '#2d63a0',
  s2: '#c27530',
  s3: '#22907a',
  s4: '#bd9306',
  ly: '#a2a19c',
  grid: '#ecebe5',
  axis: '#797873',
  pos: '#2e7d4f',
  neg: '#c62828',
  soft: '#d5e0ec',
  /** Recessive bars for a secondary panel (e.g. volume under a cost line). */
  qty: '#b3bfcc',
};

/** Categorical colors for series beyond the core four (ingredients, components). */
export const SERIES = [C.s1, C.s2, C.s3, '#6a5bbf', C.s4, '#c05380'];

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'line' | 'rect' | 'dot';
}

export interface ChartTable {
  head: string[];
  rows: (string | number)[][];
}

export type RankOrder = 'top' | 'bottom';

/**
 * Ranking order for bar charts: sorts by `value` from highest to lowest and keeps the first `n` ("top"), or the
 * lowest `n` from lowest up ("bottom").
 */
export function rankSlice<T>(rows: T[], value: (r: T) => number, order: RankOrder, n = rows.length): T[] {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  return order === 'top' ? sorted.slice(0, n) : sorted.reverse().slice(0, n);
}

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  height = 240,
  contentHeight,
  className,
  rank,
}: {
  /** Ranking charts: a Top first | Bottom first switch in the header. */
  rank?: { order: RankOrder; onChange: (o: RankOrder) => void };
  /** Full height of the chart when it is taller than `height`; the body then scrolls. */
  contentHeight?: number;
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: ChartTable;
  children: ReactNode;
  height?: number;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card${className ? ` ${className}` : ''}`} aria-label={title}>
      <header className="chart-head">
        <div>
          <h3 className="chart-title">{title}</h3>
          {subtitle && <p className="chart-sub">{subtitle}</p>}
        </div>
        {(table || rank) && (
          <span className="chart-actions">
          {rank && (
            <span className="rank-toggle" role="group" aria-label="Ranking order">
              {(['top', 'bottom'] as const).map((o) => (
                <button key={o} type="button" className={`rank-btn${rank.order === o ? ' is-on' : ''}`} aria-pressed={rank.order === o} onClick={() => rank.onChange(o)}>
                  {o === 'top' ? <ArrowDownWideNarrow size={13} aria-hidden="true" /> : <ArrowUpNarrowWide size={13} aria-hidden="true" />}
                  {o === 'top' ? 'Top first' : 'Bottom first'}
                </button>
              ))}
            </span>
          )}
          {table && (
            <>
          <ExportButton
            fileName={title}
            getSheet={() => ({ title, subtitle: nodeText(subtitle), head: table.head, rows: table.rows.map((r) => r.map((c) => c)) })}
          />
          <button
            type="button"
            className="chart-view-btn"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            title={asTable ? 'Show chart' : 'Show as table'}
          >
            {asTable ? <BarChart3 size={14} aria-hidden="true" /> : <Table2 size={14} aria-hidden="true" />}
            {asTable ? 'Chart' : 'Table'}
          </button>
            </>
          )}
          </span>
        )}
      </header>
      {legend && legend.length > 1 && !asTable && (
        <ul className="chart-legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className={`key key-${l.kind ?? 'line'}`} style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {asTable && table ? (
        <div className="chart-table-wrap" style={{ maxHeight: height + 24 }}>
          <table className="mini-table">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={i === 0 ? 'left' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j === 0 ? 'left' : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Sized height={height} contentHeight={contentHeight}>
          {children}
        </Sized>
      )}
    </section>
  );
}

/** Measures its width (on mount and on resize) and hands it to the chart, so charts never render at 0 × 0. */
function Sized({ height, contentHeight, children }: { height: number; contentHeight?: number; children: ReactNode }) {
  const scroll = !!contentHeight && contentHeight > height;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      className={`chart-body${scroll ? ' is-scroll' : ''}`}
      ref={ref}
      // A scrolling chart does not set the row height: it fills whatever its neighbour in the grid needs.
      style={scroll ? undefined : { height: contentHeight ? Math.min(height, contentHeight) : height }}
      tabIndex={scroll ? 0 : undefined}
    >
      {width > 0 && isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width, height: contentHeight ?? height })
        : null}
    </div>
  );
}

// ---------------------------------------------------------------- Tooltip

export interface TipRow {
  label: string;
  value: string;
  color?: string;
}

export function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{title}</div>
      {rows.map((r) => (
        <div className="chart-tip-row" key={r.label}>
          {r.color && <span className="tip-key" style={{ background: r.color }} />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  tick: { fill: C.axis, fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

// ---------------------------------------------------------------- Trend (lines over weeks)

interface EndLabelProps {
  formattedGraphicalItems?: { item?: { props?: { stroke?: string } }; props?: { stroke?: string; points?: { x: number; y: number | null; value?: unknown }[] } }[];
  format: (v: number) => string;
}

/** Value at the end of every line. Labels that would overlap are spread apart and tied back with a short leader. */
function EndLabels({ formattedGraphicalItems, format }: EndLabelProps) {
  const GAP = 15;
  const ends = (formattedGraphicalItems ?? [])
    .map((g) => {
      const pts = g.props?.points ?? [];
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        const v = Array.isArray(p.value) ? p.value[1] : p.value;
        if (p.y !== null && typeof p.y === 'number' && typeof v === 'number') return { x: p.x, y: p.y, v, color: g.item?.props?.stroke ?? g.props?.stroke ?? C.axis, ly: p.y };
      }
      return null;
    })
    .filter((e): e is { x: number; y: number; v: number; color: string; ly: number } => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < GAP) ends[i].ly = ends[i - 1].ly + GAP;
  return (
    <g>
      {ends.map((e, i) => (
        <g key={i}>
          {Math.abs(e.ly - e.y) > 1 && <line x1={e.x + 3} y1={e.y} x2={e.x + 10} y2={e.ly} stroke={e.color} strokeWidth={1} />}
          <circle cx={e.x + 14} cy={e.ly} r={3} fill={e.color} />
          <text x={e.x + 20} y={e.ly + 4} fontSize={12} fontWeight={800} fill="#211e1e">
            {format(e.v)}
          </text>
        </g>
      ))}
    </g>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
  width?: number;
}

/** 10 % of the data range as head- and footroom, so no line touches or leaves the plot. */
function padOf(_edge: number, data: Record<string, number | string | null>[], series: Series[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of data)
    for (const s of series) {
      const v = r[s.key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  return Number.isFinite(lo) ? Math.max((hi - lo) * 0.1, Math.abs(hi) * 0.002, 1e-6) : 0;
}

export function TrendLines({
  width,
  height,
  data,
  series,
  format,
  tickFormat,
  reference,
}: {
  width?: number;
  height?: number;
  data: Record<string, number | string | null>[];
  series: Series[];
  format: (v: number) => string;
  tickFormat?: (v: number) => string;
  reference?: { y: number; label: string };
}) {
  return (
    <LineChart width={width} height={height} data={data} margin={{ top: 10, right: 70, bottom: 0, left: 4 }}>
      <XAxis dataKey="x" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
      <YAxis
        {...axisProps}
        width={52}
        tickFormatter={tickFormat ?? format}
        domain={[(lo: number) => lo - padOf(lo, data, series), (hi: number) => hi + padOf(hi, data, series)]}
      />
      {reference && <ReferenceLine y={reference.y} stroke={C.axis} strokeWidth={1} label={{ value: reference.label, position: 'insideTopLeft', fill: C.axis, fontSize: 11 }} />}
      <Tooltip
        cursor={{ stroke: C.axis, strokeWidth: 1 }}
        content={({ active, payload, label }) =>
          active && payload?.length ? (
            <TipBox
              title={String(label)}
              rows={series
                .map((s): TipRow | null => {
                  const p = payload.find((x) => x.dataKey === s.key);
                  return p && typeof p.value === 'number' ? { label: s.label, value: format(p.value), color: s.color } : null;
                })
                .filter((r): r is TipRow => r !== null)}
            />
          ) : null
        }
      />
      {series.map((s) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          stroke={s.color}
          strokeWidth={s.width ?? 2}
          dot={false}
          activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2 }}
          connectNulls
          isAnimationActive={false}
        />
      ))}
      <Customized component={(props: unknown) => <EndLabels {...(props as EndLabelProps)} format={format} />} />
    </LineChart>
  );
}

// ---------------------------------------------------------------- Columns with a last-year line

export function ColumnsVsLy({
  width,
  height,
  data,
  format,
  tickFormat,
  avg,
}: {
  width?: number;
  height?: number;
  data: { x: string; value: number; ly: number | null; note?: string }[];
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  avg?: number;
}) {
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barCategoryGap="22%">
      <XAxis dataKey="x" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
      <YAxis {...axisProps} width={52} tickFormatter={tickFormat} />
      {avg !== undefined && (
        <ReferenceLine y={avg} stroke={C.axis} strokeWidth={1} label={{ value: `Avg ${tickFormat(avg)}`, position: 'insideTopRight', fill: C.axis, fontSize: 11 }} />
      )}
      <Tooltip
        cursor={{ fill: 'rgba(33,30,30,0.05)' }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0].payload as { value: number; ly: number | null; note?: string };
          const rows: TipRow[] = [{ label: 'This year', value: format(row.value), color: C.s1 }];
          if (row.ly !== null) rows.push({ label: 'Last year', value: format(row.ly), color: C.ly });
          if (row.note) rows.push({ label: row.note, value: '' });
          return <TipBox title={String(label)} rows={rows} />;
        }}
      />
      <Bar dataKey="value" fill={C.s1} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      <Line type="monotone" dataKey="ly" stroke={C.ly} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
    </ComposedChart>
  );
}

// ---------------------------------------------------------------- Horizontal bars

export interface HBarDatum {
  label: string;
  value: number;
  /** Optional comparison value drawn as a second, gray bar. */
  compare?: number | null;
  color?: string;
  id?: string | number;
  tip?: TipRow[];
}

/** Height of a ranking chart with `n` rows (24 px bars, or a 20 px bar plus its comparison). */
export function hbarHeight(n: number, compare = false): number {
  return Math.max(1, n) * (compare ? 46 : 36) + 8;
}

/** Round domain that always includes zero, with room for labels. */
function divDomain(data: HBarDatum[]): [number, number] {
  const vals = data.map((d) => d.value);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  return [Math.floor((lo - span * 0.08) / step) * step, Math.ceil((hi + span * 0.12) / step) * step];
}

export function HBars({
  width,
  height,
  data,
  format,
  onSelect,
  compareLabel,
  valueLabel = 'Value',
  diverging = false,
  arrows = false,
  labelWidth = 120,
  compareColor,
}: {
  arrows?: boolean;
  /** When set, the comparison is a second full-size series in this color instead of a thin gray reference bar. */
  compareColor?: string;
  width?: number;
  height?: number;
  data: HBarDatum[];
  format: (v: number) => string;
  onSelect?: (d: HBarDatum) => void;
  compareLabel?: string;
  valueLabel?: string;
  diverging?: boolean;
  labelWidth?: number;
}) {
  return (
    <BarChart width={width} height={height} data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }} barCategoryGap={compareLabel ? 8 : 10} barGap={3}>
      <XAxis type="number" hide domain={diverging ? divDomain(data) : [0, 'auto']} />
      <YAxis type="category" dataKey="label" {...axisProps} width={labelWidth} interval={0} tick={{ fill: '#211e1e', fontSize: 12 }} />
      {diverging && <ReferenceLine x={0} stroke={C.axis} strokeWidth={1} />}
      <Tooltip
        cursor={{ fill: 'rgba(33,30,30,0.05)' }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0].payload as HBarDatum;
          const rows: TipRow[] = d.tip ?? [{ label: valueLabel, value: format(d.value), color: d.color ?? C.s1 }];
          if (!d.tip && d.compare !== undefined && d.compare !== null && compareLabel) rows.push({ label: compareLabel, value: format(d.compare), color: compareColor ?? C.ly });
          return <TipBox title={d.label} rows={rows} />;
        }}
      />
      <Bar
        dataKey="value"
        radius={[0, 4, 4, 0]}
        maxBarSize={compareLabel ? 20 : 24}
        isAnimationActive={false}
        cursor={onSelect ? 'pointer' : undefined}
        onClick={(d) => onSelect?.(d as unknown as HBarDatum)}
      >
        {data.map((d) => (
          <Cell key={String(d.id ?? d.label)} fill={d.color ?? C.s1} />
        ))}
        <LabelList
          dataKey="value"
          content={(props) => {
            const { x, y, width, height, value } = props as { x: number; y: number; width: number; height: number; value: number };
            const arrow = arrows ? (value > 0.05 ? '▲ ' : value < -0.05 ? '▼ ' : '') : '';
            return (
              <text
                x={Math.max(x, x + width) + 6}
                y={y + height / 2 + 4}
                fontSize={11.5}
                fontWeight={700}
                fill="#211e1e"
                textAnchor="start"
              >
                {arrow}
                {format(value)}
              </text>
            );
          }}
        />
      </Bar>
      {compareLabel && (
        <Bar dataKey="compare" fill={compareColor ?? C.ly} radius={[0, 4, 4, 0]} maxBarSize={compareColor ? 20 : 10} isAnimationActive={false}>
          {compareColor && (
            <LabelList
              dataKey="compare"
              content={(props) => {
                const { x, y, width, height, value } = props as { x: number; y: number; width: number; height: number; value: number };
                return (
                  <text x={x + width + 6} y={y + height / 2 + 4} fontSize={11.5} fontWeight={700} fill="#211e1e">
                    {format(value)}
                  </text>
                );
              }}
            />
          )}
        </Bar>
      )}
    </BarChart>
  );
}

// ---------------------------------------------------------------- Waterfall

export interface WaterfallStep {
  label: string;
  value: number;
  kind: 'total' | 'minus';
}

export function Waterfall({
  width,
  height,
  steps,
  format,
}: {
  width?: number;
  height?: number;
  steps: WaterfallStep[];
  format: (v: number) => string;
}) {
  let run = 0;
  const data = steps.map((s) => {
    if (s.kind === 'total') {
      run = s.value;
      return { label: s.label, base: 0, bar: s.value, value: s.value, kind: s.kind };
    }
    const top = run;
    run -= s.value;
    return { label: s.label, base: run, bar: top - run, value: -s.value, kind: s.kind };
  });
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 22, right: 8, bottom: 0, left: 4 }} barCategoryGap="28%">
      <XAxis dataKey="label" {...axisProps} interval={0} tick={{ fill: '#211e1e', fontSize: 11 }} />
      <YAxis {...axisProps} width={52} tickFormatter={format} />
      <Tooltip
        cursor={{ fill: 'rgba(33,30,30,0.05)' }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const d = payload[0].payload as { label: string; value: number; kind: string };
          return <TipBox title={d.label} rows={[{ label: d.kind === 'total' ? 'Amount' : 'Reduces margin by', value: format(Math.abs(d.value)), color: d.kind === 'total' ? C.s1 : C.s2 }]} />;
        }}
      />
      <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
      <Bar dataKey="bar" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
        {data.map((d) => (
          <Cell key={d.label} fill={d.kind === 'total' ? C.s1 : C.neg} />
        ))}
        <LabelList
          dataKey="value"
          content={(props) => {
            const { x, y, width, value } = props as { x: number; y: number; width: number; value: number };
            return (
              <text x={x + width / 2} y={y - 6} fontSize={11.5} fontWeight={700} fill="#211e1e" textAnchor="middle">
                {value < 0 ? '−' : ''}
                {format(Math.abs(value))}
              </text>
            );
          }}
        />
      </Bar>
    </BarChart>
  );
}

export const ChartGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) => <div className={`chart-grid cols-${cols}`}>{children}</div>;

// ---------------------------------------------------------------- Cost over time: two stacked panels, one time axis

export interface CostQtyPoint {
  x: string;
  /** PO Cost / Unit for the bucket; null when nothing was bought (drawn as a gap). */
  cost: number | null;
  /** Current PO Cost (HQ) in force in the bucket. */
  hq: number;
  retail: number | null;
  qty: number;
}

/**
 * Real-time cost (line, with the HQ cost as a dashed reference and optional retail) above quantity
 * purchased (bars). Two panels instead of a dual axis; `syncId` keeps the crosshair and tooltip in step.
 */
export function CostQtyPanels({
  data,
  showRetail,
  fmtCost,
  fmtQty,
  qtyLabel,
  costLabel = 'PO cost / unit',
  width,
  height,
}: {
  data: CostQtyPoint[];
  costLabel?: string;
  showRetail: boolean;
  fmtCost: (v: number) => string;
  fmtQty: (v: number) => string;
  qtyLabel: string;
  width?: number;
  height?: number;
}) {
  const h = height ?? 380;
  const topH = Math.round(h * 0.62);
  const botH = h - topH;
  const costs = data.flatMap((d) => [d.cost, d.hq, showRetail ? d.retail : null]).filter((v): v is number => typeof v === 'number');
  const lo = Math.min(...costs);
  const hi = Math.max(...costs);
  const lastHq = data.length ? data[data.length - 1].hq : null;
  const pad = Math.max((hi - lo) * 0.1, hi * 0.02, 0.01);
  const tip = ({ active, payload, label }: { active?: boolean; payload?: { payload?: unknown }[]; label?: string | number }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as CostQtyPoint;
    const rows: TipRow[] = [
      { label: costLabel, value: p.cost === null ? 'No purchases (gap)' : fmtCost(p.cost), color: C.s1 },
      { label: 'Current PO Cost (HQ)', value: fmtCost(p.hq), color: C.axis },
    ];
    if (showRetail && p.retail !== null) rows.push({ label: 'Retail', value: fmtCost(p.retail), color: C.s3 });
    rows.push({ label: qtyLabel, value: fmtQty(p.qty), color: C.qty });
    return <TipBox title={String(label)} rows={rows} />;
  };
  return (
    <div style={{ width, height: h }}>
      <LineChart width={width} height={topH} data={data} syncId="itemcost" margin={{ top: 10, right: 76, bottom: 0, left: 4 }}>
        <XAxis dataKey="x" hide />
        <YAxis {...axisProps} width={60} tickFormatter={fmtCost} domain={[lo - pad, hi + pad]} allowDataOverflow />
        <Tooltip content={tip} cursor={{ stroke: C.axis, strokeWidth: 1 }} />
        <Line type="stepAfter" dataKey="hq" stroke={C.axis} strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} activeDot={false} />
        {lastHq !== null && (
          <ReferenceLine y={lastHq} stroke="none" label={{ value: `HQ ${fmtCost(lastHq)}`, position: 'right', fill: C.axis, fontSize: 11 }} />
        )}
        <Line
          type="linear"
          dataKey="cost"
          stroke={C.s1}
          strokeWidth={2}
          dot={data.length <= 16 ? { r: 2.5, fill: C.s1, strokeWidth: 0 } : false}
          connectNulls={false}
          isAnimationActive={false}
          activeDot={{ r: 4.5, stroke: '#fff', strokeWidth: 2 }}
        />
        {showRetail && <Line type="stepAfter" dataKey="retail" stroke={C.s3} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
      </LineChart>
      <BarChart width={width} height={botH} data={data} syncId="itemcost" margin={{ top: 6, right: 76, bottom: 0, left: 4 }} barCategoryGap="20%">
        <XAxis dataKey="x" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
        <YAxis {...axisProps} width={60} tickFormatter={fmtQty} />
        <Tooltip content={tip} cursor={{ fill: 'rgba(33,30,30,0.05)' }} />
        <Bar dataKey="qty" fill={C.qty} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
      </BarChart>
    </div>
  );
}

// ---------------------------------------------------------------- Stacked columns

/** Stacked columns by category (e.g. each ingredient's contribution to unit cost by week), total in the tooltip. */
export function StackedBars({
  data,
  series,
  format,
  tickFormat,
  width,
  height,
}: {
  data: Record<string, number | string>[];
  series: { key: string; label: string; color: string }[];
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  width?: number;
  height?: number;
}) {
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barCategoryGap="18%">
      <XAxis dataKey="x" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
      <YAxis {...axisProps} width={56} tickFormatter={tickFormat} />
      <Tooltip
        cursor={{ fill: 'rgba(33,30,30,0.05)' }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0].payload as Record<string, number>;
          const rows: TipRow[] = [...series].reverse().map((sr) => ({ label: sr.label, value: format(row[sr.key] ?? 0), color: sr.color }));
          rows.push({ label: 'Total unit cost', value: format(series.reduce((a, sr) => a + (row[sr.key] ?? 0), 0)) });
          return <TipBox title={String(label)} rows={rows} />;
        }}
      />
      {series.map((sr, n) => (
        <Bar
          key={sr.key}
          dataKey={sr.key}
          stackId="s"
          fill={sr.color}
          stroke="#fff"
          strokeWidth={1}
          maxBarSize={28}
          isAnimationActive={false}
          radius={n === series.length - 1 ? [3, 3, 0, 0] : undefined}
        />
      ))}
    </BarChart>
  );
}
