import { useMemo, useState, type ReactNode } from 'react';
import { CURRENT_WEEK, fiscalOfWeek, formatDay, LAST_COMPLETE_WEEK, weekEndDay, weekStartDay } from '../data/calendar';
import { periodWeeksOf } from '../data/generate';
import { DEPTS } from '../data/products';
import { DISTRICTS, REGIONS, STORES } from '../data/stores';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { InfoTip, Var } from '../components/ui';
import { C, ChartCard, ChartGrid, hbarHeight, HBars, TrendLines } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { describeStoreScope } from '../lib/filters';
import { actions } from '../lib/filterStore';
import { DASH, money, moneyCompact, pct, pts, weekTick } from '../lib/format';
import {
  budgetGpPct,
  CHANNEL_LABEL,
  freshGpPct,
  lossPctOfSales,
  pointsDiff,
  PURCHASE_CHANNELS,
  safeDiv,
  totalPurchases,
  type PurchaseBreakdown,
} from '../lib/kpis';
import { addBreakdown, freshStoreWeeks, storeCatLoss, trendWeeks, zeroBreakdown, type StoreWeekFresh } from '../lib/selectors';
import { useScope, ViewToggles, type ViewProps } from './common';

interface Node {
  sales: number;
  purchases: PurchaseBreakdown;
  budget: number;
  lySales: number;
  lyPurchases: number;
  weeks: { sales: number; purchases: number }[];
}

function emptyNode(nWeeks: number): Node {
  return {
    sales: 0,
    purchases: zeroBreakdown(),
    budget: 0,
    lySales: 0,
    lyPurchases: 0,
    weeks: Array.from({ length: nWeeks }, () => ({ sales: 0, purchases: 0 })),
  };
}

function addNode(into: Node, n: Node): void {
  into.sales += n.sales;
  addBreakdown(into.purchases, n.purchases);
  into.budget += n.budget;
  into.lySales += n.lySales;
  into.lyPurchases += n.lyPurchases;
  n.weeks.forEach((w, i) => {
    into.weeks[i].sales += w.sales;
    into.weeks[i].purchases += w.purchases;
  });
}

const purchOf = (c: StoreWeekFresh) => totalPurchases(c.purchases);

