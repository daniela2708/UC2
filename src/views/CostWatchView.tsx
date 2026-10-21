import { useMemo, useState } from 'react';
import { fiscalOfWeek, LAST_COMPLETE_WEEK } from '../data/calendar';
import { COMPONENTS, COST_TYPE_LABEL, DEPTS, ingredientUnitCost, ITEMS } from '../data/products';
import { recipeLines } from '../data/purchasing';
import { belowTarget, catBand } from '../data/targets';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { C, ChartCard, ChartGrid, hbarHeight, HBars, rankSlice, SERIES, TrendLines, type RankOrder } from '../components/Charts';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { SimulateButton } from '../components/Simulator';
import { CellBar, Impact, InfoTip, Segmented, StatusChip, Var } from '../components/ui';
import { describeProductScope } from '../lib/filters';
import { count, money, moneyCompact, moneyUnit, pct, pctChange, weekTick } from '../lib/format';
import { pointsDiff } from '../lib/kpis';
import { costWatchRows, pluRows } from '../lib/selectors';
import { useScope, ViewToggles, type ViewProps } from './common';

const COMPOSITE_DEPTS = DEPTS.filter((d) => d.name === 'Deli' || d.name === 'Bakery').map((d) => d.idx);
const FAMILY_ORDER = ['Pizza & stromboli', 'Platters', 'Meals', 'Chicken', 'Sandwiches & subs', 'Bakery cakes'];

const PO_COLUMNS: HierCol[] = [
  { key: 'type', label: 'Cost type', left: true, group: 'Cost' },
  { key: 'hq', label: 'Current PO Cost (HQ)', title: 'Cost held in HQ / Retalix, without freight', group: 'Cost' },
  { key: 'updated', label: 'HQ cost updated', group: 'Cost' },
  { key: 'next', label: 'New PO Cost (last week)', title: 'Period-based PO cost of the last complete week: PO spend ÷ volume purchased, freight included (Proposed). "as of W41" when nothing was bought that week.', group: 'Cost' },
  { key: 'gap', label: 'Cost gap %', group: 'Cost' },
  {
    key: 'freight',
    label: 'of which freight',
    title: 'Freight per unit inside the New PO Cost. The HQ cost excludes freight, so this part of the gap is expected; the rest is a real cost change.',
    group: 'Cost',
  },
  { key: 'vendors', label: 'Vendors', group: 'Cost' },
  { key: 'units', label: 'Units sold (4 wk)', group: 'Sales' },
  { key: 'gmHq', label: 'GM Rate on HQ cost', group: 'Margin' },
  { key: 'gmPo', label: 'GM Rate on PO cost', title: 'Shaded band = margin target (Proposed)', group: 'Margin' },
  { key: 'over', label: 'Overstatement', title: 'GM Rate on HQ cost − GM Rate on PO cost, in points', group: 'Margin' },
  { key: 'cost', label: 'Cost change $ (4 wk)', title: '(New PO Cost − HQ cost) × units sold in the last 4 weeks. Red = costs more.', group: 'Cost' },
  { key: 'impact', label: 'Margin impact $ (4 wk)', title: '−Cost change: a cost increase is a margin loss (red); a decrease is a gain (green).', group: 'Margin' },
];

const RECIPE_COLUMNS: HierCol[] = [
  { key: 'components', label: 'Ingredients', group: 'Cost' },
  { key: 'cost', label: 'Current PO Cost (recipe in HQ)', title: 'Recipe cost held in HQ: the recipe at ingredient costs when it was last costed', group: 'Cost' },
  { key: 'updated', label: 'Cost last updated', group: 'Cost' },
  { key: 'age', label: 'Age (months)', group: 'Cost' },
  { key: 'est', label: 'New PO Cost (today’s ingredients)', title: 'The same recipe at the last complete week’s ingredient costs', group: 'Cost' },
  { key: 'gmCur', label: 'GM Rate · current', group: 'Margin' },
  { key: 'gmNew', label: 'GM Rate · new', title: 'Shaded band = margin target (Proposed)', group: 'Margin' },
  { key: 'over', label: 'Overstatement', group: 'Margin' },
  { key: 'chg', label: 'Cost change $ (FY2026 YTD)', title: '(New − current recipe cost) × units sold, FY2026 to date. Red = costs more.', group: 'Cost' },
  { key: 'impact', label: 'Margin impact $ (FY2026 YTD)', title: '−Cost change: a cost increase is a margin loss (red).', group: 'Margin' },
];

