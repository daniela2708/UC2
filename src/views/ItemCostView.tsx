import { Calculator } from 'lucide-react';
import { useSimulator } from '../components/Simulator';
import { belowTarget, catBand } from '../data/targets';
import { useMemo, useState } from 'react';
import { fiscalOfWeek, formatDay, LAST_COMPLETE_WEEK, weekOfDay } from '../data/calendar';
import { getModel, NW } from '../data/generate';
import { COST_TYPE_LABEL, DEPTS, ITEMS, type Item } from '../data/products';
import { costSeries, currentPoCost, hqUnitCostWeek, newPoCostInfo, ordersOf, poUnitCostWeek, supplyOf } from '../data/purchasing';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { C, ChartCard, CostQtyPanels, type CostQtyPoint } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { InfoTip, Segmented, StatusChip, Var } from '../components/ui';
import { ItemPicker } from '../components/ItemPicker';
import { pickerItems, resolveIcItem } from '../lib/itemCost';
import { count, moneyCompact, moneyUnit, pct, volume, weekTick } from '../lib/format';
import { costChange, periodPoCost, pointsDiff, safeDiv } from '../lib/kpis';
import { useFilters } from '../lib/filterStore';
import { DEFAULT_STATE } from '../lib/filters';
import { buildScope, dsdReceipts } from '../lib/selectors';
import { useScope, type ViewProps } from './common';

