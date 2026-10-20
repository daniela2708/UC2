import { useMemo } from 'react';
import { COMPONENTS, componentIndex, DEPTS, ITEMS } from '../data/products';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { StatusChip, Var } from '../components/ui';
import { C, ChartCard, ChartGrid, hbarHeight, HBars, TrendLines } from '../components/Charts';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { count, money, moneyCompact, moneyUnit, pct, pctChange, weekTick } from '../lib/format';
import { pointsDiff } from '../lib/kpis';
import { pluRows } from '../lib/selectors';
import { CURRENT_WEEK } from '../data/calendar';
import { useScope, ViewToggles, type ViewProps } from './common';

const COMPOSITE_DEPTS = DEPTS.filter((d) => d.name === 'Deli' || d.name === 'Bakery').map((d) => d.idx);

const COLUMNS: HierCol[] = [
  { key: 'components', label: 'Components' },
  { key: 'cost', label: 'Current cost' },
  { key: 'updated', label: 'Cost last updated', title: 'Month the recipe cost was last changed in the Excel file' },
  { key: 'age', label: 'Age (months)' },
  { key: 'est', label: 'Estimated current cost', title: 'Current cost moved by each component’s cost change since the last update' },
  { key: 'gap', label: 'GM % overstated by', title: 'Displayed GM % − estimated GM %' },
  { key: 'impact', label: 'Est. margin impact $ (YTD)', title: '(Estimated − current cost) × units sold, FY2026 to date' },
];

