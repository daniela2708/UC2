import { ArrowUpRight, Columns3, SquareMinus, SquarePlus } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFilters } from '../lib/filterStore';
import { ExportButton, nodeText } from './ExportButton';

export type ColGroup = 'Sales' | 'Cost' | 'Margin' | 'Loss' | 'Sell-through' | 'YoY' | 'Budget' | 'Period';

export interface HierCol {
  key: string;
  label: string;
  title?: string;
  left?: boolean;
  sortable?: boolean;
  /** Group in the column chooser. */
  group?: ColGroup;
  /** Proposed or secondary columns start hidden; the column chooser shows them. */
  defaultHidden?: boolean;
}

export interface HierRow {
  id: string;
  label: ReactNode;
  sub?: ReactNode;
  cells: Record<string, ReactNode>;
  sort: Record<string, number | string | null>;
  children?: HierRow[];
  drill?: { label: string; onClick: () => void };
  /** Extra row actions shown after the label (e.g. a simulator button). */
  extra?: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
}

type Dir = 'desc' | 'asc';

function compare(a: number | string | null | undefined, b: number | string | null | undefined, dir: Dir): number {
  const am = a === null || a === undefined || (typeof a === 'number' && !Number.isFinite(a));
  const bm = b === null || b === undefined || (typeof b === 'number' && !Number.isFinite(b));
  if (am && bm) return 0;
  if (am) return 1;
  if (bm) return -1;
  const c = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : (a as number) - (b as number);
  return dir === 'asc' ? c : -c;
}

