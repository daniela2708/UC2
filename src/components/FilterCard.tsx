import { CalendarDays, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  AS_OF_DAY,
  dayFromISO,
  dayFromUS,
  formatDay,
  FISCAL_YEARS,
  HOLIDAYS,
  holidayAvailable,
  isoFromDay,
  snapToSunday,
  weekOfDay,
} from '../data/calendar';
import { DEPTS } from '../data/products';
import { REGIONS } from '../data/stores';
import {
  categoriesOf,
  clampDay,
  effectiveTime,
  fiscalOptionAvailable,
  GRAIN_LABEL,
  resolveTime,
  ROLLING_OPTS,
  subcategoriesOf,
  TO_DATE_LABEL,
  type FiscalGrain,
  type RollingOpt,
  type TimeMode,
  type ToDateOpt,
  unusedFilters,
} from '../lib/filters';
import { actions, useFilters } from '../lib/filterStore';
import { Select } from './Select';
import { SkuSearch } from './SkuSearch';
import { StorePopover } from './StorePopover';
import { Field, InfoTip, Segmented } from './ui';

const COMPOSITE_DEPTS = new Set(['Deli', 'Bakery']);

/** Date field in MM/DD/YYYY (US format) regardless of the browser locale; the calendar button opens the native picker. */
function DateInput({ label, value, onChange, disabledReason }: { label: string; value: number; onChange: (d: number) => void; disabledReason?: string }) {
  const id = useId();
  const [text, setText] = useState(formatDay(value));
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(formatDay(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const d = dayFromUS(text);
    if (d === null) {
      setInvalid(text.trim() !== formatDay(value));
      return;
    }
    setInvalid(false);
    const c = clampDay(d);
    setText(formatDay(c));
    if (c !== value) onChange(c);
  };
  return (
    <Field label={label} htmlFor={id} disabledReason={disabledReason}>
      <div className={`date-field${invalid ? ' is-invalid' : ''}`}>
        <input
          id={id}
          className="text-input"
          type="text"
          inputMode="numeric"
          placeholder="mm/dd/yyyy"
          maxLength={10}
          aria-invalid={invalid}
          title={invalid ? 'Use mm/dd/yyyy, from 12/31/2023 to 10/18/2026' : 'mm/dd/yyyy'}
          value={text}
          disabled={!!disabledReason}
          onChange={(e) => setText(e.target.value.replace(/[^\d/]/g, '').slice(0, 10))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <button
          type="button"
          className="date-btn"
          aria-label={`Pick ${label.toLowerCase()} from a calendar`}
          disabled={!!disabledReason}
          onClick={() => {
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus();
            }
          }}
        >
          <CalendarDays size={14} aria-hidden="true" />
        </button>
        <input
          ref={picker}
          className="date-native"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          min={isoFromDay(0)}
          max={isoFromDay(AS_OF_DAY)}
          value={isoFromDay(value)}
          onChange={(e) => {
            const d = dayFromISO(e.target.value);
            if (d !== null) onChange(clampDay(d));
          }}
        />
      </div>
    </Field>
  );
}

export function FilterCard() {
  const { state, update } = useFilters();
  const unused = unusedFilters(state.tab);
  const t = effectiveTime(state);
  const range = resolveTime(t);
  const timeOff = unused.time;
  // The Fresh Report is weekly: no Current Day or Day options.
  const weeklyOnly = state.tab === 'fresh';
  const setTime = (patch: Parameters<typeof actions.time>[0]) => update(actions.time(patch));

  const periodOptions = (() => {
    switch (t.mode) {
      case 'todate':
        return (Object.keys(TO_DATE_LABEL) as ToDateOpt[]).filter((k) => !(weeklyOnly && k === 'day')).map((k) => ({ value: k, label: TO_DATE_LABEL[k] }));
      case 'rolling':
        return ROLLING_OPTS.map((n) => ({ value: String(n), label: `${n}-week rolling` }));
      case 'fiscal':
        return (Object.keys(GRAIN_LABEL) as FiscalGrain[]).filter((k) => !(weeklyOnly && k === 'day')).map((k) => ({ value: k, label: GRAIN_LABEL[k] }));
      default:
        return [];
    }
  })();
  const periodValue = t.mode === 'todate' ? t.toDate : t.mode === 'rolling' ? String(t.rolling) : t.grain;
  const onPeriod = (v: string) => {
    if (t.mode === 'todate') setTime({ toDate: v as ToDateOpt });
    else if (t.mode === 'rolling') setTime({ rolling: Number(v) as RollingOpt });
    else setTime({ grain: v as FiscalGrain });
  };
  const sw = weekOfDay(range.start);
  const ew = weekOfDay(range.end);
  const fw = (w: number) => `W${(w % 52) + 1}`;

  const productOff = unused.product;
  const cats = categoriesOf(state.dept);
  const subs = subcategoriesOf(state.cat);

  return (
    <section className="card filter-card" aria-label="Filters">
      <div className="filter-row">
        <span className="row-label">
          Time
          <InfoTip text="Weeks run Sunday to Saturday on the Weis fiscal calendar (52 weeks, 12 periods). Data runs through Sun 10/18/2026; weekly sources stop at the last complete week, FY2026 W42." below />
        </span>
        <Field label="View by" disabledReason={timeOff}>
          <Segmented<TimeMode>
            label="Time selection type"
            value={t.mode}
            disabled={!!timeOff}
            onChange={(mode) => setTime({ mode })}
            options={[
              { value: 'todate', label: 'To Date' },
              { value: 'rolling', label: 'Rolling' },
              { value: 'fiscal', label: 'Fiscal Calendar' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </Field>
        {t.mode !== 'custom' && <Select label="Period" value={periodValue} options={periodOptions} onChange={onPeriod} disabledReason={timeOff} />}
        {t.mode === 'fiscal' && t.grain !== 'week' && t.grain !== 'day' && (
          <Select
            label="Fiscal year"
            value={String(t.fy)}
            options={FISCAL_YEARS.map((y) => ({ value: String(y), label: `FY${y}` }))}
            onChange={(v) => setTime({ fy: Number(v) })}
            disabledReason={timeOff}
          />
        )}
        {t.mode === 'fiscal' && t.grain === 'quarter' && (
          <Select
            label="Quarter"
            value={String(t.quarter)}
            options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q} (P${q * 3 - 2}–P${q * 3})`, disabled: !fiscalOptionAvailable('quarter', t.fy, q) }))}
            onChange={(v) => setTime({ quarter: Number(v) })}
            disabledReason={timeOff}
          />
        )}
        {t.mode === 'fiscal' && t.grain === 'period' && (
          <Select
            label="Fiscal period"
            value={String(t.period)}
            options={Array.from({ length: 12 }, (_, i) => ({
              value: String(i + 1),
              label: `P${i + 1}`,
              disabled: !fiscalOptionAvailable('period', t.fy, i + 1),
            }))}
            onChange={(v) => setTime({ period: Number(v) })}
            disabledReason={timeOff}
          />
        )}
        {t.mode === 'fiscal' && t.grain === 'day' && (
          <DateInput label="Day" value={t.day} onChange={(d) => setTime({ day: d })} disabledReason={timeOff} />
        )}
        {t.mode === 'fiscal' && t.grain === 'week' && (
          <DateInput label="Week beginning (Sunday)" value={t.weekStart} onChange={(d) => setTime({ weekStart: snapToSunday(d) })} disabledReason={timeOff} />
        )}
        {t.mode === 'fiscal' && t.grain === 'holiday' && (
          <Select
            label="Holiday"
            value={t.holiday}
            options={HOLIDAYS.map((h) => ({
              value: h.id,
              label: `${h.label}${h.note ? ` (${h.note})` : ''}${holidayAvailable(h.id, t.fy) ? '' : ' · not yet'}`,
              disabled: !holidayAvailable(h.id, t.fy),
            }))}
            onChange={(v) => setTime({ holiday: v as typeof t.holiday })}
            disabledReason={timeOff}
          />
        )}
        {t.mode === 'custom' && (
          <>
            <DateInput label="From" value={t.from} onChange={(d) => setTime({ from: d })} disabledReason={timeOff} />
            <DateInput label="To" value={t.to} onChange={(d) => setTime({ to: d })} disabledReason={timeOff} />
          </>
        )}
        <span className="range-hint">
          {timeOff ? 'FY2026 year to date · as of 10/18/2026' : `${range.label} · ${range.fyLabel} ${fw(sw)}${sw !== ew ? `–${fw(ew)}` : ''}`}
          {!timeOff && t.mode === 'fiscal' && t.grain === 'holiday' && ' · LY aligned to the same holiday'}
        </span>
        <span className="filter-spacer" />
        <button type="button" className="btn-outline" onClick={() => update(actions.reset())}>
          <RotateCcw size={14} aria-hidden="true" />
          Reset filters
        </button>
      </div>

      <div className="filter-row">
        <span className="row-label">
          Business
          <InfoTip text="Department, category and subcategory cascade. Region, district and store cascade. All filters apply to every tab unless greyed out." below />
        </span>
        <Select
          className="w-dept"
          label="Department"
          value={String(state.dept)}
          options={[
            { value: '-1', label: 'All fresh' },
            ...DEPTS.map((d) => ({
              value: String(d.idx),
              label: state.tab === 'ingredients' && !COMPOSITE_DEPTS.has(d.name) ? `${d.name} (no composite PLUs)` : d.name,
              disabled: state.tab === 'ingredients' && !COMPOSITE_DEPTS.has(d.name),
            })),
          ]}
          onChange={(v) => update(actions.dept(Number(v)))}
        />
        <Select
          className="w-cat"
          label="Category"
          value={String(state.cat)}
          options={[{ value: '-1', label: 'All categories' }, ...cats.map((c) => ({ value: String(c.idx), label: state.dept < 0 ? `${DEPTS[c.dept].name} › ${c.name}` : c.name }))]}
          onChange={(v) => update(actions.cat(Number(v)))}
          disabledReason={productOff}
        />
        <Select
          className="w-sub"
          label="Subcategory"
          value={String(state.sub)}
          options={[{ value: '-1', label: state.cat < 0 ? 'Choose a category' : 'All subcategories' }, ...subs.map((s) => ({ value: String(s.idx), label: s.name }))]}
          onChange={(v) => update(actions.sub(Number(v)))}
          disabledReason={productOff}
          disabled={state.cat < 0}
        />
        <Field label="Chain">
          <span className="static-field">Weis Markets</span>
        </Field>
        <Select
          className="w-region"
          label="Region"
          value={String(state.region)}
          options={[{ value: '0', label: 'All regions' }, ...REGIONS.map((r) => ({ value: String(r), label: `Region ${r}` }))]}
          onChange={(v) => update(actions.region(Number(v)))}
          disabledReason={unused.stores}
        />
        <StorePopover
          region={state.region}
          districts={state.districts}
          stores={state.stores}
          onChange={(d, s) => update(actions.places(d, s))}
          disabledReason={unused.stores}
        />
        <Select
          className="w-region"
          label="Cost type"
          value={state.costType}
          options={[
            { value: 'all', label: 'All' },
            { value: 'UPC', label: 'UPC' },
            { value: 'PLU', label: 'PLU' },
            { value: 'RW', label: 'Random weight' },
          ]}
          onChange={(v) => update((s) => ({ ...s, costType: v as typeof s.costType, item: -1 }))}
          disabledReason={unused.sku && state.tab === 'fresh' ? 'The Fresh Report works by department, category and subcategory.' : undefined}
        />
        <SkuSearch item={state.item} onSelect={(i) => update(actions.item(i))} disabledReason={unused.sku ?? productOff} />
      </div>
    </section>
  );
}
