import { Calculator, Search } from 'lucide-react';
import { useSimulator } from '../components/Simulator';
import { belowTarget, catBand } from '../data/targets';
import { useId, useMemo, useState } from 'react';
import { fiscalOfWeek, formatDay, LAST_COMPLETE_WEEK, weekOfDay } from '../data/calendar';
import { getModel, NW } from '../data/generate';
import { COST_TYPE_LABEL, DEPTS, ITEMS, type Item } from '../data/products';
import {
  compositeCostAt,
  costSeries,
  currentPoCost,
  newPoCost,
  ordersOf,
  recipeLines,
  supplyOf,
} from '../data/purchasing';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { C, ChartCard, ChartGrid, CostQtyPanels, TrendLines, type CostQtyPoint } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { Field, InfoTip, Segmented, StatusChip, Var } from '../components/ui';
import { sanitizeSearch, SEARCH_MAX } from '../lib/filters';
import { pickerItems, resolveIcItem } from '../lib/itemCost';
import { count, moneyCompact, moneyUnit, pct, pctChange, volume, weekTick } from '../lib/format';
import { costChange, pointsDiff, safeDiv } from '../lib/kpis';
import { useScope, type ViewProps } from './common';

const COST_METHOD_TIP =
  'Real-time cost comes from purchase orders in the ordering system (Biceps) and may change after invoice reconciliation.';