function qtyText(qty: number, unit: string): string {
  return `${Number.isInteger(qty) ? qty : qty.toFixed(qty < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '')} ${unit}`;
}

export function CostWatchView({ openDefinitions }: ViewProps) {
  const { state, update, scope } = useScope();
  const [mode, setMode] = useState<'po' | 'recipe'>('po');
  const [impactOrder, setImpactOrder] = useState<RankOrder>('top');
  const [deptOrder, setDeptOrder] = useState<RankOrder>('top');
  const poRows = useMemo(() => costWatchRows(scope), [scope]);
  const recipeScope = useScope({ onlyDepts: COMPOSITE_DEPTS }).scope;
  const recipes = useMemo(() => pluRows(recipeScope), [recipeScope]);
  const open = (i: number) => update((s) => ({ ...s, icItem: i, tab: 'itemcost' }));
  const openIngredients = (i: number) => update((s) => ({ ...s, igItem: i, tab: 'ingredients' }));

  const poTable: HierRow[] = poRows.map((r) => {
    const it = ITEMS[r.item];
    const over = pointsDiff(r.gmHq, r.gmPo);
    const band = catBand(it.cat);
    return {
      id: `p${r.item}`,
      label: (
        <>
          <span className="code-tag">{it.code}</span>
          {it.name} {belowTarget(r.gmPo, band) && <span className="chip neutral">Below target</span>}
        </>
      ),
      sub: `${DEPTS[it.dept].name} · retail ${moneyUnit(r.retail)} / ${it.uom}`,
      extra: <SimulateButton item={r.item} />,
      drill: { label: `Open ${it.name} in Item Cost Over Time`, onClick: () => open(r.item) },
      onSelect: () => open(r.item),
      className: r.hqAgeMonths > 6 ? 'is-stale' : undefined,
      cells: {
        type: <span className={`chip ${it.costType === 'RW' ? 'rw' : 'neutral'}`}>{COST_TYPE_LABEL[it.costType]}</span>,
        hq: moneyUnit(r.hq),
        updated: (
          <>
            {r.hqUpdated}
            <span className="cell-sub">{r.hqAgeMonths} months</span>
          </>
        ),
        next:
          r.nextWeek !== LAST_COMPLETE_WEEK ? (
            <>
              {moneyUnit(r.next)}
              <span className="cell-sub">as of W{fiscalOfWeek(r.nextWeek).week}</span>
            </>
          ) : (
            moneyUnit(r.next)
          ),
        gap: <Var value={r.gap} kind="pct" invert />,
        freight: (
          <>
            {moneyUnit(r.freight)}
            <span className="cell-sub">
              {r.next !== null && r.freight !== null && r.next > r.hq
                ? `${pct(Math.min(1, r.freight / (r.next - r.hq)), 0)} of the gap`
                : r.costFell
                  ? 'Cost fell since HQ update'
                  : 'PO cheaper than HQ'}
            </span>
          </>
        ),
        vendors: (
          <span title={r.vendors.join(', ')}>
            {r.vendors.length}
            <span className="cell-sub">{r.vendors[0]}</span>
          </span>
        ),
        units: `${Math.round(r.units4w).toLocaleString('en-US')} ${it.uom}`,
        gmHq: pct(r.gmHq),
        gmPo: <CellBar value={r.gmPo} max={0.75} text={pct(r.gmPo)} band={band} />,
        over: <Var value={over === null ? null : -over} />,
        cost: <Impact value={r.costChange} kind="cost" />,
        impact: <Impact value={r.marginImpact} kind="margin" />,
      },
      sort: { label: it.name, type: it.costType, hq: r.hq, updated: -r.hqAgeMonths, next: r.next, gap: r.gap, freight: r.freight, vendors: r.vendors.length, units: r.units4w, gmHq: r.gmHq, gmPo: r.gmPo, over, cost: r.costChange, impact: r.marginImpact },
    };
  });

  const families = FAMILY_ORDER.map((fam) => ({ fam, rows: recipes.filter((r) => r.family === fam) })).filter((f) => f.rows.length);
  const recipeTable: HierRow[] = families.map(({ fam, rows }) => {
    const chg = rows.reduce((a, r) => a + r.costChange, 0);
    const impact = rows.reduce((a, r) => a + r.marginImpact, 0);
    return {
      id: `f${fam}`,
      label: fam,
      sub: `${rows.length} PLUs`,
      cells: { components: '', cost: '', updated: '', age: '', est: '', gmCur: '', gmNew: '', over: '', chg: <Impact value={chg} kind="cost" />, impact: <Impact value={impact} kind="margin" /> },
      sort: { label: fam, chg, impact },
      children: rows.map((r) => {
        const it = ITEMS[r.item];
        const comp = it.composite!;
        const stale = r.ageMonths > 6;
        const over = pointsDiff(r.displayedMargin, r.estMargin);
        const band = catBand(it.cat);
        return {
          id: `p${r.item}`,
          label: (
            <>
              <span className="code-tag">{it.code}</span>
              {it.name} {stale && <span className="chip amber">Older than 6 months</span>} {belowTarget(r.estMargin, band) && <span className="chip neutral">Below target</span>}
            </>
          ),
          sub: comp.sliceOf ? `Slice · ${comp.sliceOf.item} ÷ ${comp.sliceOf.slices}` : `${DEPTS[it.dept].name} · retail ${moneyUnit(it.basePrice)}`,
          className: stale ? 'is-stale' : undefined,
          extra: <SimulateButton item={r.item} />,
          drill: { label: `Open ${it.name} in the Ingredients View`, onClick: () => openIngredients(r.item) },
          cells: {
            components: count(r.components),
            cost: moneyUnit(r.currentCost),
            updated: <span className={stale ? 'amber' : undefined}>{r.updatedLabel}</span>,
            age: count(r.ageMonths),
            est: moneyUnit(r.estCost),
            gmCur: pct(r.displayedMargin),
            gmNew: <CellBar value={r.estMargin} max={0.75} text={pct(r.estMargin)} band={band} />,
            over: <Var value={over === null ? null : -over} />,
            chg: <Impact value={r.costChange} kind="cost" />,
            impact: <Impact value={r.marginImpact} kind="margin" />,
          },
          sort: { label: it.name, components: r.components, cost: r.currentCost, updated: comp.updatedWeek, age: r.ageMonths, est: r.estCost, gmCur: r.displayedMargin, gmNew: r.estMargin, over, chg: r.costChange, impact: r.marginImpact },
          children: recipeLines(it, LAST_COMPLETE_WEEK).map((l) => ({
            id: `p${r.item}-${l.key}`,
            label: <span className={l.discontinued ? 'is-discontinued' : undefined}>{l.name}</span>,
            sub: `${qtyText(l.qty, l.unit)} per unit${l.discontinued ? ' · discontinued' : ''}`,
            className: l.discontinued ? 'row-muted' : undefined,
            cells: {
              components: '',
              cost: moneyUnit(l.qty * l.currentUnitCost),
              updated: '',
              age: '',
              est: (
                <>
                  {moneyUnit(l.qty * l.newUnitCost)}
                  <span className="cell-sub">{pctChange(l.change)}</span>
                </>
              ),
              gmCur: '',
              gmNew: '',
              over: '',
              chg: '',
              impact: '',
            },
            sort: { cost: l.qty * l.currentUnitCost, est: l.qty * l.newUnitCost },
          })),
        };
      }),
    };
  });

  // Key figures for the active mode.
  const up = poRows.filter((r) => r.costChange > 0);
  const costUp = up.reduce((a, r) => a + r.costChange, 0);
  const marginPo = poRows.reduce((a, r) => a + r.marginImpact, 0);
  const gaps10 = poRows.filter((r) => (r.gap ?? 0) > 0.1).length;
  const belowPo = poRows.filter((r) => belowTarget(r.gmPo, catBand(ITEMS[r.item].cat))).length;
  const ages = poRows.map((r) => r.hqAgeMonths).sort((a, b) => a - b);
  const medianAge = ages.length ? ages[Math.floor(ages.length / 2)] : null;
  const top = poRows[0];
  const staleRecipes = recipes.filter((r) => r.ageMonths > 6).length;
  const recipeChange = recipes.reduce((a, r) => a + r.costChange, 0);
  const recipeImpact = recipes.reduce((a, r) => a + r.marginImpact, 0);
  const belowRecipes = recipes.filter((r) => belowTarget(r.estMargin, catBand(ITEMS[r.item].cat))).length;
  const topRecipe = recipes[0];

  const tiles: Tile[] =
    mode === 'po'
      ? [
          { label: 'Items reviewed', info: 'PLU and random-weight items with sales in the last 4 weeks.', value: count(poRows.length), sub: describeProductScope(state) },
          { label: 'Cost gap above 10 %', info: 'Items whose New PO Cost is more than 10 % above the cost in HQ.', value: count(gaps10), sub: poRows.length ? `${pct(gaps10 / poRows.length)} of items` : '—' },
          { label: 'Median HQ cost age', info: 'Months since the HQ default cost was last updated.', value: medianAge === null ? '—' : `${medianAge} mo`, sub: 'HQ / Retalix default cost' },
          { label: 'Cost change (4 weeks)', info: 'Σ (New PO Cost − HQ cost) × units sold in the last 4 weeks, items where PO cost is higher.', value: <Impact value={costUp} kind="cost" compact />, sub: `${count(up.length)} items cost more on POs` },
          { label: 'Margin impact (4 weeks)', info: 'Σ −cost change over every item: what the HQ cost hides from reported margin. Negative = margin overstated.', value: <Impact value={marginPo} kind="margin" compact />, sub: 'Margin overstated in reports' },
          { label: 'Below target band', info: 'Items whose Gross Margin Rate on PO cost is below their department’s target band (Proposed).', value: count(belowPo), sub: <StatusChip status="Proposed" /> },
        ]
      : [
          { label: 'Composite PLUs', info: 'Deli and Bakery items costed from a recipe in Excel.', value: count(recipes.length), sub: `${families.length} families` },
          { label: 'Older than 6 months', info: 'Recipe cost not updated in the last 6 months.', value: count(staleRecipes), sub: recipes.length ? `${pct(staleRecipes / recipes.length)} of PLUs` : '—' },
          { label: 'Cost change (YTD)', info: 'Σ (recipe at today’s ingredient costs − recipe cost in HQ) × units sold, FY2026 to date.', value: <Impact value={recipeChange} kind="cost" compact />, sub: 'Recipes cost more today' },
          { label: 'Margin impact (YTD)', info: '−Cost change: margin overstated in reports because HQ holds old recipe costs.', value: <Impact value={recipeImpact} kind="margin" compact />, sub: 'Margin overstated in reports' },
          {
            label: 'Largest gap',
            info: 'GM Rate at the HQ recipe cost minus GM Rate at today’s ingredient costs, for the PLU with the largest margin impact.',
            value: topRecipe ? <Var value={-(pointsDiff(topRecipe.displayedMargin, topRecipe.estMargin) ?? 0)} /> : '—',
            sub: topRecipe ? ITEMS[topRecipe.item].name : '—',
          },
          { label: 'Below target band', info: 'Recipe PLUs whose GM Rate at today’s ingredient costs is below the department target band (Proposed).', value: count(belowRecipes), sub: <StatusChip status="Proposed" /> },
        ];

  const signColor = (v: number) => (v < 0 ? C.neg : C.pos);
  // Ranked by cost change (largest margin loss first); "Bottom first" shows the largest gains.
  const impactBars = rankSlice(poRows, (r) => r.costChange, impactOrder, 25).map((r) => ({
    id: r.item,
    label: ITEMS[r.item].name,
    value: r.marginImpact,
    color: signColor(r.marginImpact),
    tip: [
      { label: 'Margin impact (4 weeks)', value: signed(r.marginImpact) },
      { label: 'Cost change (4 weeks)', value: signed(r.costChange) },
      { label: 'HQ → New PO Cost', value: `${moneyUnit(r.hq)} → ${moneyUnit(r.next)}` },
      { label: 'HQ cost updated', value: r.hqUpdated },
    ],
  }));
  const recipeBars = rankSlice(recipes, (r) => r.costChange, impactOrder, 25).map((r) => ({
    id: r.item,
    label: ITEMS[r.item].name,
    value: r.marginImpact,
    color: signColor(r.marginImpact),
    tip: [
      { label: 'Margin impact (YTD)', value: signed(r.marginImpact) },
      { label: 'Cost change (YTD)', value: signed(r.costChange) },
      { label: 'Cost last updated', value: r.updatedLabel },
    ],
  }));
  const topComp = topRecipe ? ITEMS[topRecipe.item].composite! : null;
  const compSeries = topComp ? topComp.components.map((c, k) => ({ key: c.key, label: COMPONENTS[c.key].name, color: SERIES[k % SERIES.length] })) : [];
  const compData = (() => {
    if (!topComp) return [];
    const out: Record<string, number | string | null>[] = [];
    for (let w = topComp.updatedWeek; w <= LAST_COMPLETE_WEEK; w += 2) {
      const row: Record<string, number | string | null> = { x: weekTick(w, 2026) };
      for (const c of topComp.components) row[c.key] = ingredientUnitCost(c.key, w) / ingredientUnitCost(c.key, topComp.updatedWeek) - 1;
      out.push(row);
    }
    return out;
  })();
  const bars = mode === 'po' ? impactBars : recipeBars;

  return (
    <>
      <SectionHeading eyebrow="Cost accuracy" title="Cost Watch" question="Where is the cost in HQ out of date, and what does it do to margin?">
        {mode === 'po' ? (
          <>
            {describeProductScope(state)}: <b>{count(gaps10)}</b> of <b>{count(poRows.length)}</b> PLU and random-weight items cost more than 10 % above the cost in HQ; margin
            impact <Impact value={marginPo} kind="margin" compact /> over the last 4 weeks
            {top && top.marginImpact < 0 && (
              <>
                , led by <b>{ITEMS[top.item].name}</b> ({moneyUnit(top.hq)} in HQ vs {moneyUnit(top.next)} on POs)
              </>
            )}
            .
          </>
        ) : (
          <>
            <b>{count(staleRecipes)}</b> of <b>{count(recipes.length)}</b> recipe PLUs have costs older than 6 months; margin impact{' '}
            <Impact value={recipeImpact} kind="margin" compact /> FY2026 to date
            {topRecipe && (
              <>
                , led by <b>{ITEMS[topRecipe.item].name}</b> (last costed {topRecipe.updatedLabel})
              </>
            )}
            .
          </>
        )}
      </SectionHeading>

      <div className="toggle-row">
        <span className="chip status-proposed">Proposed view</span>
        <Segmented<'po' | 'recipe'>
          label="Cost Watch mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'po', label: 'PO vs HQ cost' },
            { value: 'recipe', label: 'Recipe PLUs' },
          ]}
        />
        <span className="toggle-label">New PO Cost method</span>
        <StatusChip status="Proposed" />
        <InfoTip text="New PO Cost = PO spend ÷ volume purchased in the last complete week (FY2026 W42), freight included; when nothing was bought that week, the latest earlier week, marked 'as of'. Composite PLUs: the recipe at that week's ingredient costs. Real-time cost comes from Biceps and may change after invoice reconciliation." />
      </div>

      {mode === 'recipe' && (
        <Banner lead="Read-only:" details={{ label: 'Details', onClick: () => openDefinitions('po-cost') }}>
          editing recipe costs is a separate initiative pending a scope decision. Discontinued ingredients show in grey; open a PLU in the Ingredients View to see where each ingredient is used.
        </Banner>
      )}

      <ViewToggles />

      <KeyFigures caption={`Key figures · ${describeProductScope(state)} · as of 10/18/2026`} tiles={tiles} />

      <ChartGrid cols={2}>
        <ChartCard
          title="Margin impact ranking"
          subtitle={`${impactOrder === 'top' ? 'Top 25 · largest margin loss first' : 'Bottom 25 · largest margin gain first'} · ${
            mode === 'po' ? 'last 4 weeks · margin impact = −(New PO Cost − HQ cost) × units' : 'FY2026 to date · margin impact = −(today’s recipe − HQ recipe) × units'
          }`}
          rank={{ order: impactOrder, onChange: setImpactOrder }}
          legend={[
            { label: 'Margin loss (costs more than HQ)', color: C.neg, kind: 'rect' },
            { label: 'Margin gain (costs less than HQ)', color: C.pos, kind: 'rect' },
          ]}
          height={340}
          contentHeight={hbarHeight(bars.length)}
          table={{ head: ['Item', 'Margin impact $', 'Cost change $'], rows: bars.map((b) => [b.label, signed(b.value), signed(-b.value)]) }}
        >
          <HBars data={bars} diverging labelWidth={200} format={(v) => signed(v, true)} onSelect={(d) => (mode === 'po' ? open(Number(d.id)) : openIngredients(Number(d.id)))} />
        </ChartCard>
        {mode === 'po' ? (
          <ChartCard
            title="Cost gap by department"
            subtitle="Units-weighted New PO Cost vs HQ cost, last 4 weeks"
            height={340}
            legend={[
              { label: 'PO cost above HQ (margin loss)', color: C.neg, kind: 'rect' },
              { label: 'PO cost below HQ', color: C.pos, kind: 'rect' },
            ]}
            rank={{ order: deptOrder, onChange: setDeptOrder }}
            table={{ head: ['Department', 'Cost gap'], rows: rankSlice(deptGaps(poRows), (d) => d.value, deptOrder).map((d) => [d.label, pctChange(d.value / 100)]) }}
          >
            <HBars data={rankSlice(deptGaps(poRows), (d) => d.value, deptOrder)} diverging labelWidth={80} format={(v) => `${v.toFixed(1)}%`} />
          </ChartCard>
        ) : (
          topComp &&
          topRecipe && (
            <ChartCard
              title={`Ingredient costs since the recipe was costed · ${ITEMS[topRecipe.item].name}`}
              subtitle={`Change in each ingredient's cost since ${topRecipe.updatedLabel}; the recipe cost in HQ has not moved`}
              height={340}
              legend={compSeries.map((c) => ({ label: c.label, color: c.color }))}
              table={{ head: ['Ingredient', 'Change since update'], rows: topComp.components.map((c) => [COMPONENTS[c.key].name, pctChange(ingredientUnitCost(c.key, LAST_COMPLETE_WEEK) / ingredientUnitCost(c.key, topComp.updatedWeek) - 1)]) }}
            >
              <TrendLines data={compData} series={compSeries} format={(v) => pctChange(v)} tickFormat={(v) => `${(v * 100).toFixed(0)}%`} />
            </ChartCard>
          )
        )}
      </ChartGrid>

      <section className="card table-card" aria-label="Cost Watch table">
        <p className="card-caption">
          {mode === 'po' ? 'PLU and random-weight items · largest margin loss first · click a row to open it' : 'Recipe family › PLU › Ingredient · largest margin loss first'}
        </p>
        {mode === 'po' ? (
          <HierTable
            key="po"
            tableId="costpo"
            presets={[{ label: 'Gap explained', keys: ['hq', 'next', 'gap', 'freight', 'cost', 'impact'] }]}
            hierarchy="SKU / PLU"
            columns={PO_COLUMNS} defaultSort={{ key: 'impact', dir: 'asc' }} rows={poTable} exportTitle="Cost Watch PO vs HQ" empty="No PLU or random-weight items for the current filters." />
        ) : (
          <HierTable
            key="recipe"
            tableId="costrecipe"
            hierarchy="Family › PLU › Ingredient"
            columns={RECIPE_COLUMNS}
            defaultSort={{ key: 'impact', dir: 'asc' }}
            defaultExpanded={families.slice(0, 1).map((f) => `f${f.fam}`)}
            rows={recipeTable}
            exportTitle="Cost Watch recipe PLUs"
            empty="Composite PLUs exist only in Deli and Bakery."
          />
        )}
      </section>
    </>
  );
}

/** Signed dollars: "+$1,234" or "−$1,234". */
function signed(v: number, compact = false): string {
  if (Math.abs(v) < 0.005) return '$0';
  return `${v > 0 ? '+' : '−'}${compact ? moneyCompact(Math.abs(v)) : money(Math.abs(v))}`;
}

function deptGaps(rows: ReturnType<typeof costWatchRows>) {
  const acc = new Map<number, { num: number; den: number }>();
  for (const r of rows) {
    if (r.next === null) continue;
    const d = ITEMS[r.item].dept;
    const a = acc.get(d) ?? { num: 0, den: 0 };
    a.num += r.next * r.units4w;
    a.den += r.hq * r.units4w;
    acc.set(d, a);
  }
  return [...acc.entries()]
    .map(([d, a]) => ({ id: d, label: DEPTS[d].name, value: (a.num / a.den - 1) * 100, color: a.num >= a.den ? C.neg : C.pos }));
}