export function HierTable({
  hierarchy,
  columns,
  total,
  rows,
  defaultSort,
  defaultExpanded = [],
  empty = 'No data for the current filters.',
  exportTitle,
  maxHeight = 640,
  tableId,
  presets = [],
  tools,
}: {
  /** The view's own table controls, shown on the same row as Columns and Export (left of them). */
  tools?: ReactNode;
  /** Named column sets offered in the column chooser (e.g. "Loss focus"). */
  presets?: { label: string; keys: string[] }[];
  /** Enables the column chooser; the choice is stored in the URL under this id. */
  tableId?: string;
  /** Title of the downloaded sheet; when set, an Excel button exports every row (expanded or not). */
  exportTitle?: string;
  /** Rows scroll inside the card past this height; the header stays visible. */
  maxHeight?: number;
  hierarchy: string;
  columns: HierCol[];
  total?: HierRow;
  rows: HierRow[];
  defaultSort: { key: string; dir: Dir };
  defaultExpanded?: string[];
  empty?: string;
}) {
  const { state, update } = useFilters();
  const defaultVisible = columns.filter((c) => !c.defaultHidden).map((c) => c.key);
  const chosen = tableId ? state.cols[tableId] : undefined;
  const visibleKeys = new Set((chosen ?? defaultVisible).filter((k) => columns.some((c) => c.key === k)));
  const shownCols = tableId ? columns.filter((c) => visibleKeys.has(c.key)) : columns;
  const setVisible = (keys: string[] | null) =>
    update((st) => {
      const cols = { ...st.cols };
      if (keys === null || (keys.length === defaultVisible.length && keys.every((k) => defaultVisible.includes(k)))) delete cols[tableId!];
      else cols[tableId!] = keys;
      return { ...st, cols };
    });
  const [sort, setSort] = useState(defaultSort);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded));

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sorted = useMemo(() => {
    const sortRows = (rs: HierRow[]): HierRow[] =>
      [...rs]
        .sort((a, b) => compare(a.sort[sort.key], b.sort[sort.key], sort.dir))
        .map((r) => (r.children ? { ...r, children: sortRows(r.children) } : r));
    return sortRows(rows);
  }, [rows, sort]);

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'label' ? 'asc' : 'desc' }));

  const renderRow = (r: HierRow, level: number, isTotal = false): ReactNode => {
    const hasKids = !!r.children && r.children.length > 0;
    const open = expanded.has(r.id);
    return (
      <Fragment key={r.id}>
        <tr
          className={[
            isTotal ? 'total-row' : '',
            r.selected ? 'is-selected' : '',
            r.onSelect ? 'clickable' : '',
            r.className ?? '',
          ].join(' ')}
          onClick={r.onSelect}
          aria-selected={r.onSelect ? !!r.selected : undefined}
        >
          <td className={`left lvl-${level}`}>
            <div className="hier-label" style={{ paddingLeft: level * 18 }}>
              {hasKids ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} row`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.id);
                  }}
                >
                  {open ? <SquareMinus size={15} /> : <SquarePlus size={15} />}
                </button>
              ) : (
                <span className="icon-spacer" />
              )}
              <span className="lbl">
                <span>{r.label}</span>
                {r.sub && <small>{r.sub}</small>}
              </span>
              {r.extra}
              {r.drill && (
                <button
                  type="button"
                  className="icon-btn"
                  title={r.drill.label}
                  aria-label={r.drill.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    r.drill?.onClick();
                  }}
                >
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          </td>
          {shownCols.map((c) => (
            <td key={c.key} className={c.left ? 'left' : undefined}>
              {r.cells[c.key]}
            </td>
          ))}
        </tr>
        {hasKids && open && r.children!.map((k) => renderRow(k, level + 1))}
      </Fragment>
    );
  };

  const ariaSort = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

  const getSheet = () => {
    const out: string[][] = [];
    const walk = (r: HierRow, level: number) => {
      out.push([`${'    '.repeat(level)}${nodeText(r.label)}${r.sub ? ` (${nodeText(r.sub)})` : ''}`, ...columns.map((c) => nodeText(r.cells[c.key]))]);
      r.children?.forEach((k) => walk(k, level + 1));
    };
    if (total) walk(total, 0);
    sorted.forEach((r) => walk(r, 0));
    return { title: exportTitle ?? hierarchy, subtitle: hierarchy, head: [hierarchy, ...columns.map((c) => c.label)], rows: out };
  };

  return (
    <>
    {(exportTitle || tableId || tools) && (
      <div className={`table-export${tools ? ' with-tools' : ''}`}>
        {tools && <div className="table-tools-inline">{tools}</div>}
        <span className="table-buttons">
        {tableId && (
          <ColumnChooser
            columns={columns}
            presets={presets}
            visible={visibleKeys}
            onChange={(keys) => setVisible(keys)}
            onReset={() => setVisible(null)}
          />
        )}
        {exportTitle && <ExportButton getSheet={getSheet} fileName={exportTitle} label="Export to Excel" />}
        </span>
      </div>
    )}
    <div className="table-scroll" style={{ maxHeight }}>
      <table className="hier">
        <thead>
          <tr>
            <th className="left" scope="col" aria-sort={ariaSort('label')}>
              <button type="button" className="sort-btn" onClick={() => onSort('label')}>
                {hierarchy}
                <span className="sort-ind" aria-hidden="true">
                  {sort.key === 'label' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                </span>
              </button>
            </th>
            {shownCols.map((c) => (
              <th key={c.key} scope="col" className={c.left ? 'left' : undefined} aria-sort={c.sortable === false ? undefined : ariaSort(c.key)} title={c.title}>
                {c.sortable === false ? (
                  c.label
                ) : (
                  <button type="button" className="sort-btn" onClick={() => onSort(c.key)}>
                    {c.label}
                    <span className="sort-ind" aria-hidden="true">
                      {sort.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {total && renderRow(total, 0, true)}
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={shownCols.length + 1} className="empty">
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((r) => renderRow(r, 0))
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}

const GROUP_ORDER: ColGroup[] = ['Sales', 'Cost', 'Margin', 'Loss', 'Sell-through', 'YoY', 'Budget', 'Period'];

/** Column chooser popover: checkboxes by group, plus Reset to default. */
function ColumnChooser({
  columns,
  presets,
  visible,
  onChange,
  onReset,
}: {
  columns: HierCol[];
  presets: { label: string; keys: string[] }[];
  visible: Set<string>;
  onChange: (keys: string[]) => void;
  onReset: () => void;
}) {
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
  const groups = GROUP_ORDER.map((g) => ({ g, cols: columns.filter((c) => (c.group ?? 'Sales') === g) })).filter((x) => x.cols.length);
  const toggle = (key: string) => {
    const next = columns.filter((c) => (c.key === key ? !visible.has(key) : visible.has(c.key))).map((c) => c.key);
    onChange(next);
  };
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="chart-view-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Columns3 size={14} aria-hidden="true" />
        Columns
      </button>
      {open && (
        <div className="popover col-chooser" role="dialog" aria-label="Choose columns">
          {presets.length > 0 && (
            <div className="col-presets">
              <span>Presets</span>
              {presets.map((p) => {
                const on = p.keys.length === visible.size && p.keys.every((k) => visible.has(k));
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`chip-btn${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      onChange(columns.filter((c) => p.keys.includes(c.key)).map((c) => c.key));
                      setOpen(false);
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="popover-body">
            {groups.map(({ g, cols }) => (
              <fieldset key={g} className="col-group">
                <legend>{g}</legend>
                {cols.map((c) => (
                  <label key={c.key} className="check-row">
                    <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} />
                    {c.label}
                    {c.defaultHidden && <span className="chip status-proposed">Optional</span>}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="popover-foot">
            <span>
              {visible.size} of {columns.length} columns · Excel always exports all
            </span>
            <span className="foot-actions">
              <button type="button" className="btn-link" onClick={() => onChange(columns.map((c) => c.key))}>
                Show all
              </button>
              <button type="button" className="btn-link" onClick={onReset}>
                Workbook default
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
