import { useMemo, useState } from 'react';
import { CURRENT_WEEK, fiscalOfWeek, LAST_COMPLETE_WEEK } from '../data/calendar';
import { COMPONENTS, componentIndex, COST_TYPE_LABEL, DEPTS, ITEMS } from '../data/products';
import { catBand } from '../data/targets';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { C, ChartCard, ChartGrid, hbarHeight, HBars, TrendLines } from '../components/Charts';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { SimulateButton } from '../components/Simulator';
import { CellBar, InfoTip, Segmented, StatusChip, Var } from '../components/ui';
import { describeProductScope } from '../lib/filters';
import { count, money, moneyCompact, moneyUnit, pct, pctChange, weekTick } from '../lib/format';
import { pointsDiff } from '../lib/kpis';
import { costWatchRows, pluRows } from '../lib/selectors';
import { useScope, ViewToggles, type ViewProps } from './common';

const COMPOSITE_DEPTS = DEPTS.filter((d) => d.name === 'Deli' || d.name === 'Bakery').map((d) => d.idx);
const FAMILY_ORDER = ['Pizza & stromboli', 'Platters', 'Meals', 'Chicken', 'Sandwiches & subs', 'Bakery cakes'];
const SLOT = [C.s1, C.s2, C.s3, C.s4, '#e87ba4', '#008300', '#6250d6'];

const PO_COLUMNS: HierCol[] = [
  { key: 'type', label: 'Cost type', left: true, group: 'Cost' },
  { key: 'hq', label: 'Current PO Cost (HQ)', title: 'Cost held in HQ / Retalix, without freight', group: 'Cost' },
  { key: 'updated', label: 'HQ cost updated', group: 'Cost' },
  { key: 'next', label: 'New PO Cost (last week)', title: 'Period-based PO cost of the last complete week: PO spend ÷ volume purchased, freight included (Proposed). "as of W41" when nothing was bought that week.', group: 'Cost' },
  { key: 'gap', label: 'Cost gap %', group: 'Cost' },
  { key: 'vendors', label: 'Vendors', group: 'Cost' },
  { key: 'units', label: 'Units sold (4 wk)', group: 'Sales' },
  { key: 'gmHq', label: 'GM Rate on HQ cost', group: 'Margin' },
  { key: 'gmPo', label: 'GM Rate on PO cost', group: 'Margin' },
  { key: 'over', label: 'Overstatement', group: 'Margin' },
  { key: 'impact', label: 'Est. impact $', title: '(New PO Cost − HQ cost) × units sold in the last 4 weeks', group: 'Margin' },
];

const RECIPE_COLUMNS: HierCol[] = [
  { key: 'components', label: 'Components', group: 'Cost' },
  { key: 'cost', label: 'Current PO Cost (recipe)', group: 'Cost' },
  { key: 'updated', label: 'Cost last updated', group: 'Cost' },
  { key: 'age', label: 'Age (months)', group: 'Cost' },
  { key: 'est', label: 'New PO Cost (today’s components)', group: 'Cost' },
  { key: 'gmCur', label: 'GM Rate · current', group: 'Margin' },
  { key: 'gmNew', label: 'GM Rate · new', group: 'Margin' },
  { key: 'over', label: 'Overstatement', group: 'Margin' },
  { key: 'impact', label: 'Est. impact $ (FY2026 YTD)', group: 'Margin' },
];

