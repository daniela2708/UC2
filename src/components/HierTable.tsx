import { ArrowUpRight, SquareMinus, SquarePlus } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ExportButton, nodeText } from './ExportButton';

export interface HierCol {
  key: string;
  label: string;
  title?: string;
  left?: boolean;
  sortable?: boolean;
}

export interface HierRow {
  id: string;
  label: ReactNode;
  sub?: ReactNode;
  cells: Record<string, ReactNode>;
  sort: Record<string, number | string | null>;
  children?: HierRow[];
  drill?: { label: string; onClick: () => void };
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
}: {
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
          {columns.map((c) => (
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
    {exportTitle && (
      <div className="table-export">
        <ExportButton getSheet={getSheet} fileName={exportTitle} label="Export to Excel" />
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
            {columns.map((c) => (
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
              <td colSpan={columns.length + 1} className="empty">
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
