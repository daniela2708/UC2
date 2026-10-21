/**
 * CSV export. Text fields are guarded against formula injection: a value starting with =, +, -, @, tab or
 * carriage return gets a leading single quote. Numbers are written as plain numbers, so negative values stay
 * numeric when the file is opened in Excel.
 */
import type { XCell } from './xlsx';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvText(v: string): string {
  const guarded = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvCell(v: XCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return csvText(v);
}

export function toCsv(head: string[], rows: XCell[][]): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(text: string, fileBase: string): void {
  try {
    const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'export'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('CSV export failed', err);
    window.alert('The export could not be created. Please try again.');
  }
}
