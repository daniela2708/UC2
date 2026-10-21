import { useEffect, useMemo, useState } from 'react';
import { fiscalOfWeek, LAST_COMPLETE_WEEK, weekOfDay } from '../data/calendar';
import { COMPONENTS, DEPTS, ingredientUnitCost, ITEMS, type Item } from '../data/products';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { ChartCard, SERIES, StackedBars } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { ItemPicker } from '../components/ItemPicker';
import { Select } from '../components/Select';
import { CellBar, Field, Impact, InfoTip, StatusChip, Var } from '../components/ui';
import { useFilters } from '../lib/filterStore';
import { belowTarget, catBand } from '../data/targets';
import { count, moneyCompact, moneyUnit, pct, volume, weekTick } from '../lib/format';
import { clampIngredientCost, ingredientPickerItems, ingredientsSummary, ingredientWeeks, pluUsing, resolveIngredientsItem, whereUsed } from '../lib/ingredients';
import { pointsDiff } from '../lib/kpis';
import { useScope, type ViewProps } from './common';

/** Unit cost with enough decimals for cheap ingredients (e.g. $0.055 / oz). */
function unitCost(v: number): string {
  return v < 0.1 ? `$${v.toFixed(3)}` : moneyUnit(v);
}

function qtyText(qty: number, unit: string): string {
  const q = Number.isInteger(qty) ? String(qty) : qty.toFixed(qty < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
  return `${q} ${unit}`;
}

export function IngredientsView({ openDefinitions }: ViewProps) {
  const { state, update, range } = useScope();
  const list = useMemo(() => ingredientPickerItems(state.dept, state.cat), [state.dept, state.cat]);
  const item = resolveIngredientsItem(list, state.igItem);
  if (item < 0) {
    return (
      <>
        <SectionHeading eyebrow="Recipe cost" title="Ingredients View" question="What does each ingredient add to this PLU’s cost?" />
        <section className="card empty" role="status">
          No composite Deli or Bakery PLUs match the current filters. Clear the department or category filter to pick a PLU.
        </section>
      </>
    );
  }
  return <IngredientsBody key={item} item={ITEMS[item]} list={list} onPick={(i) => update((s) => ({ ...s, igItem: i }))} range={range} openDefinitions={openDefinitions} />;
}

function IngredientsBody({
  item: it,
  list,
  onPick,
  range,
  openDefinitions,
}: {
  item: Item;
  list: number[];
  onPick: (i: number) => void;
  range: ReturnType<typeof useScope>['range'];
  openDefinitions: ViewProps['openDefinitions'];
}) {
  const { update } = useFilters();
  const c = it.composite!;
  const w0 = weekOfDay(range.start);
  const w1 = Math.min(weekOfDay(range.end), LAST_COMPLETE_WEEK);
  const fy = fiscalOfWeek(w1).fy;
  const sum = useMemo(() => ingredientsSummary(it, range.start, range.end), [it, range.start, range.end]);
  const weeks = useMemo(() => ingredientWeeks(it, w0, w1), [it, w0, w1]);
  const colorOf = (k: number) => SERIES[k % SERIES.length];
  const band = catBand(it.cat);
  const series = c.components.map((comp, k) => ({ key: comp.key, label: COMPONENTS[comp.key].name, color: colorOf(k) }));
  const chartData = weeks.map((w) => ({ x: weekTick(w.week, fy), ...w.values }));

  // Where used: default to the recipe's most shared ingredient.
  const defaultKey = useMemo(() => [...c.components].sort((a, b) => pluUsing(b.key).length - pluUsing(a.key).length)[0].key, [c]);
  const [ingKey, setIngKey] = useState(defaultKey);
  const [costText, setCostText] = useState('');
  const todayCost = ingredientUnitCost(ingKey, LAST_COMPLETE_WEEK);
  useEffect(() => setCostText(''), [ingKey]);
  const simCost = costText.trim() === '' ? null : clampIngredientCost(costText, todayCost);
  const invalid = costText.trim() !== '' && simCost === null;
  const used = useMemo(() => whereUsed(ingKey, simCost), [ingKey, simCost]);
  const costChange = used.reduce((a, r) => a + r.annualCostChange, 0);
  const marginImpact = used.reduce((a, r) => a + r.marginImpact, 0);
  const ingredientOptions = useMemo(
    () =>
      Object.values(COMPONENTS)
        .map((d) => ({ value: d.key, label: `${d.name} · ${pluUsing(d.key).length} PLUs`, n: pluUsing(d.key).length }))
        .filter((o) => o.n > 0)
        .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    [],
  );

  const tiles: Tile[] = [
    { label: 'Total unit cost', info: 'Recipe cost × units sold, week by week over the range (ingredient costs of each week).', value: moneyCompact(sum.totalCost), sub: range.label },
    { label: 'Total units', info: 'Units sold in the range (chain).', value: volume(sum.units, 'ea'), sub: 'Units sold' },
    { label: 'Cost / unit', info: 'Σ ingredient contributions: units per item × cost per unit.', value: moneyUnit(sum.costPerUnit), sub: `Recipe last costed ${c.updatedLabel}` },
    { label: 'Retail price', info: 'Shelf price at the end of the range, shown as a reference.', value: moneyUnit(sum.retail), sub: 'Reference' },
    { label: 'Gross Profit ($)', info: 'Gross Sales − (recipe cost × units sold). Interpretation Pending validation.', value: moneyCompact(sum.grossProfit), sub: `on ${moneyCompact(sum.grossSales)} Gross Sales` },
    {
      label: 'Gross Profit (%)',
      info: 'Gross Profit ÷ Gross Sales, consistent with Gross Margin Rate. Interpretation Pending validation. Target band is Proposed.',
      value: pct(sum.grossProfitPct),
      sub: (
        <>
          Target {(band.lo * 100).toFixed(0)}–{(band.hi * 100).toFixed(0)} %{belowTarget(sum.grossProfitPct, band) && <> · <span className="chip neutral">Below target</span></>} ·{' '}
          <StatusChip status="Pending validation" />
        </>
      ),
    },
  ];

  const ingName = COMPONENTS[ingKey].name;
  const unit = COMPONENTS[ingKey].unit;

  return (
    <>
      <SectionHeading eyebrow="Recipe cost" title="Ingredients View" question="What does each ingredient add to this PLU’s cost, and what happens when a base ingredient changes?">
        {it.name} ({it.code}), {range.label}: cost <b>{moneyUnit(sum.costPerUnit)}</b> per unit from {c.components.length} ingredients; the largest is{' '}
        <b>{[...sum.rows].sort((a, b) => b.contribution - a.contribution)[0].name}</b> at{' '}
        <b>{pct([...sum.rows].sort((a, b) => b.contribution - a.contribution)[0].share)}</b> of cost. Gross Profit <b>{pct(sum.grossProfitPct)}</b> on Gross Sales.
      </SectionHeading>

      <div className="toggle-row ic-picker-row">
        <ItemPicker list={list} value={it.idx} onChange={onPick} label="PLU Number (required)" />
        <span className="toggle-group">
          <span className="chip neutral">{c.family}</span>
          <span className="toggle-label">{DEPTS[it.dept].name}</span>
          {c.sliceOf && <span className="toggle-label">Slice: {c.sliceOf.item} ÷ {c.sliceOf.slices}</span>}
        </span>
        <span className="filter-spacer" />
        <button type="button" className="btn-outline" onClick={() => update((s) => ({ ...s, icItem: it.idx, tab: 'itemcost' }))}>
          Open in Item Cost Over Time
        </button>
      </div>

      <KeyFigures
        caption={`Totals · ${it.name} · ${range.fyLabel} · ${range.label}`}
        tiles={tiles}
        note={
          <>
            Legacy source: Pizza Ingredients.xlsx. Ingredient costs come from ingredient purchase orders.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('ingredients-gp')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartCard
        title="Ingredient contribution to unit cost"
        subtitle={`By fiscal week · units per item × that week’s ingredient cost · stacks add up to the recipe cost per unit`}
        height={340}
        legend={series.map((sr) => ({ label: sr.label, color: sr.color, kind: 'rect' as const }))}
        table={{
          head: ['Week', ...series.map((sr) => sr.label), 'Total unit cost'],
          rows: weeks.map((w, n) => [chartData[n].x as string, ...series.map((sr) => unitCost(w.values[sr.key])), moneyUnit(series.reduce((a, sr) => a + w.values[sr.key], 0))]),
        }}
      >
        <StackedBars data={chartData} series={series} format={(v) => unitCost(v)} tickFormat={(v) => `$${v.toFixed(2)}`} />
      </ChartCard>

      <section className="card side-card" aria-label="Ingredients">
        <div className="side-actions">
          <div>
            <h3 className="side-title">Ingredients · {it.name}</h3>
            <p className="side-sub">One row per ingredient · cost per unit is the range average, weighted by units sold each week</p>
          </div>
          <ExportButton
            fileName={`Ingredients ${it.name}`}
            getSheet={() => ({
              title: `Ingredients · ${it.name} (${it.code})`,
              subtitle: `${range.label} · recipe last costed ${c.updatedLabel}`,
              head: ['Ingredient', 'Units per item', 'Unit', 'Cost per unit', 'Contribution cost', 'Share of cost'],
              rows: [
                ...sum.rows.map((r) => [r.name, Math.round(r.qty * 1000) / 1000, r.unit, Math.round(r.unitCost * 10000) / 10000, Math.round(r.contribution * 10000) / 10000, pct(r.share)]),
                ['Total', null, null, null, Math.round(sum.costPerUnit * 10000) / 10000, '100.0 %'],
              ],
            })}
          />
        </div>
        <table className="mini-table ing-table">
          <thead>
            <tr>
              <th className="left">Ingredient</th>
              <th>Units per item</th>
              <th>Cost per unit</th>
              <th>Contribution cost</th>
              <th className="left">Share of cost</th>
            </tr>
          </thead>
          <tbody>
            {sum.rows.map((r, k) => (
              <tr key={r.key} className={r.discontinued ? 'muted' : undefined}>
                <td className="left">
                  <span className="swatch" style={{ background: colorOf(k) }} aria-hidden="true" />
                  {r.name}
                  {r.discontinued && <span className="cell-sub">Discontinued, still in the recipe</span>}
                </td>
                <td>{qtyText(r.qty, r.unit)}</td>
                <td>
                  {unitCost(r.unitCost)} / {r.unit}
                </td>
                <td>{moneyUnit(r.contribution)}</td>
                <td className="left">
                  <CellBar value={r.share} max={1} text={pct(r.share)} />
                </td>
              </tr>
            ))}
            <tr className="total">
              <td className="left">Cost / unit</td>
              <td />
              <td />
              <td>{moneyUnit(sum.costPerUnit)}</td>
              <td className="left">100.0 %</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card side-card" aria-label="Where used">
        <div className="side-actions">
          <div>
            <h3 className="side-title">
              Where used · {ingName} · {count(used.length)} PLUs <StatusChip status="Proposed" />
            </h3>
            <p className="side-sub">
              Every recipe that uses the ingredient. Enter a new ingredient cost to see it flow through each recipe. Annual cost change = cost difference × units produced
              (units sold + known loss units) over the last 52 weeks; margin impact is the same amount with the opposite sign.
            </p>
          </div>
          <ExportButton
            fileName={`Where used ${ingName}`}
            getSheet={() => ({
              title: `Where used · ${ingName}`,
              subtitle: `Simulation only · ${ingName} at ${simCost === null ? 'today’s cost' : `${unitCost(simCost)} / ${unit}`} vs ${unitCost(todayCost)} / ${unit}`,
              head: ['PLU', 'PLU Number', 'Quantity used', 'Unit', 'Current cost', 'New cost', 'Gross Profit % before', 'Gross Profit % after', 'Units produced (52 wk)', 'Annual cost change $', 'Margin impact $'],
              rows: used.map((r) => [
                ITEMS[r.item].name,
                ITEMS[r.item].code,
                Math.round(r.qty * 1000) / 1000,
                r.unit,
                Math.round(r.currentCost * 100) / 100,
                Math.round(r.newCost * 100) / 100,
                pct(r.gpBefore),
                pct(r.gpAfter),
                Math.round(r.unitsProduced),
                Math.round(r.annualCostChange),
                Math.round(r.marginImpact),
              ]),
            })}
          />
        </div>
        <div className="toggle-row where-used-controls">
          <Select label="Ingredient" value={ingKey} options={ingredientOptions} onChange={(v) => COMPONENTS[v] && setIngKey(v)} />
          <Field label={`New cost per ${unit} (today ${unitCost(todayCost)})`} htmlFor="ing-cost">
            <input
              id="ing-cost"
              className={`text-input${invalid ? ' is-invalid' : ''}`}
              inputMode="decimal"
              maxLength={10}
              placeholder={todayCost.toFixed(todayCost < 0.1 ? 3 : 2)}
              aria-invalid={invalid}
              value={costText}
              onChange={(e) => setCostText(e.target.value.replace(/[^\d.$]/g, '').slice(0, 10))}
            />
          </Field>
          {costText !== '' && (
            <button type="button" className="btn-link" onClick={() => setCostText('')}>
              Reset
            </button>
          )}
          <InfoTip text={`Above $0 and up to 10× today's cost (${unitCost(todayCost * 10)} / ${unit}). Read-only: nothing is saved.`} />
          <span className="filter-spacer" />
          <span className="toggle-label impact-pair">
            Annual cost change <Impact value={costChange} kind="cost" compact />
            <span aria-hidden="true">·</span>
            Margin impact <Impact value={marginImpact} kind="margin" compact />
          </span>
        </div>
        {invalid && <p className="field-error">Enter a cost above $0 and up to 10× today’s cost.</p>}
        {simCost !== null && <Banner kind="note">Simulation only. Nothing is saved or sent to HQ.</Banner>}
        <div className="po-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th className="left">PLU</th>
                <th>Quantity used</th>
                <th>Current cost</th>
                <th>New cost</th>
                <th>Gross Profit % before</th>
                <th>Gross Profit % after</th>
                <th>Units produced (52 wk)</th>
                <th>Annual cost change</th>
                <th>Margin impact</th>
              </tr>
            </thead>
            <tbody>
              {used.map((r) => {
                const plu = ITEMS[r.item];
                return (
                  <tr key={r.item} className={r.item === it.idx ? 'is-selected' : undefined}>
                    <td className="left">
                      <button type="button" className="btn-link plain" onClick={() => onPick(r.item)} title={`Show ${plu.name} in the Ingredients View`}>
                        <span className="code-tag">{plu.code}</span>
                        {plu.name}
                      </button>
                      <span className="cell-sub">{plu.composite!.family}</span>
                    </td>
                    <td>{qtyText(r.qty, r.unit)}</td>
                    <td>{moneyUnit(r.currentCost)}</td>
                    <td>{moneyUnit(r.newCost)}</td>
                    <td>{pct(r.gpBefore)}</td>
                    <td>
                      {pct(r.gpAfter)} {simCost !== null && <Var value={pointsDiff(r.gpAfter, r.gpBefore)} />}
                      {belowTarget(r.gpAfter, catBand(plu.cat)) && <span className="cell-sub">Below target</span>}
                    </td>
                    <td>{count(r.unitsProduced)}</td>
                    <td>
                      <Impact value={r.annualCostChange} kind="cost" />
                    </td>
                    <td>
                      <Impact value={r.marginImpact} kind="margin" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
