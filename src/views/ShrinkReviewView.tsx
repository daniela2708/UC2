import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDay, weekEndDay, weekLabel, weekStartDay } from '../data/calendar';
import { CATS, DEPTS, ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import { RETAIL_LOSS_FACTOR } from '../data/generate';
import { PLANTED } from '../data/planted';
import { Banner, BannerStack, KeyFigures, SectionHeading, Sparkline, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { CellBar, Field, StatusChip } from '../components/ui';
import { C, ChartCard, ChartGrid, hbarHeight, ColumnsVsLy, HBars } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { actions } from '../lib/filterStore';
import { count, money, moneyCompact, pct, volume, weekTick } from '../lib/format';
import { clampLossRule, DEFAULT_LOSS_RULE, LOSS_RULE_LIMITS, lossPctOfSales, safeDiv } from '../lib/kpis';
import { findFlags, shrinkAggregates, SPARK_WEEKS, weeklyLoss, type FlagHit, type ShrinkAgg } from '../lib/selectors';
import { fiscalOfWeek } from '../data/calendar';
import { extremeInScope, incompleteStores, useScope, ViewToggles, type ViewProps } from './common';

interface Node {
  sales: number;
  ea: number;
  lb: number;
  luEa: number;
  luLb: number;
  loss: number;
  lossRetail: number;
  donations: number;
  salvage: number;
  recall: number;
  markdown: number;
  spark: Float64Array;
  flags: number;
}

const empty = (): Node => ({
  sales: 0,
  ea: 0,
  lb: 0,
  luEa: 0,
  luLb: 0,
  loss: 0,
  lossRetail: 0,
  donations: 0,
  salvage: 0,
  recall: 0,
  markdown: 0,
  spark: new Float64Array(SPARK_WEEKS),
  flags: 0,
});

function add(n: Node, a: ShrinkAgg) {
  n.sales += a.sales;
  n.ea += a.ea;
  n.lb += a.lb;
  n.luEa += a.lossUnitsEa;
  n.luLb += a.lossUnitsLb;
  n.loss += a.loss;
  n.lossRetail += a.lossRetail;
  n.donations += a.donations;
  n.salvage += a.salvage;
  n.recall += a.recall;
  n.markdown += a.markdown;
  n.flags += a.flags;
  for (let i = 0; i < SPARK_WEEKS; i++) n.spark[i] += a.spark[i];
}

function vol(ea: number, lb: number): ReactNode {
  if (lb === 0) return volume(ea, 'ea');
  if (ea === 0) return volume(lb, 'lb');
  return (
    <>
      {volume(ea, 'ea')}
      <span className="cell-sub">{volume(lb, 'lb')}</span>
    </>
  );
}

const COLUMNS: HierCol[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'units', label: 'Units sold' },
  { key: 'lu', label: 'Loss units' },
  { key: 'loss', label: 'Known Loss $' },
  { key: 'don', label: 'Donation $' },
  { key: 'tot', label: 'Total $' },
  { key: 'totPct', label: 'Total % of sales' },
  { key: 'spark', label: '26-week trend', sortable: false, title: 'Weekly known loss, last 26 weeks of the range' },
  { key: 'flag', label: 'Flag' },
];

/** Entry errors are told apart from real high loss by the units test (> 20× typical); overstock is real loss after a holiday. */
function flagLabel(f: FlagHit): string {
  if (f.entryError) return 'Likely entry error';
  if (f.kind === 'overstock') return 'Post-holiday overstock';
  return 'Real high loss';
}

function flagChip(f: FlagHit) {
  const label = flagLabel(f);
  return <span className={`chip ${f.entryError ? 'error' : f.kind === 'overstock' ? 'amber' : 'neutral'}`}>{label}</span>;
}

function ruleText(f: FlagHit, dollars: number): string {
  const ratio = Number.isFinite(f.ratio) ? `${f.ratio >= 100 ? f.ratio.toFixed(0) : f.ratio.toFixed(1)}×` : 'Far above';
  return `${ratio} its 26-week average and above ${money(dollars)}`;
}

function RulesCard() {
  const { state, update } = useScope();
  const [dollars, setDollars] = useState(String(state.rule.dollars));
  const [pctText, setPctText] = useState(String(Math.round(state.rule.pct * 100)));
  useEffect(() => {
    setDollars(String(state.rule.dollars));
    setPctText(String(Math.round(state.rule.pct * 100)));
  }, [state.rule]);
  const commit = (d: string, p: string) => {
    const dn = Number(d.replace(/[^\d.]/g, '').slice(0, 9));
    const pn = Number(p.replace(/[^\d.]/g, '').slice(0, 7)) / 100;
    if (!Number.isFinite(dn) || !Number.isFinite(pn) || d === '' || p === '') return;
    const r = clampLossRule({ dollars: dn, pct: pn });
    update((s) => ({ ...s, rule: r }));
  };
  return (
    <section className="card side-card" aria-label="Flag rule">
      <h3 className="side-title">
        Flag rule <StatusChip status="Proposed" />
      </h3>
      <p className="rule-line muted">Today: reports hide any entry above about $1,000 per SKU.</p>
      <p className="rule-line">
        Proposed: flag when weekly loss is above <b>{money(state.rule.dollars)}</b> AND more than <b>{Math.round(state.rule.pct * 100)} %</b> above
        the item-store <b>26-week average</b>.
      </p>
      <div className="rules-grid">
        <Field label={`Threshold $ (${LOSS_RULE_LIMITS.dollars.min}–${LOSS_RULE_LIMITS.dollars.max.toLocaleString('en-US')})`} htmlFor="rule-dollars">
          <input
            id="rule-dollars"
            className="text-input"
            type="number"
            inputMode="numeric"
            min={LOSS_RULE_LIMITS.dollars.min}
            max={LOSS_RULE_LIMITS.dollars.max}
            step={250}
            value={dollars}
            onChange={(e) => {
              setDollars(e.target.value.slice(0, 9));
              commit(e.target.value, pctText);
            }}
            onBlur={() => setDollars(String(state.rule.dollars))}
          />
        </Field>
        <Field label={`Above 26-week avg % (${LOSS_RULE_LIMITS.pct.min * 100}–${LOSS_RULE_LIMITS.pct.max * 100})`} htmlFor="rule-pct">
          <input
            id="rule-pct"
            className="text-input"
            type="number"
            inputMode="numeric"
            min={LOSS_RULE_LIMITS.pct.min * 100}
            max={LOSS_RULE_LIMITS.pct.max * 100}
            step={25}
            value={pctText}
            onChange={(e) => {
              setPctText(e.target.value.slice(0, 7));
              commit(dollars, e.target.value);
            }}
            onBlur={() => setPctText(String(Math.round(state.rule.pct * 100)))}
          />
        </Field>
        <button type="button" className="btn-outline" onClick={() => update((s) => ({ ...s, rule: { ...DEFAULT_LOSS_RULE } }))}>
          Reset rule
        </button>
      </div>
    </section>
  );
}

export function ShrinkReviewView({ openDefinitions }: ViewProps) {
  const { state, update, range, scope } = useScope();
  const aggs = useMemo(() => shrinkAggregates(scope), [scope]);
  const flags = useMemo(() => findFlags(scope), [scope]);
  const lossWeeks = useMemo(() => {
    const out: number[] = [];
    for (let w = Math.max(0, range.endWeek - 25); w <= range.endWeek; w++) out.push(w);
    return out;
  }, [range.endWeek]);
  const lossSeries = useMemo(() => weeklyLoss(scope, lossWeeks), [scope, lossWeeks]);
  const basis = state.lossBasis;
  const L = (n: { loss: number; lossRetail: number }) => (basis === 'cost' ? n.loss : n.lossRetail);
  const donF = (n: { donations: number }, d: number | null) => (basis === 'cost' || d === null ? n.donations : n.donations * RETAIL_LOSS_FACTOR[d]);

  const { total, rows } = useMemo(() => {
    const total = empty();
    const byDept = new Map<number, Node>();
    const byCat = new Map<number, Node>();
    const byItem = new Map<number, ShrinkAgg>();
    for (const a of aggs) {
      const it = ITEMS[a.item];
      byItem.set(a.item, a);
      add(total, a);
      if (!byDept.has(it.dept)) byDept.set(it.dept, empty());
      if (!byCat.has(it.cat)) byCat.set(it.cat, empty());
      add(byDept.get(it.dept)!, a);
      add(byCat.get(it.cat)!, a);
    }
    const cells = (n: Node, _d: number | null, retailDon: number) => {
      const loss = L(n);
      const don = retailDon;
      const tot = loss + don;
      return {
        cells: {
          sales: money(n.sales),
          units: vol(n.ea, n.lb),
          lu: vol(n.luEa, n.luLb),
          loss: money(loss),
          don: money(don),
          tot: money(tot),
          totPct: <CellBar value={lossPctOfSales(tot, n.sales)} max={0.12} text={pct(lossPctOfSales(tot, n.sales))} warm />,
          spark: <Sparkline values={n.spark} />,
          flag: n.flags ? <span className="chip error">{count(n.flags)}</span> : '',
        },
        sort: {
          sales: n.sales,
          units: n.ea + n.lb,
          lu: n.luEa + n.luLb,
          loss,
          don,
          tot,
          totPct: lossPctOfSales(tot, n.sales),
          flag: n.flags,
        },
      };
    };
    const rows: HierRow[] = [...byDept.entries()].map(([d, n]) => ({
      id: `d${d}`,
      label: DEPTS[d].name,
      ...cells(n, d, donF(n, d)),
      drill: { label: `Filter to ${DEPTS[d].name}`, onClick: () => update(actions.dept(d)) },
      children: DEPTS[d].cats
        .filter((c) => byCat.has(c))
        .map((c) => ({
          id: `c${c}`,
          label: CATS[c].name,
          ...cells(byCat.get(c)!, d, donF(byCat.get(c)!, d)),
          drill: { label: `Filter to ${CATS[c].name}`, onClick: () => update(actions.cat(c)) },
          children: aggs
            .filter((a) => ITEMS[a.item].cat === c)
            .map((a) => {
              const it = ITEMS[a.item];
              const n = empty();
              add(n, a);
              return {
                id: `i${a.item}`,
                label: (
                  <>
                    <span className="code-tag">{it.code}</span>
                    {it.name} {it.rw && <span className="chip rw">RW</span>}
                  </>
                ),
                ...cells(n, d, donF(n, d)),
              };
            }),
        })),
    }));
    let totDon = 0;
    for (const [d, n] of byDept) totDon += donF(n, d);
    return { total: { node: total, row: { id: 'total', label: 'Total', ...cells(total, null, totDon) } as HierRow }, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggs, basis, update]);

  const ranked = flags.filter((f) => !f.extreme);
  const flagDept = DEPTS.map((d) => {
    const fs = flags.filter((f) => ITEMS[f.item].dept === d.idx);
    return {
      id: d.idx,
      label: d.name,
      value: fs.filter((f) => f.entryError).length,
      compare: fs.filter((f) => !f.entryError).length,
      dollars: fs.reduce((a, f) => a + f.cost, 0),
      color: C.s2,
    };
  }).filter((d) => d.value + (d.compare ?? 0) > 0);
  const flagSheet = () => ({
    title: 'Flagged items',
    subtitle: `${describeProductScope(state)} · ${describeStoreScope(state)} · ${weeklyRange} · rule: loss > ${money(state.rule.dollars)} and > ${Math.round(state.rule.pct * 100)} % above the 26-week average`,
    head: ['Rank', 'Item', 'Code', 'Store', 'District', 'Week', 'Week beginning', 'Known loss $ (cost)', 'Loss units', 'UoM', 'Typical weekly units', '26-week average $', 'Times average', 'Assessment', 'Above plausibility cap'],
    rows: flags.map((f, n) => {
      const it = ITEMS[f.item];
      const st = STORES[f.store];
      return [
        n + 1,
        it.name,
        it.code,
        st.code,
        st.district,
        weekLabel(f.week),
        formatDay(weekStartDay(f.week)),
        Math.round(f.cost * 100) / 100,
        Math.round(f.units * 10) / 10,
        it.uom,
        Math.round(f.avgUnits * 10) / 10,
        Math.round(f.avgCost * 100) / 100,
        Number.isFinite(f.ratio) ? Math.round(f.ratio * 10) / 10 : null,
        flagLabel(f),
        f.extreme ? 'Yes' : 'No',
      ];
    }),
  });
  const extremes = flags.filter((f) => f.extreme);
  const flaggedItems = new Set(flags.map((f) => f.item)).size;
  const incomplete = incompleteStores(scope);
  const extreme = extremeInScope(scope);
  const tn = total.node;
  const loss = L(tn);
  const weeklyRange = `${formatDay(weekStartDay(range.startWeek))} – ${formatDay(weekEndDay(range.endWeek))}`;
  const basisWord = basis === 'cost' ? 'at cost' : 'at retail';

  const latestFy = fiscalOfWeek(range.endWeek).fy;
  const lossFactor = basis === 'cost' ? 1 : loss / Math.max(1, tn.loss);
  const lossChart = lossSeries.map((p) => ({
    x: weekTick(p.week, latestFy),
    value: p.loss * lossFactor,
    ly: p.ly === null ? null : p.ly * lossFactor,
    note: p.flags ? `${p.flags} flagged entr${p.flags > 1 ? 'ies' : 'y'}` : undefined,
  }));
  const lossAvg = lossChart.reduce((a, d) => a + d.value, 0) / Math.max(1, lossChart.length);
  const shrinkTypes = [
    { label: 'Known loss', value: loss, color: C.s1 },
    { label: 'Markdown', value: tn.markdown, color: C.s1 },
    { label: 'Donations', value: total.row.sort.don as number, color: C.s1 },
    { label: 'Salvage', value: tn.salvage, color: C.s1 },
    { label: 'Recall', value: tn.recall, color: C.s1 },
  ].sort((a, b) => b.value - a.value);

  const tiles: Tile[] = [
    { label: 'Known Loss $', info: 'KL1011 known loss for the complete weeks in range.', value: moneyCompact(loss), sub: `${basisWord} · ${state.flagged === 'excl' ? 'excl.' : 'incl.'} flagged` },
    { label: 'Loss % of sales', info: 'Known Loss ÷ Gross Sales.', value: pct(lossPctOfSales(loss, tn.sales)), sub: `of ${moneyCompact(tn.sales)} sales` },
    { label: 'Donations $', info: 'DY270 donations.', value: moneyCompact(total.row.sort.don as number), sub: `${pct(safeDiv(total.row.sort.don as number, tn.sales))} of sales` },
    { label: 'Salvage $', info: 'DY270 salvage, at cost.', value: moneyCompact(tn.salvage), sub: `${pct(safeDiv(tn.salvage, tn.sales))} of sales` },
    { label: 'Recall $', info: 'DY270 recalls, at cost.', value: moneyCompact(tn.recall), sub: tn.recall > 0 ? 'Product pulled from sale' : 'No recalls in range' },
    { label: 'Markdown $', info: 'POS price overrides plus department coupons, at retail (DY270).', value: moneyCompact(tn.markdown), sub: 'POS overrides + dept coupons' },
    { label: 'Items flagged', info: 'Distinct items with at least one item-store-week above the flag rule.', value: count(flaggedItems), sub: `${count(flags.length)} item-store-weeks` },
  ];

  return (
    <>
      <SectionHeading eyebrow="Known loss" title="Shrink Review" question="Where is loss real, and where is it an entry error?">
        {describeProductScope(state)}, {weeklyRange}: Known Loss <b>{moneyCompact(loss)}</b> {basisWord} (<b>{pct(lossPctOfSales(loss, tn.sales))}</b> of
        sales), <b>{count(flags.length)}</b> flagged entries across <b>{count(flaggedItems)}</b> items
        {ranked[0] && (
          <>
            ; the largest is <b>{ITEMS[ranked[0].item].name}</b> in store <b>{STORES[ranked[0].store].code}</b> at <b>{money(ranked[0].cost)}</b>
          </>
        )}
        .
      </SectionHeading>

      <BannerStack>
      {extreme && (
        <Banner lead={state.flagged === 'excl' ? 'Extreme entry excluded:' : 'Extreme entry included:'} kind={state.flagged === 'excl' ? 'alert' : 'danger'}>
          {extreme.item}, store {extreme.store}, {extreme.week}: <b>{moneyCompact(extreme.cost)}</b> of known loss.{' '}
          {state.flagged === 'excl' ? 'It is flagged and left out of every total by default.' : 'Totals now include it, which distorts department loss.'}
        </Banner>
      )}
      {incomplete.length > 0 && (
        <Banner
          lead="Incomplete reporting:"
          details={{ content: <>Stores {incomplete.map((s) => String(s).padStart(3, '0')).join(', ')} show no known loss for {weekLabel(PLANTED.incomplete.week)}. Totals for that week are understated until they post.</> }}
        >
          {incomplete.length} store{incomplete.length > 1 ? 's have' : ' has'} not posted known loss for {weekLabel(PLANTED.incomplete.week).split(' ')[1]}.
        </Banner>
      )}
      </BannerStack>

      <ViewToggles loss flagged />

      <KeyFigures
        caption={`Key figures · ${describeProductScope(state)} · ${describeStoreScope(state)} · ${range.fyLabel} · ${weeklyRange}`}
        tiles={tiles}
        note={
          <>
            Known loss valuation is <b>Pending validation</b>; the flag rule is <b>Proposed</b>.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('high-loss-flag')}>
              See definitions
            </button>
          </>
        }
      />
      <ChartGrid cols={2}>
        <ChartCard
          title="Known loss by week"
          subtitle={`Last 26 weeks to ${weekTick(range.endWeek, latestFy)} · at cost · ${state.flagged === 'excl' ? 'flagged entries excluded' : 'flagged entries included'}`}
          legend={[
            { label: 'This year', color: C.s1, kind: 'rect' },
            { label: 'Last year', color: C.ly },
          ]}
          table={{ head: ['Week', 'Known loss', 'LY', 'Flags'], rows: lossChart.map((d) => [d.x, money(d.value), money(d.ly), d.note ?? '']) }}
        >
          <ColumnsVsLy data={lossChart} format={(v) => money(v)} tickFormat={(v) => moneyCompact(v)} avg={lossAvg} />
        </ChartCard>
        <ChartCard
          title="Shrink by type"
          contentHeight={hbarHeight(shrinkTypes.length)}
          subtitle={`${weeklyRange} · known loss and donations ${basisWord}; markdown at retail`}
          table={{ head: ['Type', 'Amount', '% of sales'], rows: shrinkTypes.map((t) => [t.label, money(t.value), pct(lossPctOfSales(t.value, tn.sales))]) }}
        >
          <HBars data={shrinkTypes} labelWidth={96} format={(v) => moneyCompact(v)} valueLabel="Amount" />
        </ChartCard>
      </ChartGrid>
      {range.snapped && <Banner kind="note">Known loss is weekly. Values aggregate to complete fiscal weeks ({weeklyRange}).</Banner>}

      <section className="card table-card" aria-label="Known loss by item">
          <p className="card-caption">Department › Category › Item · {weeklyRange}</p>
          <HierTable
            key={scope.productKey}
            hierarchy="Department › Category › Item"
            columns={COLUMNS}
            defaultSort={{ key: 'loss', dir: 'desc' }}
            defaultExpanded={state.dept >= 0 ? [`d${state.dept}`, ...(state.cat >= 0 ? [`c${state.cat}`] : [])] : []}
            total={total.row}
            rows={rows}
            exportTitle={`Shrink Review ${weeklyRange}`}
          />
        </section>

      <ChartGrid cols={2}>
          <section className="card side-card" aria-label="Flagged items">
            <div className="side-actions">
              <div>
                <h3 className="side-title">Flagged items</h3>
                <p className="side-sub">Item-store-weeks above the rule, largest first · known loss at cost</p>
              </div>
              <ExportButton fileName="Flagged items" getSheet={flagSheet} />
            </div>
            {extremes.length > 0 && (
              <div className="extreme-box">
                <b>Above plausibility cap ($100,000 per entry), listed apart:</b>
                {extremes.map((f) => (
                  <div key={`${f.item}-${f.store}-${f.week}`} style={{ marginTop: 4 }}>
                    {ITEMS[f.item].name} · store {STORES[f.store].code} · {weekLabel(f.week)} · <b>{moneyCompact(f.cost)}</b>{' '}
                    {f.entryError && <span className="chip error">Likely entry error</span>}
                  </div>
                ))}
              </div>
            )}
            {ranked.length === 0 ? (
              <p className="empty">No entries meet the rule for the current filters.</p>
            ) : (
              <ol className="flag-list" aria-label="Flagged item-store-weeks">
                {ranked.slice(0, 60).map((f, n) => {
                  const it = ITEMS[f.item];
                  const st = STORES[f.store];
                  return (
                    <li key={`${f.item}-${f.store}-${f.week}`}>
                      <div className="flag-top">
                        <b>
                          <span className="rank">{n + 1}</span>
                          {it.name}
                        </b>
                        <span className="flag-amt">{money(f.cost)}</span>
                      </div>
                      <div className="flag-meta">
                        <span>
                          Store {st.code} · {st.district}
                        </span>
                        <span>
                          {weekLabel(f.week)} ({formatDay(weekStartDay(f.week))})
                        </span>
                        <span>
                          {volume(f.units, it.uom)} vs {volume(f.avgUnits, it.uom)} typical
                        </span>
                        {flagChip(f)}
                      </div>
                      <div className="flag-rule">{ruleText(f, state.rule.dollars)}</div>
                    </li>
                  );
                })}
              </ol>
            )}
            {ranked.length > 60 && <p className="side-sub">Showing the 60 largest of {count(ranked.length)}; the Excel file has all of them.</p>}
          </section>
        <div className="stack">
          <ChartCard
            title="Flagged entries by department"
            subtitle="Count of item-store-weeks above the rule · entry errors vs other high loss"
            height={300}
            contentHeight={hbarHeight(flagDept.length, true)}
            legend={[
              { label: 'Likely entry error', color: C.s2, kind: 'rect' },
              { label: 'Other high loss', color: C.s1, kind: 'rect' },
            ]}
            table={{ head: ['Department', 'Likely entry errors', 'Other high loss', 'Flagged $'], rows: flagDept.map((d) => [d.label, d.value, d.compare ?? 0, money(d.dollars)]) }}
          >
            <HBars data={flagDept} labelWidth={70} compareLabel="Other high loss" compareColor={C.s1} valueLabel="Likely entry error" format={(v) => count(v)} />
          </ChartCard>
          <RulesCard />
        </div>
      </ChartGrid>
    </>
  );
}
