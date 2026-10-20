import type { Uom } from './kpis';

/** Missing values (null denominators, no last-year history) render as an em dash. */
export const DASH = '—';
const MINUS = '−';
const NNBSP = ' ';

type N = number | null | undefined;
const ok = (n: N): n is number => typeof n === 'number' && Number.isFinite(n);

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function sign(n: number, s: string): string {
  return n < 0 ? `${MINUS}${s}` : s;
}

/** $58,933,695 */
export function money(n: N): string {
  if (!ok(n)) return DASH;
  const r = Math.round(n);
  return sign(r, `$${int.format(Math.abs(r))}`);
}

/** $502.1M · $1.24B · $812.4K · $950 */
export function moneyCompact(n: N): string {
  if (!ok(n)) return DASH;
  const a = Math.abs(n);
  let s: string;
  if (a >= 1e9) s = `$${dec2.format(a / 1e9)}B`;
  else if (a >= 1e6) s = `$${dec1.format(a / 1e6)}M`;
  else if (a >= 1e4) s = `$${dec1.format(a / 1e3)}K`;
  else s = `$${int.format(Math.round(a))}`;
  return sign(n, s);
}

/** $4.99 */
export function moneyUnit(n: N): string {
  if (!ok(n)) return DASH;
  return sign(n, `$${dec2.format(Math.abs(n))}`);
}

/** Fraction → 29.8 % */
export function pct(n: N, digits = 1): string {
  if (!ok(n)) return DASH;
  const r = Number((n * 100).toFixed(digits));
  return sign(r, `${Math.abs(r).toFixed(digits)}${NNBSP}%`);
}

/** Points → +0.4 pts / −0.6 pts */
export function pts(n: N, digits = 1): string {
  if (!ok(n)) return DASH;
  const r = Number(n.toFixed(digits));
  if (r === 0) return `0.${'0'.repeat(digits)} pts`;
  return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(digits)} pts`;
}

/** Signed percentage change: +3.1 % / −2.0 % */
export function pctChange(n: N): string {
  if (!ok(n)) return DASH;
  const r = Number((n * 100).toFixed(1));
  if (r === 0) return `0.0${NNBSP}%`;
  return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(1)}${NNBSP}%`;
}

/** 1,240 lb */
export function volume(n: N, uom: Uom): string {
  if (!ok(n)) return DASH;
  return `${int.format(Math.round(n))} ${uom}`;
}

/** 38.6M ea */
export function volumeCompact(n: N, uom: Uom): string {
  if (!ok(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e6) return `${dec1.format(n / 1e6)}M ${uom}`;
  if (a >= 1e4) return `${dec1.format(n / 1e3)}K ${uom}`;
  return `${int.format(Math.round(n))} ${uom}`;
}

export function count(n: N): string {
  if (!ok(n)) return DASH;
  return int.format(Math.round(n));
}

/** Direction for variance styling. Positive is good unless `invert` (e.g. loss up is bad). */
export function tone(n: N, invert = false): 'pos' | 'neg' | 'flat' {
  if (!ok(n) || Math.abs(n) < 1e-9) return 'flat';
  return (n > 0) !== invert ? 'pos' : 'neg';
}

/** Short fiscal week label for chart axes: "W12", or "FY25 W40" when it is not the latest year shown. */
export function weekTick(w: number, latestFy: number): string {
  const fy = 2024 + Math.floor(w / 52);
  const wk = (w % 52) + 1;
  return fy === latestFy ? `W${wk}` : `FY${String(fy).slice(2)} W${wk}`;
}