export function PluCostWatchView({ openDefinitions }: ViewProps) {
  const { state, scope } = useScope({ onlyDepts: COMPOSITE_DEPTS });
  const rows = useMemo(() => pluRows(scope), [scope]);

  const tableRows: HierRow[] = rows.map((r) => {
    const it = ITEMS[r.item];
    const comp = it.composite!;
    const stale = r.ageMonths > 6;
    const gap = pointsDiff(r.displayedMargin, r.estMargin);
    return {
      id: `p${r.item}`,
      label: (
        <>
          <span className="code-tag">{it.code}</span>
          {it.name} {stale && <span className="chip amber">Older than 6 months</span>}
        </>
      ),
      sub: `${DEPTS[it.dept].name} · retail ${moneyUnit(it.basePrice)}`,
      className: stale ? 'is-stale' : undefined,
      cells: {
        components: count(r.components),
        cost: moneyUnit(r.currentCost),
        updated: <span className={stale ? 'amber' : undefined}>{r.updatedLabel}</span>,
        age: count(r.ageMonths),
        est: moneyUnit(r.estCost),
        gap: <Var value={gap === null ? null : -gap} />,
        impact: money(-r.impact),
      },
      sort: { label: it.name, components: r.components, cost: r.currentCost, updated: comp.updatedWeek, age: r.ageMonths, est: r.estCost, gap, impact: r.impact },
      children: comp.components.map((c) => {
        const move = componentIndex(c.key, CURRENT_WEEK) / componentIndex(c.key, comp.updatedWeek) - 1;
        return {
          id: `p${r.item}-${c.key}`,
          label: COMPONENTS[c.key].name,
          sub: `${pct(c.share)} of recipe cost`,
          cells: {
            components: '',
            cost: moneyUnit(r.currentCost * c.share),
            updated: '',
            age: '',
            est: (
              <>
                {moneyUnit(r.currentCost * c.share * (1 + move))}
                <span className="cell-sub">{pctChange(move)} since update</span>
              </>
            ),
            gap: '',
            impact: '',
          },
          sort: { cost: r.currentCost * c.share, est: move },
        };
      }),
    };
  });

  const stale = rows.filter((r) => r.ageMonths > 6);
  const impact = rows.reduce((a, r) => a + r.impact, 0);
  const avgAge = rows.length ? rows.reduce((a, r) => a + r.ageMonths, 0) / rows.length : null;
  const topRow = rows[0];
  const notComposite = state.dept >= 0 && !COMPOSITE_DEPTS.includes(state.dept);

  const SLOT = [C.s1, C.s2, C.s3, C.s4, '#e87ba4', '#008300', '#6250d6'];
  const topComp = topRow ? ITEMS[topRow.item].composite! : null;
  const compSeries = topComp ? topComp.components.map((c, i) => ({ key: c.key, label: COMPONENTS[c.key].name, color: SLOT[i % SLOT.length] })) : [];
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
  const impactBars = rows.slice(0, 25).map((r) => ({
    id: r.item,
    label: ITEMS[r.item].name,
    value: r.impact,
    color: r.ageMonths > 6 ? C.s2 : C.s1,
    tip: [
      { label: 'Margin overstated (YTD)', value: money(r.impact), color: C.s2 },
      { label: 'Cost last updated', value: r.updatedLabel },
      { label: 'Current → estimated cost', value: `${moneyUnit(r.currentCost)} → ${moneyUnit(r.estCost)}` },
    ],
  }));

  const tiles: Tile[] = [
    { label: 'Composite PLUs', info: 'Deli and Bakery items whose cost comes from a recipe kept in Excel.', value: count(rows.length), sub: 'Deli and Bakery recipes' },
    { label: 'Older than 6 months', info: 'Recipe cost not updated in the last 6 months.', value: count(stale.length), sub: rows.length ? `${pct(stale.length / rows.length)} of composite PLUs` : '—' },
    { label: 'Average age', info: 'Average months since the recipe cost was last updated.', value: avgAge === null ? '—' : `${avgAge.toFixed(1)} mo`, sub: 'As of 10/2026' },
    { label: 'Est. margin impact', info: 'Σ (estimated − current cost) × units sold, FY2026 year to date. Margin overstated by this amount.', value: moneyCompact(-impact), sub: 'FY2026 to date' },
    {
      label: 'Largest gap',
      info: 'Displayed GM % minus estimated GM % for the item with the largest impact.',
      value: topRow ? <Var value={-(pointsDiff(topRow.displayedMargin, topRow.estMargin) ?? 0)} /> : '—',
      sub: topRow ? ITEMS[topRow.item].name : '—',
    },
  ];

  return (
    <>
      <SectionHeading eyebrow="Cost freshness" title="PLU Cost Watch" question="Which composite PLU costs are out of date?">
        {describeProductScope(state)}: <b>{count(stale.length)}</b> of <b>{count(rows.length)}</b> composite PLUs have costs older than 6 months; estimated margin
        overstatement <b>{moneyCompact(impact)}</b> FY2026 to date
        {topRow && (
          <>
            , led by <b>{ITEMS[topRow.item].name}</b> (cost last updated <b>{topRow.updatedLabel}</b>)
          </>
        )}
        .
      </SectionHeading>

      <Banner lead="Read-only concept." details={{ label: 'Details', onClick: () => openDefinitions('net-cost-unit') }}>
        Editing recipe costs is a separate initiative pending a scope decision.
      </Banner>

      <ViewToggles>
        <StatusChip status="Proposed" />
      </ViewToggles>

      <KeyFigures caption={`Key figures · ${describeProductScope(state)} · ${describeStoreScope(state)} · FY2026 · as of 10/18/2026`} tiles={tiles} note="Estimated current cost applies each component’s cost change since the recipe was last updated. Proposed method." />

      <ChartGrid cols={2}>
        <ChartCard
          title="Largest margin overstatement"
          contentHeight={hbarHeight(impactBars.length)}
          subtitle="Top 25 composite PLUs · FY2026 to date"
          legend={[
            { label: 'Cost older than 6 months', color: C.s2, kind: 'rect' },
            { label: 'Cost updated in the last 6 months', color: C.s1, kind: 'rect' },
          ]}
          height={320}
          table={{ head: ['PLU', 'Overstated', 'Updated'], rows: rows.slice(0, 25).map((r) => [ITEMS[r.item].name, money(r.impact), r.updatedLabel]) }}
        >
          <HBars data={impactBars} labelWidth={190} format={(v) => moneyCompact(v)} />
        </ChartCard>
        {topComp && topRow && (
          <ChartCard
            title={`Component costs since the last update · ${ITEMS[topRow.item].name}`}
            subtitle={`Change in each component's cost since ${topRow.updatedLabel}; the recipe cost has not moved`}
            height={320}
            legend={compSeries.map((c) => ({ label: c.label, color: c.color }))}
            table={{
              head: ['Component', 'Share of cost', 'Change since update'],
              rows: topComp.components.map((c) => [COMPONENTS[c.key].name, pct(c.share), pctChange(componentIndex(c.key, CURRENT_WEEK) / componentIndex(c.key, topComp.updatedWeek) - 1)]),
            }}
          >
            <TrendLines data={compData} series={compSeries} format={(v) => pctChange(v)} tickFormat={(v) => `${(v * 100).toFixed(0)}%`} />
          </ChartCard>
        )}
      </ChartGrid>

      <section className="card table-card" aria-label="Composite PLU costs">
        <p className="card-caption">Composite PLU › Component · sorted by estimated margin impact</p>
        {notComposite ? (
          <p className="empty">Composite PLUs exist only in Deli and Bakery. Choose one of them or All fresh.</p>
        ) : (
          <HierTable
            key={scope.productKey}
            hierarchy="PLU · Description"
            columns={COLUMNS}
            defaultSort={{ key: 'impact', dir: 'desc' }}
            rows={tableRows}
            exportTitle="PLU Cost Watch"
            empty="No composite PLUs for the current filters."
          />
        )}
      </section>
    </>
  );
}
