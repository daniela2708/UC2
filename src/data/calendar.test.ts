import { describe, expect, it } from 'vitest';
import {
  AS_OF_DAY,
  dayFromISO,
  fiscalOfDay,
  formatDay,
  globalWeek,
  holidaySpan,
  lastYearDay,
  LAST_COMPLETE_WEEK,
  PERIOD_WEEKS,
  periodSpan,
  quarterSpan,
  snapToSunday,
  weekday,
  weekEndDay,
  weekStartDay,
  yearSpan,
} from './calendar';

describe('fiscal calendar', () => {
  it('starts each fiscal year on the agreed Sunday', () => {
    expect(formatDay(weekStartDay(globalWeek(2024, 1)))).toBe('12/31/2023');
    expect(formatDay(weekStartDay(globalWeek(2025, 1)))).toBe('12/29/2024');
    expect(formatDay(weekStartDay(globalWeek(2026, 1)))).toBe('12/28/2025');
  });

  it('places FY2026 W42 on 10/11–10/17/2026, in P10 W3', () => {
    const w = globalWeek(2026, 42);
    expect(formatDay(weekStartDay(w))).toBe('10/11/2026');
    expect(formatDay(weekEndDay(w))).toBe('10/17/2026');
    const f = fiscalOfDay(weekStartDay(w));
    expect(f).toMatchObject({ fy: 2026, week: 42, period: 10, weekInPeriod: 3, quarter: 4 });
  });

  it('has W43 starting on the as-of date and W42 as the last complete week', () => {
    expect(formatDay(AS_OF_DAY)).toBe('10/18/2026');
    expect(fiscalOfDay(AS_OF_DAY)).toMatchObject({ fy: 2026, week: 43 });
    expect(LAST_COMPLETE_WEEK).toBe(globalWeek(2026, 42));
  });

  it('gives P3, P6, P9 and P11 five weeks and the rest four, 52 in total', () => {
    expect(PERIOD_WEEKS.reduce((a, b) => a + b, 0)).toBe(52);
    for (let p = 1; p <= 12; p++) {
      const s = periodSpan(2026, p);
      expect(s.endWeek - s.startWeek + 1).toBe([3, 6, 9, 11].includes(p) ? 5 : 4);
    }
  });

  it('builds quarters from P1–3, P4–6, P7–9, P10–12', () => {
    expect(quarterSpan(2025, 1)).toEqual({ startWeek: periodSpan(2025, 1).startWeek, endWeek: periodSpan(2025, 3).endWeek });
    expect(quarterSpan(2025, 4).endWeek).toBe(yearSpan(2025).endWeek);
  });

  it('maps last year to the same weekday 364 days earlier', () => {
    const d = dayFromISO('2026-10-11')!;
    expect(lastYearDay(d)).toBe(d - 364);
    expect(weekday(lastYearDay(d))).toBe(weekday(d));
    expect(formatDay(lastYearDay(d))).toBe('10/12/2025');
    expect(fiscalOfDay(lastYearDay(d))).toMatchObject({ fy: 2025, week: 42 });
  });

  it('snaps any date to the Sunday that starts its week', () => {
    const wed = dayFromISO('2026-10-14')!;
    expect(formatDay(snapToSunday(wed))).toBe('10/11/2026');
    expect(weekday(snapToSunday(wed))).toBe(0);
  });

  it('rejects malformed and impossible dates', () => {
    expect(dayFromISO('2026-02-30')).toBeNull();
    expect(dayFromISO('10/11/2026')).toBeNull();
    expect(dayFromISO('')).toBeNull();
  });

  it('lines up holidays across years in their shopping week', () => {
    for (const y of [2024, 2025, 2026]) {
      const t = holidaySpan('thanksgiving', y);
      expect(t.startWeek).toBe(t.endWeek);
      const v = holidaySpan('valentines', y);
      expect(v.endWeek - v.startWeek).toBe(1);
    }
    expect(formatDay(weekStartDay(holidaySpan('easter', 2026).startWeek))).toBe('03/29/2026');
  });
});

describe('US date format', () => {
  it('parses mm/dd/yyyy and rejects other formats and impossible dates', async () => {
    const { dayFromUS, dayFromYMD, formatDay } = await import('./calendar');
    expect(dayFromUS('10/18/2026')).toBe(dayFromYMD(2026, 10, 18));
    expect(dayFromUS('1/5/2025')).toBe(dayFromYMD(2025, 1, 5));
    expect(formatDay(dayFromUS('01/05/2025')!)).toBe('01/05/2025');
    expect(dayFromUS('18/10/2026')).toBeNull();
    expect(dayFromUS('2026-10-18')).toBeNull();
    expect(dayFromUS('02/30/2025')).toBeNull();
    expect(dayFromUS('')).toBeNull();
  });
});
