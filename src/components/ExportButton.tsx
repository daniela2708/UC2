/* eslint-disable react-refresh/only-export-components -- export helpers sit with the button */
import { FileSpreadsheet } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';
import { downloadXlsx, type XCell, type XSheet } from '../lib/xlsx';
import { CellBar, Var } from './ui';
import { pctChange, pts } from '../lib/format';

/** Plain text of rendered table content (labels, chips, variances), for export. Charts and icons are skipped. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).filter((t) => t !== '').join(' ').replace(/\s+/g, ' ').trim();
  if (!isValidElement(node)) return '';
  const props = node.props as Record<string, unknown>;
  if (node.type === Var) {
    const v = props.value as number | null | undefined;
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return props.kind === 'pct' ? pctChange(v) : pts(v);
  }
  if (node.type === CellBar) return String(props.text ?? '');
  if (typeof node.type !== 'string') return nodeText(props.children as ReactNode);
  if (node.type === 'svg') return '';
  return nodeText(props.children as ReactNode);
}

export function ExportButton({ getSheet, fileName, label = 'Excel' }: { getSheet: () => XSheet; fileName: string; label?: string }) {
  return (
    <button
      type="button"
      className="chart-view-btn"
      onClick={() => downloadXlsx(getSheet(), `${fileName} ${new Date().toISOString().slice(0, 10)}`)}
      title="Download as Excel (.xlsx)"
    >
      <FileSpreadsheet size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

export type { XCell, XSheet };