export function CostWatchView({ openDefinitions }: ViewProps) {
  const { state, update, scope } = useScope();
  const [mode, setMode] = useState<'po' | 'recipe'>('po');
  const poRows = useMemo(() => costWatchRows(scope), [scope]);
  const recipeScope = useScope({ onlyDepts: COMPOSITE_DEPTS }).scope;
  const recipes = useMemo(() => pluRows(recipeScope), [recipeScope]);
  const open = (i: number) => update((s) => ({ ...s, icItem: i, tab: 'itemcost' }));

  const poTable: HierRow[] = poRows.map((r) => {
    const it = ITEMS[r.item];
    const over = pointsDiff(r.gmHq, r.gmPo);
    const band = catBand(it.cat);
    return {
      id: `p${r.item}`,
      label: (
        <>
          <span className="code-tag">{it.code}</span>
          {it.name}
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
        impact: money(r.impact),
      },
      sort: { label: it.name, type: it.costType, hq: r.hq, updated: -r.hqAgeMonths, next: r.next, gap: r.gap, vendors: r.vendors.length, units: r.units4w, gmHq: r.gmHq, gmPo: r.gmPo, over, impact: r.impact },
    };
  });

  const families = FAMILY_ORDER.map((fam) => ({ fam, rows: recipes.filter((r) => r.family === fam) })).filter((f) => f.rows.length);
  const recipeTable: HierRow[] = families.map(({ fam, rows }) => {
    const impact = rows.reduce((a, r) => a + r.impact, 0);
    return {
      id: `f${fam}`,
      label: fam,
      sub: `${rows.length} PLUs`,
      cells: { components: '', cost: '', updated: '', age: '', est: '', gmCur: '', gmNew: '', over: '', impact: money(impact) },
      sort: { label: fam, impact },
      children: rows.map((r) => {
        const it = ITEMS[r.item];
        const comp = it.composite!;
        const stale = r.ageMonths > 6;
        const over = pointsDiff(r.displayedMargin, r.estMargin);
        return {
          id: `p${r.item}`,
          label: (
            <>
              <span className="code-tag">{it.code}</span>
              {it.name} {stale && <span className="chip amber">Older than 6 months</span>}
            </>
          ),
          sub: comp.sliceOf ? `Slice · ${comp.sliceOf.item} ÷ ${comp.sliceOf.slices}` : `${DEPTS[it.dept].name} · retail ${moneyUnit(it.basePrice)}`,
          className: stale ? 'is-stale' : undefined,
          extra: <SimulateButton item={r.item} />,
          drill: { label: `Open ${it.name} in Item Cost Over Time`, onClick: () => open(r.item) },
          cells: {
            components: count(r.components),
            cost: moneyUnit(r.currentCost),
            updated: <span className={stale ? 'amber' : undefined}>{r.updatedLabel}</span>,
            age: count(r.ageMonths),
            est: moneyUnit(r.estCost),
            gmCur: pct(r.displayedMargin),
            gmNew: <CellBar value={r.estMargin} max={0.75} text={pct(r.estMargin)} band={catBand(it.cat)} />,
            over: <Var value={over === null ? null : -over} />,
            impact: money(r.impact),
          },
          sort: { label: it.name, components: r.components, cost: r.currentCost, updated: comp.updatedWeek, age: r.ageMonths, est: r.estCost, gmCur: r.displayedMargin, gmNew: r.estMargin, over, impact: r.impact },
          children: comp.components.map((c) => {
            const move = componentIndex(c.key, CURRENT_WEEK) / componentIndex(c.key, comp.updatedWeek) - 1;
            const disc = COMPONENTS[c.key].discontinued;
            return {
              id: `p${r.item}-${c.key}`,
              label: <span className={disc ? 'is-discontinued' : undefined}>{COMPONENTS[c.key].name}</span>,
              sub: `${pct(c.share)} of recipe cost${disc ? ' · discontinued' : ''}`,
              className: disc ? 'row-muted' : undefined,
              cells: {
                components: '',
                cost: moneyUnit(r.currentCost * c.share),
                updated: '',
                age: '',
                est: (
                  <>
                    {moneyUnit(r.currentCost * c.share * (1 + move))}
                    <span className="cell-sub">{pctChange(move)}</span>
                  </>
                ),
                gmCur: '',
                gmNew: '',
                over: '',
                impact: '',
              },
              sort: { cost: r.currentCost * c.share, est: move },
            };
          }),
        };
      }),
    };
  });

  // Key figures for the active mode.
  const impactPo = poRows.reduce((a, r) => a + Math.max(0, r.impact), 0);
  const gaps10 = poRows.filter((r) => (r.gap ?? 0) > 0.1).length;
  const ages = poRows.map((r) => r.hqAgeMonths).sort((a, b) => a - b);
  const medianAge = ages.length ? ages[Math.floor(ages.length / 2)] : null;
  const top = poRows[0];
  const staleRecipes = recipes.filter((r) => r.ageMonths > 6).length;
  const recipeImpact = recipes.reduce((a, r) => a + r.impact, 0);
  const topRecipe = recipes[0];

  const tiles: Tile[] =
    mode === 'po'
      ? [
          { label: 'Items reviewed', info: 'PLU and random-weight items with sales in the last 4 weeks.', value: count(poRows.length), sub: describeProductScope(state) },
          { label: 'Cost gap above 10 %', info: 'Items whose New PO Cost is more than 10 % above the cost in HQ.', value: count(gaps10), sub: poRows.length ? `${pct(gaps10 / poRows.length)} of items` : '—' },
          { label: 'Median HQ cost age', info: 'Months since the HQ default cost was last updated.', value: medianAge === null ? '—' : `${medianAge} mo`, sub: 'HQ / Retalix default cost' },
          { label: 'Est. impact (4 weeks)', info: 'Σ (New PO Cost − HQ cost) × units sold in the last 4 weeks, items where PO cost is higher.', value: moneyCompact(impactPo), sub: 'Margin overstated in reports' },
          { label: 'Largest impact', info: 'Item with the largest estimated impact.', value: top ? moneyCompact(top.impact) : '—', sub: top ? ITEMS[top.item].name : '—' },
        ]
      : [
          { label: 'Composite PLUs', info: 'Deli and Bakery items costed from a recipe in Excel.', value: count(recipes.length), sub: `${families.length} families` },
          { label: 'Older than 6 months', info: 'Recipe cost not updated in the last 6 months.', value: count(staleRecipes), sub: recipes.length ? `${pct(staleRecipes / recipes.length)} of PLUs` : '—' },
          { label: 'Est. impact (YTD)', info: 'Σ (recipe at today’s component costs − recipe cost in HQ) × units sold, FY2026 to date.', value: moneyCompact(recipeImpact), sub: 'Margin overstated in reports' },
          {
            label: 'Largest gap',
            info: 'GM Rate at the HQ recipe cost minus GM Rate at today’s component costs, for the PLU with the largest impact.',
            value: topRecipe ? <Var value={-(pointsDiff(topRecipe.displayedMargin, topRecipe.estMargin) ?? 0)} /> : '—',
            sub: topRecipe ? ITEMS[topRecipe.item].name : '—',
          },
        ];

  const impactBars = poRows.slice(0, 25).map((r) => ({
    id: r.item,
    label: ITEMS[r.item].name,
    value: r.impact,
    color: (r.gap ?? 0) > 0.25 ? C.s2 : C.s1,
    tip: [
      { label: 'Est. impact (4 weeks)', value: money(r.impact) },
      { label: 'HQ → New PO Cost', value: `${moneyUnit(r.hq)} → ${moneyUnit(r.next)}` },
      { label: 'HQ cost updated', value: r.hqUpdated },
    ],
  }));
  const recipeBars = recipes.slice(0, 25).map((r) => ({
    id: r.item,
    label: ITEMS[r.item].name,
    value: r.impact,
    color: r.ageMonths > 6 ? C.s2 : C.s1,
    tip: [
      { label: 'Margin overstated (YTD)', value: money(r.impact) },
      { label: 'Cost last updated', value: r.updatedLabel },
    ],
  }));
  const topComp = topRecipe ? ITEMS[topRecipe.item].composite! : null;
  const compSeries = topComp ? topComp.components.map((c, k) => ({ key: c.key, label: COMPONENTS[c.key].name, color: SLOT[k % SLOT.length] })) : [];
  const compData = (() => {
    if (!topComp) return [];
    const out: Record<string, number | string | null>[] = [];
    for (let w = topComp.updatedWeek; w <= CURRENT_WEEK; w += 2) {
      const row: Record<string, number | string | null> = { x: weekTick(w, 2026) };
      for (const c of topComp.components) row[c.key] = componentIndex(c.key, w) / componentIndex(c.key, topComp.updatedWeek) - 1;
      out.push(row);
    }
    return out;
  })();

  return (
    <>
      <SectionHeading eyebrow="Cost accuracy" title="Cost Watch" question="Where is the cost in HQ out of date, and what does it do to margin?">
        {mode === 'po' ? (
          <>
            {describeProductScope(state)}: <b>{count(gaps10)}</b> of <b>{count(poRows.length)}</b> PLU and random-weight items cost more than 10 % above the cost in HQ;
            estimated margin overstatement <b>{moneyCompact(impactPo)}</b> over the last 4 weeks
            {top && (
              <>
                , led by <b>{ITEMS[top.item].name}</b> ({moneyUnit(top.hq)} in HQ vs {moneyUnit(top.next)} on POs)
              </>
            )}
            .
          </>
        ) : (
          <>
            <b>{count(staleRecipes)}</b> of <b>{count(recipes.length)}</b> recipe PLUs have costs older than 6 months; estimated overstatement{' '}
            <b>{moneyCompact(recipeImpact)}</b> FY2026 to date
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
        <InfoTip text="New PO Cost = PO spend ÷ volume purchased in the last complete week (FY2026 W42), freight included; when nothing was bought that week, the latest earlier week, marked 'as of'. Real-time cost comes from Biceps and may change after invoice reconciliation." />
      </div>

      {mode === 'recipe' && (
        <Banner lead="Read-only:" details={{ label: 'Details', onClick: () => openDefinitions('po-cost') }}>
          editing recipe costs is a separate initiative pending a scope decision. Discontinued components show in grey.
        </Banner>
      )}

      <ViewToggles />

      <KeyFigures caption={`Key figures · ${describeProductScope(state)} · as of 10/18/2026`} tiles={tiles} />

      <ChartGrid cols={2}>
        <ChartCard
          title={mode === 'po' ? 'Largest estimated impact' : 'Largest margin overstatement'}
          subtitle={mode === 'po' ? 'Top 25 items · last 4 weeks · orange = cost gap above 25 %' : 'Top 25 recipe PLUs · FY2026 to date'}
          legend={
            mode === 'po'
              ? [
                  { label: 'Cost gap above 25 %', color: C.s2, kind: 'rect' },
                  { label: 'Cost gap up to 25 %', color: C.s1, kind: 'rect' },
                ]
              : [
                  { label: 'Cost older than 6 months', color: C.s2, kind: 'rect' },
                  { label: 'Updated in the last 6 months', color: C.s1, kind: 'rect' },
                ]
          }
          height={340}
          contentHeight={hbarHeight((mode === 'po' ? impactBars : recipeBars).length)}
          table={{
            head: ['Item', 'Est. impact $'],
            rows: (mode === 'po' ? impactBars : recipeBars).map((b) => [b.label, money(b.value)]),
          }}
        >
          <HBars data={mode === 'po' ? impactBars : recipeBars} labelWidth={200} format={(v) => moneyCompact(v)} onSelect={(d) => open(Number(d.id))} />
        </ChartCard>
        {mode === 'po' ? (
          <ChartCard
            title="Cost gap by department"
            subtitle="Units-weighted New PO Cost vs HQ cost, last 4 weeks"
            height={340}
            legend={[
              { label: 'PO cost above HQ', color: C.s2, kind: 'rect' },
              { label: 'PO cost below HQ', color: C.s1, kind: 'rect' },
            ]}
            table={{ head: ['Department', 'Cost gap'], rows: deptGaps(poRows).map((d) => [d.label, pctChange(d.value / 100)]) }}
          >
            <HBars data={deptGaps(poRows)} diverging labelWidth={80} format={(v) => `${v.toFixed(1)}%`} />
          </ChartCard>
        ) : (
          topComp &&
          topRecipe && (
            <ChartCard
              title={`Component costs since the recipe was costed · ${ITEMS[topRecipe.item].name}`}
              subtitle={`Change in each component's cost since ${topRecipe.updatedLabel}; the recipe cost in HQ has not moved`}
              height={340}
              legend={compSeries.map((c) => ({ label: c.label, color: c.color }))}
              table={{ head: ['Component', 'Change since update'], rows: topComp.components.map((c) => [COMPONENTS[c.key].name, pctChange(componentIndex(c.key, CURRENT_WEEK) / componentIndex(c.key, topComp.updatedWeek) - 1)]) }}
            >
              <TrendLines data={compData} series={compSeries} format={(v) => pctChange(v)} tickFormat={(v) => `${(v * 100).toFixed(0)}%`} />
            </ChartCard>
          )
        )}
      </ChartGrid>

      <section className="card table-card" aria-label="Cost Watch table">
        <p className="card-caption">{mode === 'po' ? 'PLU and random-weight items · sorted by estimated impact · click a row to open it' : 'Recipe family › PLU › Component · sorted by estimated impact'}</p>
        {mode === 'po' ? (
          <HierTable key="po" tableId="costpo" hierarchy="SKU / PLU" columns={PO_COLUMNS} defaultSort={{ key: 'impact', dir: 'desc' }} rows={poTable} exportTitle="Cost Watch PO vs HQ" empty="No PLU or random-weight items for the current filters." />
        ) : (
          <HierTable
            key="recipe"
            tableId="costrecipe"
            hierarchy="Family › PLU › Component"
            columns={RECIPE_COLUMNS}
            defaultSort={{ key: 'impact', dir: 'desc' }}
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
    .map(([d, a]) => ({ id: d, label: DEPTS[d].name, value: (a.num / a.den - 1) * 100, color: a.num >= a.den ? C.s2 : C.s1 }))
    .sort((a, b) => b.value - a.value);
}