function ItemPicker({ list, value, onChange }: { list: number[]; value: number; onChange: (i: number) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const q = text.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 1) return list.slice(0, 12);
    return list.filter((i) => ITEMS[i].code.startsWith(q) || ITEMS[i].name.toLowerCase().includes(q)).slice(0, 12);
  }, [q, list]);
  const sel = value >= 0 ? ITEMS[value] : null;
  const choose = (i: number) => {
    onChange(i);
    setText('');
    setOpen(false);
  };
  return (
    <Field label="SKU / PLU (required)" htmlFor={`${id}-in`}>
      <div className="typeahead item-picker">
        <Search size={14} aria-hidden="true" />
        <input
          id={`${id}-in`}
          className="text-input"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && results.length ? `${id}-o${active}` : undefined}
          placeholder={sel ? `${sel.code} · ${sel.name}` : 'Search number or name'}
          maxLength={SEARCH_MAX}
          value={text}
          onChange={(e) => {
            setText(sanitizeSearch(e.target.value));
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && results[active] !== undefined) {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && results.length > 0 && (
          <ul className="typeahead-list" role="listbox" id={`${id}-list`}>
            {results.map((i, n) => (
              <li
                key={i}
                id={`${id}-o${n}`}
                role="option"
                aria-selected={n === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                <span>
                  {ITEMS[i].name} <span className="chip neutral">{COST_TYPE_LABEL[ITEMS[i].costType]}</span>
                </span>
                <span className="code">{ITEMS[i].code}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

/** Average retail per unit (gross sales ÷ units) over the 4 weeks ending at week `w`. */
function retailAt(i: number, w: number): number | null {
  const m = getModel();
  let s = 0;
  let u = 0;
  for (let x = Math.max(0, w - 3); x <= w; x++) {
    s += m.sales[i * NW + x];
    u += m.units[i * NW + x];
  }
  return safeDiv(s, u);
}

export function ItemCostView({ openDefinitions }: ViewProps) {
  const { state, update, range } = useScope();
  const list = useMemo(() => pickerItems(state.dept, state.cat, state.sub, state.costType), [state.dept, state.cat, state.sub, state.costType]);
  const item = resolveIcItem(list, state.icItem);
  const [showRetail, setShowRetail] = useState(false);
  const setItem = (i: number) => update((s) => ({ ...s, icItem: i }));

  if (item < 0) {
    return (
      <>
        <SectionHeading eyebrow="Item cost" title="Item Cost Over Time" question="What does this item really cost us, and since when?" />
        <section className="card empty" role="status">
          No items match the current business filters. Clear the department, category or cost type filter to pick an item.
        </section>
      </>
    );
  }
  return <ItemCostBody item={ITEMS[item]} list={list} setItem={setItem} range={range} showRetail={showRetail} setShowRetail={setShowRetail} openDefinitions={openDefinitions} />;
}

function ItemCostBody({
  item: it,
  list,
  setItem,
  range,
  showRetail,
  setShowRetail,
  openDefinitions,
}: {
  item: Item;
  list: number[];
  setItem: (i: number) => void;
  range: ReturnType<typeof useScope>['range'];
  showRetail: boolean;
  setShowRetail: (v: boolean) => void;
  openDefinitions: ViewProps['openDefinitions'];
}) {
  const i = it.idx;
  const m = getModel();
  const sup = supplyOf(i);
  const unit = it.uom;
  const endWeek = Math.min(weekOfDay(range.end), LAST_COMPLETE_WEEK);
  const series = useMemo(() => costSeries(i, range.start, range.end), [i, range.start, range.end]);
  const current = currentPoCost(i);
  const next = newPoCost(i, range.end);
  const change = costChange(current, next);
  const retail = retailAt(i, endWeek);
  const gmCurrent = retail && retail > 0 ? 1 - current / retail : null;
  const gmNew = retail && retail > 0 && next !== null ? 1 - next / retail : null;
  const band = catBand(it.cat);
  const simulate = useSimulator();
  const fy = fiscalOfWeek(endWeek).fy;

  const chartData: CostQtyPoint[] = series.points.map((p) => {
    const w = Math.min(weekOfDay(p.day), NW - 1);
    return {
      x: series.grain === 'week' ? weekTick(w, fy) : formatDay(p.day).slice(0, 5),
      cost: p.cost,
      retail: m.retail[i * NW + w],
      qty: p.units,
      cases: p.cases,
    };
  });

  // Est. margin impact over the range: (real-time cost − HQ cost) × units sold, week by week.
  const { impact, unitsSold, qty, cases } = useMemo(() => {
    let impact = 0;
    let unitsSold = 0;
    const w0 = weekOfDay(range.start);
    const w1 = Math.min(weekOfDay(range.end), LAST_COMPLETE_WEEK);
    const weekly = costSeries(i, w0 * 7, w1 * 7 + 6);
    const byWeek = new Map<number, number | null>();
    if (weekly.grain === 'week') for (const p of weekly.points) byWeek.set(weekOfDay(p.day), p.cost);
    else {
      const acc = new Map<number, { n: number; u: number }>();
      for (const p of weekly.points) {
        if (p.cost === null) continue;
        const w = weekOfDay(p.day);
        const a = acc.get(w) ?? { n: 0, u: 0 };
        a.n += p.cost * p.units;
        a.u += p.units;
        acc.set(w, a);
      }
      for (const [w, a] of acc) byWeek.set(w, a.u > 0 ? a.n / a.u : null);
    }
    let last = current;
    for (let w = w0; w <= w1; w++) {
      const c = it.composite ? compositeCostAt(it, w) : byWeek.get(w) ?? last;
      if (c !== null) last = c;
      const u = m.units[i * NW + w];
      unitsSold += u;
      impact += ((c ?? current) - current) * u;
    }
    let qty = 0;
    let cases = 0;
    for (const p of series.points) {
      qty += p.units;
      cases += p.cases;
    }
    return { impact, unitsSold, qty, cases };
  }, [i, it, range.start, range.end, current, m, series]);

  const orders = useMemo(() => ordersOf(i).filter((o) => o.day >= range.start && o.day <= range.end).reverse(), [i, range.start, range.end]);
  const recipe = it.composite ? recipeLines(it, endWeek) : [];

  const tiles: Tile[] = [
    { label: 'Current PO Cost', info: 'The per-unit cost held in HQ / Retalix today, which Power BI uses.', value: moneyUnit(current), sub: `HQ · updated ${sup.hqUpdatedLabel}${it.costType === 'UPC' ? ' · average cost' : ''}` },
    { label: 'New PO Cost', info: 'Latest real cost from purchase orders: recency-weighted last 4 weeks (0.4 / 0.3 / 0.2 / 0.1 × quantity), freight included.', value: moneyUnit(next), sub: it.composite ? 'Recipe at today’s component costs' : 'Last 4 weeks of POs, incl. freight' },
    { label: 'Cost change', info: 'New PO Cost − Current PO Cost, in $ and %.', value: <Var value={change.pct} kind="pct" invert />, sub: change.abs === null ? '—' : `${change.abs >= 0 ? '+' : '−'}${moneyUnit(Math.abs(change.abs))} per ${unit}` },
    {
      label: it.composite ? 'Units sold in range' : 'PO quantity purchased',
      info: it.composite ? 'Composite PLUs are made in store; quantity shown is units sold.' : 'Units received on purchase orders in the selected range.',
      value: volume(it.composite ? unitsSold : qty, unit),
      sub: it.composite ? 'Made to sell' : `${count(cases)} cases · ${sup.caseLabel}`,
    },
    {
      label: 'GM Rate · current cost',
      info: 'Gross Margin Rate at the HQ cost: 1 − cost ÷ average retail (last 4 weeks). Target band is Proposed.',
      value: pct(gmCurrent),
      sub: (
        <>
          Retail {moneyUnit(retail)} / {unit} · target {(band.lo * 100).toFixed(0)}–{(band.hi * 100).toFixed(0)} %{belowTarget(gmCurrent, band) && <> <span className="chip neutral">Below target</span></>}
        </>
      ),
    },
    {
      label: 'GM Rate · new cost',
      info: 'Gross Margin Rate at New PO Cost, against the category target band (Proposed).',
      value: pct(gmNew),
      sub: (
        <>
          <Var value={pointsDiff(gmNew, gmCurrent)} /> vs current cost{belowTarget(gmNew, band) && <> · <span className="chip neutral">Below target</span></>}
        </>
      ),
    },
    { label: 'Est. margin impact', info: 'Σ (real-time PO cost − HQ cost) × units sold, week by week over the range. Positive = margin overstated by the HQ cost.', value: moneyCompact(impact), sub: impact > 0 ? 'Margin overstated in reports' : 'Margin understated in reports' },
  ];

  const qtyLabel = it.composite ? 'Units sold' : 'Quantity purchased';
  const fmtQty = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(Math.round(v)));

  return (
    <>
      <SectionHeading eyebrow="Item cost" title="Item Cost Over Time" question="What does this item really cost us, and since when?">
        {it.name} ({it.code}), {range.label}: Current PO Cost <b>{moneyUnit(current)}</b> / {unit} in HQ vs New PO Cost <b>{moneyUnit(next)}</b> (
        <b>
          <Var value={change.pct} kind="pct" invert />
        </b>
        ); estimated margin impact <b>{moneyCompact(impact)}</b> over the range.
      </SectionHeading>

      <div className="toggle-row ic-picker-row">
        <ItemPicker list={list} value={i} onChange={setItem} />
        <span className="toggle-group">
          <span className="chip neutral">{COST_TYPE_LABEL[it.costType]}</span>
          <span className="toggle-label">{DEPTS[it.dept].name}</span>
          <span className="toggle-label">Cost method</span>
          <StatusChip status="Pending validation" />
          <InfoTip text={COST_METHOD_TIP} />
        </span>
        <span className="filter-spacer" />
        <button type="button" className="btn-outline" onClick={() => simulate(i)}>
          <Calculator size={14} aria-hidden="true" />
          Simulate cost change
        </button>
      </div>

      {it.costType === 'UPC' && (
        <Banner kind="note">UPC items use the average cost in HQ, which already works; real-time PO cost matters for PLU and random-weight items.</Banner>
      )}

      <KeyFigures
        caption={`Key figures · ${it.name} · ${range.fyLabel} · ${range.label}`}
        tiles={tiles}
        note={
          <>
            Current PO Cost is the cost in HQ / Retalix; New PO Cost comes from purchase orders.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('po-cost')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartCard
        title="Item Cost Over Time"
        subtitle={`${series.grain === 'day' ? 'Daily' : 'Weekly (range over 26 weeks)'} · PO cost per ${unit} incl. freight, dashed line = Current PO Cost (HQ) · ${qtyLabel.toLowerCase()} below`}
        height={400}
        legend={[
          { label: 'PO cost / unit', color: C.s1 },
          { label: 'Current PO Cost (HQ)', color: C.axis },
          ...(showRetail ? [{ label: 'Retail', color: C.s3 }] : []),
          { label: qtyLabel, color: C.s2, kind: 'rect' as const },
        ]}
        table={{
          head: [series.grain === 'day' ? 'Day' : 'Week', 'PO cost / unit', 'Retail', qtyLabel, 'Cases'],
          rows: chartData.map((d) => [d.x, d.cost === null ? '—' : moneyUnit(d.cost), moneyUnit(d.retail), Math.round(d.qty), d.cases]),
        }}
      >
        <CostQtyPanels data={chartData} hq={current} showRetail={showRetail} fmtCost={(v) => moneyUnit(v)} fmtQty={fmtQty} qtyLabel={qtyLabel} />
      </ChartCard>
      <div className="toggle-row">
        <Segmented<'off' | 'on'>
          small
          label="Show retail price"
          value={showRetail ? 'on' : 'off'}
          onChange={(v) => setShowRetail(v === 'on')}
          options={[
            { value: 'off', label: 'Cost only' },
            { value: 'on', label: 'Show retail price' },
          ]}
        />
      </div>

      {recipe.length > 0 && (
        <ChartGrid cols={2}>
          <section className="card side-card" aria-label="Recipe components">
            <div className="side-actions">
              <div>
                <h3 className="side-title">Recipe components</h3>
                <p className="side-sub">
                  Recipe last costed {it.composite!.updatedLabel} · Current = cost in the recipe, New = today’s component PO cost
                </p>
              </div>
              <ExportButton
                fileName={`Recipe ${it.name}`}
                getSheet={() => ({
                  title: `Recipe components · ${it.name}`,
                  subtitle: `Recipe last costed ${it.composite!.updatedLabel}`,
                  head: ['Component', 'Quantity', 'Unit', 'Current PO Cost / unit', 'New PO Cost / unit', 'Change %', 'Contribution $'],
                  rows: recipe.map((r) => [r.name, Math.round(r.qty * 100) / 100, r.unit, moneyUnit(r.currentUnitCost), moneyUnit(r.newUnitCost), pctChange(r.change), moneyUnit(r.contribution)]),
                })}
              />
            </div>
            <table className="mini-table">
              <thead>
                <tr>
                  <th className="left">Component</th>
                  <th>Current PO Cost</th>
                  <th>New PO Cost</th>
                  <th>Change</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {recipe.map((r) => (
                  <tr key={r.key}>
                    <td className="left">
                      {r.name}
                      <span className="cell-sub">
                        {r.qty.toFixed(r.qty < 10 ? 1 : 0)} {r.unit} · {moneyUnit(r.currentUnitCost * r.qty)} at {r.currentUnitCost < 0.1 ? `$${r.currentUnitCost.toFixed(3)}` : moneyUnit(r.currentUnitCost)} / {r.unit}
                      </span>
                    </td>
                    <td>{moneyUnit(r.currentUnitCost * r.qty)}</td>
                    <td>{moneyUnit(r.newUnitCost * r.qty)}</td>
                    <td>
                      <Var value={r.change} kind="pct" invert />
                    </td>
                    <td>{moneyUnit(r.contribution)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td className="left">PLU cost</td>
                  <td>{moneyUnit(current)}</td>
                  <td>{moneyUnit(next)}</td>
                  <td>
                    <Var value={change.pct} kind="pct" invert />
                  </td>
                  <td>{moneyUnit(change.abs)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <ChartCard
            title="Component cost since the recipe was costed"
            subtitle={`Change in each component's unit cost since ${it.composite!.updatedLabel}`}
            height={300}
            legend={recipe.map((r, k) => ({ label: r.name, color: [C.s1, C.s2, C.s3, C.s4, '#e87ba4', '#008300', '#6250d6'][k % 7] }))}
            table={{ head: ['Component', 'Change'], rows: recipe.map((r) => [r.name, pctChange(r.change)]) }}
          >
            <TrendLines
              data={componentSeries(it, range.start, range.end)}
              series={recipe.map((r, k) => ({ key: r.key, label: r.name, color: [C.s1, C.s2, C.s3, C.s4, '#e87ba4', '#008300', '#6250d6'][k % 7] }))}
              format={(v) => pctChange(v)}
              tickFormat={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </ChartCard>
        </ChartGrid>
      )}

      {!it.composite && (
        <section className="card side-card" aria-label="Purchase orders">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Purchase orders · {count(orders.length)} lines</h3>
              <p className="side-sub">
                {range.label} · {sup.vendors.map((v) => v.name).join(', ')} · {sup.caseLabel}
              </p>
            </div>
            <ExportButton
              fileName={`POs ${it.name}`}
              getSheet={() => ({
                title: `Purchase orders · ${it.name} (${it.code})`,
                subtitle: range.label,
                head: ['Date', 'Vendor', 'Cases', 'Case pack', 'Case cost', 'Freight / case', 'Unit cost (landed)'],
                rows: orders.map((o) => [formatDay(o.day), o.vendor, o.cases, `${o.casePack} ${unit}`, moneyUnit(o.caseCost), moneyUnit(o.freight), moneyUnit(o.unitCost)]),
              })}
            />
          </div>
          <div className="po-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th className="left">Date</th>
                  <th className="left">Vendor</th>
                  <th>Cases</th>
                  <th>Case pack</th>
                  <th>Case cost</th>
                  <th>Freight</th>
                  <th>Unit cost</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 400).map((o, n) => (
                  <tr key={n} className={o.unitCost > current * 1.5 ? 'is-hot' : undefined}>
                    <td className="left">{formatDay(o.day)}</td>
                    <td className="left">{o.vendor}</td>
                    <td>{count(o.cases)}</td>
                    <td>
                      {o.casePack} {unit}
                    </td>
                    <td>{moneyUnit(o.caseCost)}</td>
                    <td>{moneyUnit(o.freight)}</td>
                    <td>{moneyUnit(o.unitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** Component cost change since the recipe was costed, sampled every 2 weeks over the range. */
function componentSeries(it: Item, d0: number, d1: number): Record<string, number | string | null>[] {
  const c = it.composite!;
  const lines = recipeLines(it);
  const out: Record<string, number | string | null>[] = [];
  const w0 = Math.min(c.updatedWeek, weekOfDay(d0));
  const w1 = Math.min(weekOfDay(d1), LAST_COMPLETE_WEEK);
  const fy = fiscalOfWeek(w1).fy;
  for (let w = w0; w <= w1; w += 2) {
    const row: Record<string, number | string | null> = { x: weekTick(w, fy) };
    for (const l of lines) row[l.key] = recipeLines(it, w).find((r) => r.key === l.key)!.change;
    out.push(row);
  }
  return out;
}
