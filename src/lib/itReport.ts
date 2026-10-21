/**
 * Review list of flagged entries that category managers hand to IT for removal (user story 4).
 * Session only: no backend and no email; the exported file is the hand-off.
 */
import { formatDay, weekLabel, weekStartDay } from '../data/calendar';
import { ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import type { XCell, XSheet } from './xlsx';
import { isEntryError, type FlagHit } from './selectors';

export interface ItEntry {
  item: number;
  store: number;
  week: number;
  units: number;
  cost: number;
  reason: string;
}

export const itKey = (e: { item: number; store: number; week: number }) => `${e.item}-${e.store}-${e.week}`;

/** Reason label of a flag (proposed refinement of the workbook flag). */
export function flagReason(f: FlagHit): string {
  if (isEntryError(f)) return f.extreme ? 'Likely entry error · above $100,000 per entry' : 'Likely entry error';
  return f.kind === 'overstock' ? 'High loss to review · post-holiday overstock' : 'High loss to review';
}

export function itEntryOf(f: FlagHit): ItEntry {
  return { item: f.item, store: f.store, week: f.week, units: f.units, cost: f.cost, reason: flagReason(f) };
}

export const IT_HEAD = ['Item', 'SKU Number', 'Store Num', 'District', 'Week', 'Week beginning', 'Known Loss (Units)', 'UoM', 'Known Loss ($, at cost)', 'Reason'];

/** Export rows: text for names, labels and reasons; plain numbers for units and dollars. */
export function itRows(entries: ItEntry[]): XCell[][] {
  return entries.map((e) => {
    const it = ITEMS[e.item];
    const st = STORES[e.store];
    return [it.name, it.code, st.code, st.district, weekLabel(e.week), formatDay(weekStartDay(e.week)), Math.round(e.units * 10) / 10, it.uom, Math.round(e.cost * 100) / 100, e.reason];
  });
}

export function itSheet(entries: ItEntry[]): XSheet {
  return {
    title: 'Known loss entries reported to IT',
    subtitle: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} for review and removal · known loss at cost`,
    head: IT_HEAD,
    rows: itRows(entries),
  };
}