export function FreshReportView({ openDefinitions }: ViewProps) {
  const { state, update, range, scope } = useScope({ deptOnly: true });
  const depts = useMemo(() => (state.dept >= 0 ? [state.dept] : DEPTS.map((d) => d.idx)), [state.dept]);
  const [selected, setSelected] = useState<string>('total');

  const rangeWeeks = useMemo(() => {
    const w: number[] = [];
    for (let x = range.startWeek; x <= range.endWeek; x++) w.push(x);
    return w;
  }, [range.startWeek, range.endWeek]);
  // Week columns: the fiscal period containing the end of the range, plus the week before for the first change.
  const colWeeks = useMemo(() => periodWeeksOf(range.endWeek), [range.endWeek]);
  const lyWeeks = useMemo(() => (range.lyAvailable ? rangeWeeks.map((w) => w - 52) : []), [rangeWeeks, range.lyAvailable]);
  const allWeeks = useMemo(
    () => [...new Set([...rangeWeeks, ...lyWeeks, colWeeks[0] - 1, ...colWeeks])].filter((w) => w >= 0).sort((a, b) => a - b),
    [rangeWeeks, lyWeeks, colWeeks],
  );
  const data = useMemo(() => freshStoreWeeks(scope, depts, allWeeks), [scope, depts, allWeeks]);
  const lossData = useMemo(() => storeCatLoss(scope), [scope]);
  const tWeeks = useMemo(() => trendWeeks(range), [range]);
  const trend = useMemo(() => {
    const all = [...tWeeks, ...tWeeks.map((w) => w - 52).filter((w) => w >= 0)];
    const rows = freshStoreWeeks(scope, depts, all);
    const sum = (w: number) => {
      const i = all.indexOf(w);
      let sales = 0;
      let purch = 0;
      let budget = 0;
      if (i < 0) return null;
      for (const row of rows.values()) {
        sales += row[i].sales;
        purch += totalPurchases(row[i].purchases);
        budget += row[i].budget;
      }
      return { gp: freshGpPct(sales, purch), budget: safeDiv(budget, sales) };
    };
    const fy = fiscalOfWeek(tWeeks[tWeeks.length - 1]).fy;
    return tWeeks.map((w) => {
      const ty = sum(w);
      const ly = w >= 52 ? sum(w - 52) : null;
      return { x: weekTick(w, fy), gp: ty?.gp ?? null, budget: ty?.budget ?? null, ly: ly?.gp ?? null };
    });
  }, [scope, depts, tWeeks]);

  const { total, regionNodes, districtNodes, storeNodes } = useMemo(() => {
    const pos = new Map(allWeeks.map((w, i) => [w, i]));
    const cols = [colWeeks[0] - 1, ...colWeeks];
    const storeNodes = new Map<number, Node>();
    for (const [s, row] of data) {
      const n = emptyNode(cols.length);
      for (const w of rangeWeeks) {
        const c = row[pos.get(w)!];
        n.sales += c.sales;
        addBreakdown(n.purchases, c.purchases);
        n.budget += c.budget;
      }
      for (const w of lyWeeks) {
        const c = row[pos.get(w)!];
        n.lySales += c.sales;
        n.lyPurchases += purchOf(c);
      }
      cols.forEach((w, i) => {
        const p = pos.get(w);
        if (p === undefined) return;
        n.weeks[i].sales = row[p].sales;
        n.weeks[i].purchases = purchOf(row[p]);
      });
      storeNodes.set(s, n);
    }
    const districtNodes = new Map<string, Node>();
    const regionNodes = new Map<number, Node>();
    const total = emptyNode(cols.length);
    for (const [s, n] of storeNodes) {
      const st = STORES[s];
      if (!districtNodes.has(st.district)) districtNodes.set(st.district, emptyNode(cols.length));
      if (!regionNodes.has(st.region)) regionNodes.set(st.region, emptyNode(cols.length));
      addNode(districtNodes.get(st.district)!, n);
      addNode(regionNodes.get(st.region)!, n);
      addNode(total, n);
    }
    return { total, regionNodes, districtNodes, storeNodes };
  }, [data, allWeeks, colWeeks, rangeWeeks, lyWeeks]);

  // Store outliers: a department more than 5 pts below budget in each of the last 4 complete weeks of the range.
  const outliers = useMemo(() => {
    const last4 = [range.endWeek - 3, range.endWeek - 2, range.endWeek - 1, range.endWeek].filter((w) => w >= 0);
    const out: { store: number; dept: number; gap: number; dsd: number }[] = [];
    for (const d of depts) {
      const rows = freshStoreWeeks(scope, [d], last4);
      for (const [s, row] of rows) {
        let ok = row.length === 4;
        let sales = 0;
        let purch = 0;
        let budget = 0;
        let dsd = 0;
        for (const c of row) {
          const gp = freshGpPct(c.sales, purchOf(c));
          const b = safeDiv(c.budget, c.sales);
          if (gp === null || b === null || gp - b > -0.05) ok = false;
          sales += c.sales;
          purch += purchOf(c);
          budget += c.budget;
          dsd += c.purchases.dsd;
        }
        if (ok) out.push({ store: s, dept: d, gap: (freshGpPct(sales, purch)! - budget / sales) * 100, dsd: dsd / sales });
      }
    }
    return out.sort((a, b) => a.gap - b.gap);
  }, [scope, depts, range.endWeek]);

  const columns: HierCol[] = [
    { key: 'sales', label: 'Sales' },
    { key: 'purch', label: 'Total Purchases' },
    { key: 'gp', label: 'GP %' },
    { key: 'budget', label: 'Budget GP %' },
    { key: 'vsBudget', label: 'vs Budget' },
    ...colWeeks.map((w, i) => ({
      key: `w${i}`,
      label: `Week ${i + 1}`,
      title: `${formatDay(weekStartDay(w))} – ${formatDay(weekEndDay(w))} (FY${fiscalOfWeek(w).fy} W${fiscalOfWeek(w).week})`,
    })),
  ];

  const nodeRow = (id: string, label: ReactNode, n: Node, children?: HierRow[], drill?: HierRow['drill']): HierRow => {
    const purch = totalPurchases(n.purchases);
    const gp = freshGpPct(n.sales, purch);
    const budget = budgetGpPct(n.budget, n.sales);
    const cells: Record<string, ReactNode> = {
      sales: money(n.sales),
      purch: money(purch),
      gp: pct(gp),
      budget: pct(budget),
      vsBudget: <Var value={pointsDiff(gp, budget)} />,
    };
    const sort: Record<string, number | null> = { sales: n.sales, purch, gp, budget, vsBudget: pointsDiff(gp, budget) };
    colWeeks.forEach((w, i) => {
      const cur = n.weeks[i + 1];
      const prev = n.weeks[i];
      const g = freshGpPct(cur.sales, cur.purchases);
      const future = w > LAST_COMPLETE_WEEK;
      cells[`w${i}`] = future ? (
        <span className="flat" title={w === CURRENT_WEEK ? 'Week in progress' : 'Future week'}>
          {DASH}
          <span className="cell-sub">{w === CURRENT_WEEK ? 'In progress' : 'Not yet'}</span>
        </span>
      ) : (
        <>
          {pct(g)}
          <span className="cell-sub">
            <Var value={pointsDiff(g, freshGpPct(prev.sales, prev.purchases))} />
          </span>
        </>
      );
      sort[`w${i}`] = future ? null : g;
    });
    return { id, label, cells, sort, children, drill, onSelect: () => setSelected(id), selected: selected === id };
  };

  const rows: HierRow[] = REGIONS.filter((r) => regionNodes.has(r)).map((r) =>
    nodeRow(
      `r${r}`,
      `Region ${r}`,
      regionNodes.get(r)!,
      DISTRICTS.filter((d) => d.region === r && districtNodes.has(d.id)).map((d) =>
        nodeRow(
          `d${d.id}`,
          d.id,
          districtNodes.get(d.id)!,
          d.stores
            .filter((s) => storeNodes.has(s))
            .map((s) => nodeRow(`s${s}`, `Store ${STORES[s].code}`, storeNodes.get(s)!, undefined)),
          { label: `Filter to ${d.id}`, onClick: () => update((st) => ({ ...actions.region(d.region)(st), districts: [d.id], stores: [] })) },
        ),
      ),
      { label: `Filter to Region ${r}`, onClick: () => update(actions.region(r)) },
    ),
  );

  const selNode =
    selected === 'total'
      ? total
      : selected.startsWith('r')
        ? regionNodes.get(Number(selected.slice(1)))
        : selected.startsWith('d')
          ? districtNodes.get(selected.slice(1))
          : storeNodes.get(Number(selected.slice(1)));
  const selLabel =
    selected === 'total'
      ? describeStoreScope(state)
      : selected.startsWith('r')
        ? `Region ${selected.slice(1)}`
        : selected.startsWith('d')
          ? selected.slice(1)
          : `Store ${STORES[Number(selected.slice(1))]?.code ?? ''}`;

  const purch = totalPurchases(total.purchases);
  const gp = freshGpPct(total.sales, purch);
  const budget = budgetGpPct(total.budget, total.sales);
  const lyGp = freshGpPct(total.lySales, total.lyPurchases);
  let lossSum = 0;
  let lossSales = 0;
  const deptSet = new Set(depts);
  for (const row of lossData.values())
    row.forEach((v, c) => {
      if (!deptSet.has(DEPTS.findIndex((d) => d.cats.includes(c)))) return;
      lossSum += v.loss;
      lossSales += v.sales;
    });
  const deptLabel = state.dept >= 0 ? DEPTS[state.dept].name : 'All fresh';
  const weeksLabel = `W${fiscalOfWeek(range.startWeek).week}${range.startWeek !== range.endWeek ? `–W${fiscalOfWeek(range.endWeek).week}` : ''}`;
  const weeklyRange = `${formatDay(weekStartDay(range.startWeek))} – ${formatDay(weekEndDay(range.endWeek))}`;
  const showGrainStrip = range.isDaily || (effectiveTimeIsCustom(state) && range.snapped);

  const tiles: Tile[] = [
    { label: 'Sales', info: 'Department sales for the complete fiscal weeks in range.', value: moneyCompact(total.sales), sub: `Complete weeks ${weeksLabel}` },
    { label: 'Total Purchases', info: 'Whse + DSD + Packaging + Reclaim + Transfers + In transit + Donations + WC credit + Scan credit.', value: moneyCompact(purch), sub: 'Excludes third-party channels' },
    { label: 'GP %', info: '(Sales − Total Purchases) ÷ Sales. Fresh Report logic.', value: pct(gp), sub: 'Sales − Purchases ÷ Sales' },
    { label: 'Budget GP %', info: 'Budget by department, store and period, weighted by sales.', value: pct(budget), sub: 'Fresh Report budget' },
    { label: 'GP % vs Budget', info: 'GP % − Budget GP %, in percentage points.', value: <Var value={pointsDiff(gp, budget)} />, sub: 'Percentage points' },
    {
      label: 'GP % vs LY',
      info: 'GP % − GP % for the same fiscal weeks last year.',
      value: <Var value={range.lyAvailable ? pointsDiff(gp, lyGp) : null} />,
      sub: range.lyAvailable ? `LY ${pct(lyGp)}` : 'No last-year history',
    },
    {
      label: 'Known Loss %',
      info: 'Known loss at cost ÷ sales, excluding flagged entries by default.',
      value: pct(lossPctOfSales(lossSum, lossSales)),
      sub: `of sales · ${state.flagged === 'excl' ? 'excl.' : 'incl.'} flagged`,
    },
  ];

  const districtGaps = DISTRICTS.filter((d) => districtNodes.has(d.id))
    .map((d) => {
      const n = districtNodes.get(d.id)!;
      const g = freshGpPct(n.sales, totalPurchases(n.purchases));
      const b = budgetGpPct(n.budget, n.sales);
      const v = pointsDiff(g, b) ?? 0;
      return {
        id: d.id,
        label: d.id,
        value: v,
        gp: g,
        budget: b,
        color: v >= 0 ? C.pos : C.neg,
        tip: [
          { label: 'GP %', value: pct(g) },
          { label: 'Budget GP %', value: pct(b) },
          { label: 'vs budget', value: pts(v) },
        ],
      };
    })
    .sort((a, b) => a.value - b.value);

  const selPurch = selNode ? totalPurchases(selNode.purchases) : 0;
  const mixData = selNode
    ? PURCHASE_CHANNELS.map((ch) => {
        const v = (safeDiv(selNode.purchases[ch], selNode.sales) ?? 0) * 100;
        return { id: ch, label: CHANNEL_LABEL[ch], value: v, color: v < 0 ? C.ly : C.s1 };
      })
    : [];

  return (
    <>
      <SectionHeading eyebrow="Store profitability" title="Fresh Report" question="Which stores and districts are behind on fresh margin?">
        {deptLabel}, {weeklyRange}: Sales <b>{moneyCompact(total.sales)}</b>, Purchases <b>{moneyCompact(purch)}</b>, GP % <b>{pct(gp)}</b> (
        <b>
          <Var value={pointsDiff(gp, budget)} />
        </b>{' '}
        vs. budget
        {range.lyAvailable && (
          <>
            ,{' '}
            <b>
              <Var value={pointsDiff(gp, lyGp)} />
            </b>{' '}
            vs. last year
          </>
        )}
        ).
      </SectionHeading>

      <Banner lead="Known gap:" details={{ label: 'Details', onClick: () => openDefinitions('total-purchases') }}>
        purchases shipped through CNS, DN and Milton are not in the source systems.
      </Banner>
      {outliers.slice(0, 3).map((o) => {
        const st = STORES[o.store];
        return (
          <Banner
            key={`${o.store}-${o.dept}`}
            lead="Below budget:"
            details={{
              label: 'Show store',
              onClick: () => {
                update((s) => ({ ...actions.region(st.region)(actions.dept(o.dept)(s)), districts: [st.district], stores: [] }));
                setSelected(`s${o.store}`);
              },
            }}
          >
            store {st.code} ({st.district}) {DEPTS[o.dept].name} GP % has been <b>{Math.abs(o.gap).toFixed(1)} pts below budget</b> for 4 consecutive weeks,
            with DSD purchases at <b>{pct(o.dsd)}</b> of sales.
          </Banner>
        );
      })}

      <ViewToggles />

      <KeyFigures
        caption={`Key figures · ${deptLabel} · ${describeStoreScope(state)} · ${range.fyLabel} · ${weeklyRange}`}
        tiles={tiles}
        note={
          <>
            Fresh GP % reproduces the Accounting Fresh Report. Budget GP % and purchases are <b>Draft</b>.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('fresh-gp')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartGrid cols={2}>
        <ChartCard
          title="Fresh GP % by week"
          subtitle={`${deptLabel} · actual vs budget and last year · ${trend[0]?.x ?? ''}–${trend[trend.length - 1]?.x ?? ''}`}
          legend={[
            { label: 'GP % this year', color: C.s1 },
            { label: 'Budget GP %', color: C.s2 },
            { label: 'GP % last year', color: C.ly },
          ]}
          table={{ head: ['Week', 'GP %', 'Budget', 'LY'], rows: trend.map((t) => [t.x, pct(t.gp), pct(t.budget), pct(t.ly)]) }}
        >
          <TrendLines
            data={trend}
            series={[
              { key: 'gp', label: 'GP % this year', color: C.s1 },
              { key: 'budget', label: 'Budget GP %', color: C.s2 },
              { key: 'ly', label: 'GP % last year', color: C.ly },
            ]}
            format={(v) => pct(v)}
            tickFormat={(v) => `${(v * 100).toFixed(1)}%`}
          />
        </ChartCard>
        <ChartCard
          title="Districts vs budget"
          legend={[
            { label: '▲ Above budget', color: C.pos, kind: 'rect' },
            { label: '▼ Below budget', color: C.neg, kind: 'rect' },
          ]}
          subtitle={`GP % minus budget GP %, ${weeklyRange} · click a district to filter`}
          height={340}
          contentHeight={hbarHeight(districtGaps.length)}
          table={{ head: ['District', 'GP %', 'Budget', 'vs Budget'], rows: districtGaps.map((d) => [d.label, pct(d.gp), pct(d.budget), pts(d.value)]) }}
        >
          <HBars
            data={districtGaps}
            diverging
            arrows
            labelWidth={70}
            format={(v) => pts(v)}
            onSelect={(d) => {
              const dist = DISTRICTS.find((x) => x.id === d.id);
              if (dist) update((st) => ({ ...actions.region(dist.region)(st), districts: [dist.id], stores: [] }));
            }}
          />
        </ChartCard>
      </ChartGrid>

      {showGrainStrip && <Banner kind="note">The Fresh Report is weekly. Values aggregate to complete fiscal weeks.</Banner>}

      <section className="card table-card" aria-label="Fresh Report table">
        <p className="card-caption">
          Region › District › Store · {weeklyRange} · week columns show P{fiscalOfWeek(range.endWeek).period} FY{fiscalOfWeek(range.endWeek).fy}
        </p>
        <HierTable
          hierarchy="Region › District › Store"
          columns={columns}
          defaultSort={{ key: 'label', dir: 'asc' }}
          defaultExpanded={state.districts.length ? REGIONS.map((r) => `r${r}`).concat(state.districts.map((d) => `d${d}`)) : []}
          total={nodeRow('total', 'Total', total)}
          exportTitle={`Fresh Report ${weeklyRange}`}
          rows={rows}
          key={`${scope.storeKey.length}-${state.districts.join()}`}
        />
        <p className="card-caption" style={{ marginTop: 10 }}>
          Weekly change under each week is in percentage points vs the week before. Select a row to see its purchases breakdown.
        </p>
      </section>

      <ChartGrid cols={2}>
      <section className="card side-card" aria-label="Purchases breakdown">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Purchases breakdown · {selLabel}</h3>
              <p className="side-sub">
                {deptLabel} · {weeklyRange} · Fresh Report channels
              </p>
            </div>
            {selNode && (
              <ExportButton
                fileName={`Purchases breakdown ${selLabel}`}
                getSheet={() => ({
                  title: `Purchases breakdown · ${selLabel}`,
                  subtitle: `${deptLabel} · ${weeklyRange}`,
                  head: ['Channel', '$', '% of sales'],
                  rows: [
                    ...PURCHASE_CHANNELS.map((ch) => [CHANNEL_LABEL[ch], Math.round(selNode.purchases[ch] * 100) / 100, pct(safeDiv(selNode.purchases[ch], selNode.sales))]),
                    ['Third-party channels (CNS, DN, Milton): not in source', null, null],
                    ['Total purchases', Math.round(selPurch * 100) / 100, pct(safeDiv(selPurch, selNode.sales))],
                    ['Sales', Math.round(selNode.sales * 100) / 100, null],
                    ['GP %', null, pct(freshGpPct(selNode.sales, selPurch))],
                  ],
                })}
              />
            )}
          </div>
          {selNode && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th className="left">Channel</th>
                  <th>$</th>
                  <th>% of sales</th>
                </tr>
              </thead>
              <tbody>
                {PURCHASE_CHANNELS.map((ch) => (
                  <tr key={ch}>
                    <td className="left">{CHANNEL_LABEL[ch]}</td>
                    <td>{money(selNode.purchases[ch])}</td>
                    <td>{pct(safeDiv(selNode.purchases[ch], selNode.sales))}</td>
                  </tr>
                ))}
                <tr className="muted">
                  <td className="left">
                    Third-party channels: not in source{' '}
                    <InfoTip text="Cases shipped by CNS, DN and Milton are tracked by email and Excel, so they are missing from purchases and GP % is overstated by their amount." />
                  </td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                </tr>
                <tr className="total">
                  <td className="left">Total purchases</td>
                  <td>{money(selPurch)}</td>
                  <td>{pct(safeDiv(selPurch, selNode.sales))}</td>
                </tr>
                <tr className="total">
                  <td className="left">Sales · GP %</td>
                  <td>{money(selNode.sales)}</td>
                  <td>{pct(freshGpPct(selNode.sales, selPurch))}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
        <ChartCard
          title={`Purchases mix · ${selLabel}`}
          subtitle="Each channel as % of sales; credits reduce purchases"
          legend={[
            { label: 'Purchases', color: C.s1, kind: 'rect' },
            { label: 'Credits', color: C.ly, kind: 'rect' },
          ]}
          height={340}
          contentHeight={hbarHeight(mixData.length)}
          table={{ head: ['Channel', '% of sales'], rows: mixData.map((m) => [m.label, pct(m.value / 100)]) }}
        >
          <HBars data={mixData} diverging labelWidth={130} format={(v) => `${v.toFixed(1)}%`} />
        </ChartCard>
      </ChartGrid>
    </>
  );
}

function effectiveTimeIsCustom(s: { time: { mode: string } | null }): boolean {
  return s.time?.mode === 'custom';
}