const COST_METHOD_TIP =
  'Real-time cost comes from purchase orders in the ordering system (Biceps) and may change after invoice reconciliation.';

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
  const { state, update } = useFilters();
  const period = state.costPeriod;
  const w0 = weekOfDay(range.start);
  const endWeek = Math.min(weekOfDay(range.end), LAST_COMPLETE_WEEK);
  const series = useMemo(() => {
    // DSD items: receipts recorded in Retalix HQ for the whole chain.
    const rec = it.dsd ? dsdReceipts(buildScope(DEFAULT_STATE, range), w0, endWeek).get(i) : undefined;
    return costSeries(i, w0, endWeek, period, rec ? (w) => rec[w] : undefined);
  }, [i, it.dsd, range, w0, endWeek, period]);
  const current = currentPoCost(i);
  const nextInfo = newPoCostInfo(i, endWeek);
  const next = nextInfo.cost;
  const change = costChange(current, next);
  const retail = retailAt(i, endWeek);
  const gmCurrent = retail && retail > 0 ? 1 - current / retail : null;
  const gmNew = retail && retail > 0 && next !== null ? 1 - next / retail : null;
  const band = catBand(it.cat);
  const simulate = useSimulator();
  const fy = fiscalOfWeek(endWeek).fy;
  const produced = !!it.composite;

  const chartData: CostQtyPoint[] = series.map((p) => {
    const f = fiscalOfWeek(p.week);
    return {
      x: period === 'week' ? weekTick(p.week, fy) : `P${f.period}${f.fy !== fy ? ` FY${String(f.fy).slice(2)}` : ''}`,
      cost: p.cost,
      hq: p.hq,
      retail: m.retail[i * NW + p.week],
      qty: p.units,
    };
  });
  const gaps = series.filter((p) => p.cost === null).length;

  // Est. margin impact over the range: (PO cost − HQ cost) × units sold, week by week (weeks without purchases carry the last PO cost).
  const { impact, spend, qty } = useMemo(() => {
    let impact = 0;
    for (let w = w0; w <= endWeek; w++) impact += (poUnitCostWeek(i, w) - hqUnitCostWeek(i, w)) * m.units[i * NW + w];
    let spend = 0;
    let qty = 0;
    for (const p of series) {
      spend += p.spend;
      qty += p.units;
    }
    return { impact, spend, qty };
  }, [i, w0, endWeek, m, series]);

  const orders = useMemo(() => ordersOf(i).filter((o) => o.day >= range.start && o.day <= range.end).reverse(), [i, range.start, range.end]);
  const asOf = nextInfo.week !== endWeek ? ` · as of W${fiscalOfWeek(nextInfo.week).week}` : '';

  const tiles: Tile[] = [
    { label: 'Current PO Cost', info: 'The per-unit cost held today in Retalix HQ (Weis’s back-office system), which Power BI uses.', value: moneyUnit(current), sub: `HQ · updated ${sup.hqUpdatedLabel}${it.costType === 'UPC' ? ' · average cost' : ''}` },
    {
      label: 'New PO Cost',
      info: produced
        ? 'Recipe cost at the last complete week’s ingredient costs.'
        : 'Period-based PO cost of the last complete week: PO spend ÷ volume purchased, freight included (Proposed). When nothing was bought that week, the latest earlier week.',
      value: moneyUnit(next),
      sub: produced
        ? `Recipe at W${fiscalOfWeek(endWeek).week} ingredient costs`
        : it.dsd
          ? `W${fiscalOfWeek(nextInfo.week).week} DSD receipt cost (Retalix HQ)`
          : `W${fiscalOfWeek(nextInfo.week).week} POs, incl. freight${asOf}`,
    },
    { label: 'Cost change', info: 'New PO Cost − Current PO Cost, in $ and %.', value: <Var value={change.pct} kind="pct" invert />, sub: change.abs === null ? '—' : `${change.abs >= 0 ? '+' : '−'}${moneyUnit(Math.abs(change.abs))} per ${unit}` },
    {
      label: produced ? 'Units produced' : it.dsd ? 'Volume received' : 'Volume purchased',
      info: produced ? 'Composite PLUs are made in store: units produced = units sold + known loss units.' : 'Volume received on purchase orders in the range (Biceps).',
      value: volume(qty, unit),
      sub: produced ? 'Sold + known loss' : it.dsd ? `${moneyCompact(spend)} DSD receipts (Retalix HQ)` : `${moneyCompact(spend)} PO spend · ${sup.caseLabel}`,
    },
    {
      label: 'Purchase Cost per Unit',
      info: 'SUM(Total Purchases) ÷ SUM(volume purchased) over the range. Composite PLUs: production cost (recipe) ÷ units produced.',
      value: moneyUnit(periodPoCost(spend, qty)),
      sub: `${range.label}`,
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
    { label: 'Est. margin impact', info: 'Σ (PO cost − HQ cost) × units sold, week by week over the range. Positive = margin overstated by the HQ cost.', value: moneyCompact(impact), sub: impact > 0 ? 'Margin overstated in reports' : 'Margin understated in reports' },
  ];

  const qtyLabel = produced ? 'Units produced' : it.dsd ? 'Volume received (DSD)' : 'Volume purchased';
  const costLabel = produced ? 'Recipe cost / unit' : 'PO Cost / Unit';
  const fmtQty = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : String(Math.round(v)));
  const bucket = period === 'week' ? 'Week' : 'Fiscal period';

  return (
    <>
      <SectionHeading eyebrow="Item cost" title="Item Cost Over Time" question="What does this item really cost us, and since when?">
        {it.name} ({it.code}), {range.label}: Current PO Cost <b>{moneyUnit(current)}</b> / {unit} in Retalix HQ vs New PO Cost <b>{moneyUnit(next)}</b> (
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
        </span>
        <span className="toggle-group">
          <span className="toggle-label">Cost period</span>
          <Segmented<'week' | 'period'>
            small
            label="Cost period"
            value={period}
            onChange={(v) => update((st) => ({ ...st, costPeriod: v }))}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'period', label: 'Fiscal period' },
            ]}
          />
          <StatusChip status="Proposed" />
          <InfoTip text={`${COST_METHOD_TIP} PO Cost / Unit for a period = total PO spend in the period ÷ volume purchased in the period (BCG proposal). Periods without purchases are gaps.`} />
        </span>
        <span className="filter-spacer" />
        <button type="button" className="btn-outline" onClick={() => simulate(i)}>
          <Calculator size={14} aria-hidden="true" />
          Simulate cost change
        </button>
      </div>

      {it.dsd ? (
        <Banner kind="note">
          DSD item: received through direct store delivery and recorded item by item in Retalix HQ. Total Purchases and PO Cost / Unit come from HQ receipts; there are no
          Biceps purchase orders.
        </Banner>
      ) : (
        it.costType === 'UPC' && (
          <Banner kind="note">
            UPC items use the average cost in Retalix HQ, which already works; real-time PO cost matters for PLU and random-weight items. Purchases are warehouse bill-out
            (shipments to stores).
          </Banner>
        )
      )}

      <KeyFigures
        caption={`Key figures · ${it.name} · ${range.fyLabel} · ${range.label}`}
        tiles={tiles}
        note={
          <>
            Current PO Cost is the cost in Retalix HQ; New PO Cost comes from purchase orders.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('po-cost')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartCard
        title="Item Cost Over Time"
        subtitle={`By ${bucket.toLowerCase()} · ${costLabel} ${produced ? '' : it.dsd ? '(DSD receipts in Retalix HQ ÷ volume received) ' : '(PO spend ÷ volume purchased, incl. freight) '}· dashed line = Current PO Cost (HQ)${gaps ? ` · ${gaps} ${period === 'week' ? 'week' : 'period'}${gaps > 1 ? 's' : ''} without purchases shown as gaps` : ''} · ${qtyLabel.toLowerCase()} below`}
        height={400}
        legend={[
          { label: costLabel, color: C.s1 },
          { label: 'Current PO Cost (HQ)', color: C.axis },
          ...(showRetail ? [{ label: 'Retail', color: C.s3 }] : []),
          { label: qtyLabel, color: C.qty, kind: 'rect' as const },
        ]}
        table={{
          head: [bucket, costLabel, 'Current PO Cost (HQ)', 'Retail', qtyLabel, produced ? 'Production cost' : 'PO spend'],
          rows: chartData.map((d, n) => [d.x, d.cost === null ? '—' : moneyUnit(d.cost), moneyUnit(d.hq), moneyUnit(d.retail), Math.round(d.qty), moneyCompact(series[n].spend)]),
        }}
      >
        <CostQtyPanels data={chartData} showRetail={showRetail} fmtCost={(v) => moneyUnit(v)} fmtQty={fmtQty} qtyLabel={qtyLabel} costLabel={costLabel} />
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

      {it.composite && (
        <section className="card side-card" aria-label="Recipe">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Recipe · {it.composite.components.length} ingredients</h3>
              <p className="side-sub">
                {it.composite.family} · recipe last costed {it.composite.updatedLabel}. Ingredient contributions, totals and where each ingredient is used are in the Ingredients View.
              </p>
            </div>
            <button type="button" className="btn-outline" onClick={() => update((st) => ({ ...st, igItem: i, tab: 'ingredients' }))}>
              Open in Ingredients View
            </button>
          </div>
        </section>
      )}

      {!it.composite && !it.dsd && (
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
