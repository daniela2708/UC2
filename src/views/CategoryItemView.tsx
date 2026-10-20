import { useMemo, type ReactNode } from 'react';
import { CATS, DEPTS, ITEMS, SUBS } from '../data/products';
import { Banner, BannerStack, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { CellBar, InfoTip, StatusChip, Var } from '../components/ui';
import { C, ChartCard, ChartGrid, ItemMap, TrendLines, Waterfall, type ItemPoint } from '../components/Charts';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { actions } from '../lib/filterStore';
import { count, DASH, money, moneyCompact, moneyUnit, pct, pctChange, volume, volumeCompact, weekTick } from '../lib/format';
import {
  averageRetail,
  COST_ELEMENTS,
  grossMargin,
  grossMarginPct,
  lossPctOfSales,
  pointsDiff,
  safeDiv,
  totalLoss,
  yoyGrowth,
  type CostElement,
} from '../lib/kpis';
import { addAgg, emptyAgg, itemAggregates, purchasesTotal, trendWeeks, weeklyMargin, type Agg, type ItemAgg } from '../lib/selectors';
import { fiscalOfWeek } from '../data/calendar';
import { extremeInScope, goToExtreme, goToShrimp, P8_FY2026, shrimpStory, useScope, ViewToggles, type ViewProps } from './common';

const COST_LABEL: Record<CostElement, string> = {
  trade: 'Trade rates',
  offInvoice: 'Off-invoice',
  deals: 'Deals',
  scanbacks: 'Scan-backs',
  freight: 'Freight billed separately',
};

const COLUMNS: HierCol[] = [
  { key: 'gross', label: 'Gross Sales' },
  { key: 'net', label: 'Net Sales' },
  { key: 'vol', label: 'Volume', title: 'Units sold (ea) or pounds (lb). Never summed across units.' },
  { key: 'avgRetail', label: 'Avg Retail / Unit' },
  { key: 'netCost', label: 'Net Cost / Unit' },
  { key: 'gm', label: 'Gross Margin $' },
  { key: 'gmPct', label: 'Gross Margin %' },
  { key: 'gmLy', label: 'GM % vs LY' },
  { key: 'loss', label: 'Total Loss $' },
  { key: 'lossPct', label: 'Loss %' },
  { key: 'flag', label: 'Flag' },
];

function singleUom(a: Agg): 'ea' | 'lb' | null {
  if (a.ea > 0 && a.lb === 0) return 'ea';
  if (a.lb > 0 && a.ea === 0) return 'lb';
  return null;
}

function aggCells(a: Agg, basis: 'cost' | 'retail', flags: ReactNode): { cells: Record<string, ReactNode>; sort: Record<string, number | null> } {
  const uom = singleUom(a);
  const vol = uom ? (uom === 'ea' ? a.ea : a.lb) : null;
  const gm = grossMargin(a.net, a.cost);
  const gmPct = grossMarginPct(gm, a.net);
  const lyGmPct = grossMarginPct(grossMargin(a.lyNet, a.lyCost), a.lyNet);
  const gmLy = pointsDiff(gmPct, lyGmPct);
  const loss = totalLoss(a.loss, a.lossRetail, basis);
  const mixed = (
    <span title="Mixed units: average per unit is shown only within one unit of measure">{DASH}</span>
  );
  return {
    cells: {
      gross: money(a.gross),
      net: money(a.net),
      vol: uom ? (
        volume(vol, uom)
      ) : (
        <>
          {volume(a.ea, 'ea')}
          <span className="cell-sub">{volume(a.lb, 'lb')}</span>
        </>
      ),
      avgRetail: uom ? moneyUnit(averageRetail(a.gross, vol)) : mixed,
      netCost: uom ? moneyUnit(safeDiv(a.cost, vol)) : mixed,
      gm: money(gm),
      gmPct: <CellBar value={gmPct} max={0.7} text={pct(gmPct)} />,
      gmLy: <Var value={gmLy} />,
      loss: money(loss),
      lossPct: <CellBar value={lossPctOfSales(loss, a.gross)} max={0.12} text={pct(lossPctOfSales(loss, a.gross))} warm />,
      flag: flags,
    },
    sort: {
      label: null,
      gross: a.gross,
      net: a.net,
      vol: vol ?? a.ea + a.lb,
      avgRetail: uom ? averageRetail(a.gross, vol) : null,
      netCost: uom ? safeDiv(a.cost, vol) : null,
      gm,
      gmPct,
      gmLy,
      loss,
      lossPct: lossPctOfSales(loss, a.gross),
      flag: a.flags,
    },
  };
}

export function CategoryItemView({ openDefinitions }: ViewProps) {
  const { state, update, range, scope } = useScope();
  const aggs = useMemo(() => itemAggregates(scope, state.costBasis), [scope, state.costBasis]);
  const basis = state.lossBasis;
  const weeks = useMemo(() => trendWeeks(range), [range]);
  const weekly = useMemo(() => weeklyMargin(scope, state.costBasis, weeks), [scope, state.costBasis, weeks]);
  const depts = useMemo(() => [...new Set(scope.items.map((i) => ITEMS[i].dept))], [scope.items]);
  const productFiltered = state.cat >= 0 || state.sub >= 0 || state.item >= 0;
  const purchases = useMemo(
    () => (productFiltered ? null : purchasesTotal(scope, depts, range.startWeek, range.endWeek)),
    [productFiltered, scope, depts, range.startWeek, range.endWeek],
  );

  const { total, rows, flaggedItems, staleCount } = useMemo(() => {
    const total = emptyAgg();
    const byDept = new Map<number, Agg>();
    const byCat = new Map<number, Agg>();
    const bySub = new Map<number, Agg>();
    const items = new Map<number, ItemAgg>();
    let flaggedItems = 0;
    let staleCount = 0;
    const bump = (m: Map<number, Agg>, k: number, a: Agg) => {
      if (!m.has(k)) m.set(k, emptyAgg());
      addAgg(m.get(k)!, a);
    };
    for (const a of aggs) {
      const it = ITEMS[a.item];
      items.set(a.item, a);
      addAgg(total, a);
      bump(byDept, it.dept, a);
      bump(byCat, it.cat, a);
      bump(bySub, it.sub, a);
      if (a.flags) flaggedItems++;
      if (it.composite && it.composite.ageMonths > 6) staleCount++;
    }
    const flagsOf = (a: Agg) => (a.flags ? <span className="chip neutral">{count(a.flags)}</span> : '');
    const itemRow = (a: ItemAgg): HierRow => {
      const it = ITEMS[a.item];
      const c = aggCells(a, basis, a.flagReasons.length ? (
        <span className="flag-cell">
          {a.flagReasons.map((r) => (
            <span key={r} className={`chip ${r === 'Stale cost' ? 'amber' : 'error'}`}>
              {r}
            </span>
          ))}
        </span>
      ) : '');
      return {
        id: `i${a.item}`,
        label: (
          <>
            <span className="code-tag">{it.code}</span>
            {it.name} {it.rw && <span className="chip rw">RW</span>}
          </>
        ),
        sub: it.composite ? (
          <span className={it.composite.ageMonths > 6 ? 'amber' : undefined}>Cost last updated {it.composite.updatedLabel}</span>
        ) : undefined,
        className: undefined,
        ...c,
        drill: { label: `Review loss for ${it.name}`, onClick: () => update((s) => ({ ...actions.item(a.item)(s), tab: 'shrink' })) },
      };
    };
    const rows: HierRow[] = [...byDept.entries()].map(([d, da]) => ({
      id: `d${d}`,
      label: DEPTS[d].name,
      ...aggCells(da, basis, flagsOf(da)),
      drill: { label: `Filter to ${DEPTS[d].name}`, onClick: () => update(actions.dept(d)) },
      children: DEPTS[d].cats
        .filter((c) => byCat.has(c))
        .map((c) => ({
          id: `c${c}`,
          label: CATS[c].name,
          ...aggCells(byCat.get(c)!, basis, flagsOf(byCat.get(c)!)),
          drill: { label: `Filter to ${CATS[c].name}`, onClick: () => update(actions.cat(c)) },
          children: CATS[c].subs
            .filter((s) => bySub.has(s))
            .map((s) => ({
              id: `s${s}`,
              label: SUBS[s].name,
              ...aggCells(bySub.get(s)!, basis, flagsOf(bySub.get(s)!)),
              drill: { label: `Filter to ${SUBS[s].name}`, onClick: () => update((st) => ({ ...actions.cat(c)(st), sub: s })) },
              children: SUBS[s].items.filter((i) => items.has(i)).map((i) => itemRow(items.get(i)!)),
            })),
        })),
    }));
    return { total, rows, flaggedItems, staleCount };
  }, [aggs, basis, update]);

  const gm = grossMargin(total.net, total.cost);
  const gmPct = grossMarginPct(gm, total.net);
  const lyGm = grossMargin(total.lyNet, total.lyCost);
  const lyGmPct = grossMarginPct(lyGm, total.lyNet);
  const loss = totalLoss(total.loss, total.lossRetail, basis);
  const lossPct = lossPctOfSales(loss, total.gross);
  const ly = range.lyAvailable;
  const scopeLabel = `${describeProductScope(state)} · ${describeStoreScope(state)}`;
  const lossWord = basis === 'cost' ? 'at cost' : 'at retail';
  const flaggedWord = state.flagged === 'excl' ? 'excl. flagged' : 'incl. flagged';

  const tiles: Tile[] = [
    {
      label: 'Gross Sales',
      info: 'Sales before discounts.',
      value: moneyCompact(total.gross),
      sub: <>Before discounts{ly && <> · <Var value={yoyGrowth(total.gross, total.lyGross).pct} kind="pct" /> vs LY</>}</>,
    },
    {
      label: 'Net Sales',
      info: 'Gross Sales + discounts. Item discounts are allocated pro rata to gross sales (provisional).',
      value: moneyCompact(total.net),
      sub: <>After discounts{ly && <> · <Var value={yoyGrowth(total.net, total.lyNet).pct} kind="pct" /> vs LY</>}</>,
    },
    {
      label: 'Volume',
      info: 'Units sold (ea) and pounds (lb) for random-weight items. Never added together.',
      value: (
        <>
          {volumeCompact(total.ea, 'ea')}
          <br />
          {volumeCompact(total.lb, 'lb')}
        </>
      ),
      two: true,
      sub: 'Each and pounds shown separately',
    },
    {
      label: 'Gross Margin $',
      info: 'Net Sales − Total Net Cost at the selected cost basis.',
      value: moneyCompact(gm),
      sub: ly ? <><Var value={yoyGrowth(gm, lyGm).pct} kind="pct" /> vs same fiscal weeks LY</> : 'No last-year history',
    },
    {
      label: 'Gross Margin %',
      info: 'Σ Gross Margin ÷ Σ Net Sales. Ratio of totals.',
      value: pct(gmPct),
      sub: <>{ly && <><Var value={pointsDiff(gmPct, lyGmPct)} /> vs LY · </>}Gross Profit ÷ Net Sales · provisional</>,
    },
    {
      label: 'Purchases',
      info: 'Fresh Report total purchases for the departments in scope. Weekly and department level only.',
      value: purchases ? moneyCompact(purchases.purchases) : DASH,
      sub: purchases ? `Department level · weekly W${(range.startWeek % 52) + 1}–W${(range.endWeek % 52) + 1}` : 'Not available below department',
    },
    {
      label: 'Total Loss $',
      info: 'Known loss (KL1011), at cost by default. Flagged entries are excluded from totals by default.',
      value: moneyCompact(loss),
      sub: `Known loss ${lossWord} · ${flaggedWord}`,
    },
    {
      label: 'Loss % of sales',
      info: 'Total Loss ÷ Gross Sales.',
      value: pct(lossPct),
      sub: ly ? <><Var value={pointsDiff(lossPct, lossPctOfSales(totalLoss(total.lyLoss, total.lyLossRetail, basis), total.lyGross))} invert /> vs LY</> : 'Total Loss ÷ Gross Sales',
    },
    {
      label: 'Items flagged',
      info: 'Items with a high-loss flag, a composite cost older than 6 months, or a negative margin.',
      value: count(flaggedItems),
      sub: `of ${count(aggs.length)} items in scope`,
    },
  ];

  const shrimp = shrimpStory();
  const seafoodInScope = depts.includes(DEPTS.findIndex((d) => d.name === 'Seafood')) && range.endWeek >= P8_FY2026;
  const extreme = extremeInScope(scope);

  const latestFy = fiscalOfWeek(weeks[weeks.length - 1]).fy;
  const trendData = weekly.map((p) => ({
    x: weekTick(p.week, latestFy),
    ty: p.net > 0 ? (p.net - p.cost) / p.net : null,
    ly: p.lyNet && p.lyNet > 0 && p.lyCost !== null ? (p.lyNet - p.lyCost) / p.lyNet : null,
  }));
  const bridge = [
    { label: 'Sales', value: total.gross, kind: 'total' as const },
    { label: 'Discounts', value: total.gross - total.net, kind: 'minus' as const },
    { label: 'Cost', value: total.cost, kind: 'minus' as const },
    { label: 'Margin', value: gm ?? 0, kind: 'total' as const },
    { label: 'Loss', value: loss ?? 0, kind: 'minus' as const },
    { label: 'After loss', value: (gm ?? 0) - (loss ?? 0), kind: 'total' as const },
  ];
  const mapPoints: ItemPoint[] = aggs
    .filter((a) => a.net > 0 && a.gross > 0)
    .map((a) => {
      const l = totalLoss(a.loss, a.lossRetail, basis) ?? 0;
      return {
        id: a.item,
        name: ITEMS[a.item].name,
        x: (a.net - a.cost) / a.net,
        y: l / a.gross,
        z: a.gross,
        flagged: a.flagReasons.some((r) => r.startsWith('High loss')),
      };
    });
  const q = (arr: number[], p: number) => {
    if (!arr.length) return 0;
    const v = [...arr].sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  };
  const mapDomain = {
    x: [Math.min(0, Math.floor(q(mapPoints.map((p) => p.x), 0.01) * 20) / 20), Math.ceil(q(mapPoints.map((p) => p.x), 0.99) * 20) / 20] as [number, number],
    y: [0, Math.max(0.02, Math.ceil(q(mapPoints.map((p) => p.y), 0.98) * 50) / 50)] as [number, number],
  };

  const toggleCost = (e: CostElement) =>
    update((s) => ({ ...s, costBasis: s.costBasis.includes(e) ? s.costBasis.filter((x) => x !== e) : [...s.costBasis, e] }));

  return (
    <>
      <SectionHeading eyebrow="Item profitability" title="Category-Item Summary" question="Which items make money once cost and loss are counted?">
        {describeProductScope(state)}, {range.label}: Gross Sales <b>{moneyCompact(total.gross)}</b>, Gross Margin <b>{pct(gmPct)}</b>
        {ly && (
          <>
            {' '}(<b>{pointsDiff(gmPct, lyGmPct) !== null ? <Var value={pointsDiff(gmPct, lyGmPct)} /> : DASH}</b> vs. last year)
          </>
        )}
        , Known Loss <b>{moneyCompact(loss)}</b> (<b>{pct(lossPct)}</b> of sales).
      </SectionHeading>

      <BannerStack>
        {extreme && (
          <Banner
            lead={extreme.flagged && state.flagged === 'excl' ? 'Excluded from totals:' : 'Included in totals:'}
            kind={extreme.flagged && state.flagged === 'excl' ? 'alert' : 'danger'}
            details={{ label: 'Review in Shrink Review', onClick: () => goToExtreme(update) }}
          >
            a {moneyCompact(extreme.cost)} known loss entry ({extreme.item}, store {extreme.store}, {extreme.week}) is flagged as an entry error
            {state.flagged === 'excl' ? ' and left out of loss totals pending review.' : '. Switch to Excl. flagged to remove it from totals.'}
          </Banner>
        )}
        {staleCount > 0 && (
          <Banner lead="Stale costs:" details={{ label: 'Open PLU Cost Watch', onClick: () => update(actions.tab('plu')) }}>
            {staleCount} Deli and Bakery composite PLUs in scope have recipe costs older than 6 months, so their margins are likely overstated.
          </Banner>
        )}
        {seafoodInScope && (
          <Banner lead="Cost pressure:" details={{ label: 'Show Seafood since P8', onClick: () => goToShrimp(update) }}>
            Shrimp cost is up <b>{pct(shrimp.costChange)}</b> since {shrimp.fromLabel} with retail flat ({pctChange(shrimp.retailChange)}); Seafood GM % is <b>{pct(shrimp.gmNow)}</b> vs <b>{pct(shrimp.gmLy)}</b> for the same weeks last year.
          </Banner>
        )}
      </BannerStack>

      <ViewToggles flagged />

      <KeyFigures
        caption={`Key figures · ${scopeLabel} · ${range.fyLabel} · ${range.label}`}
        tiles={tiles}
        note={
          <>
            Net Sales, Gross Margin % and Total Loss are <b>Pending validation</b>; cost basis and volume rules are <b>Proposed</b>.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('gm-pct')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartGrid cols={3}>
        <ChartCard
          title="Gross margin % by week"
          subtitle={`This year vs same fiscal weeks last year · ${weekTick(weeks[0], latestFy)}–${weekTick(weeks[weeks.length - 1], latestFy)}`}
          legend={[
            { label: 'This year', color: C.s1 },
            { label: 'Last year', color: C.ly },
          ]}
          table={{ head: ['Week', 'GM % TY', 'GM % LY'], rows: trendData.map((d) => [String(d.x), pct(d.ty as number | null), pct(d.ly as number | null)]) }}
        >
          <TrendLines
            data={trendData}
            series={[
              { key: 'ty', label: 'This year', color: C.s1 },
              { key: 'ly', label: 'Last year', color: C.ly },
            ]}
            format={(v) => pct(v)}
            tickFormat={(v) => `${(v * 100).toFixed(1)}%`}
          />
        </ChartCard>
        <ChartCard
          title="From sales to margin after loss"
          subtitle={`Where each sales dollar goes · ${range.label}`}
          legend={[
            { label: 'Totals', color: C.s1, kind: 'rect' },
            { label: 'Reductions', color: C.s2, kind: 'rect' },
          ]}
          table={{ head: ['Step', 'Amount'], rows: bridge.map((b) => [b.label, (b.kind === 'minus' ? '−' : '') + money(b.value)]) }}
        >
          <Waterfall steps={bridge} format={(v) => moneyCompact(v)} />
        </ChartCard>
        <ChartCard
          title="Item map: margin vs loss"
          subtitle="Each bubble is an item sized by gross sales; lines mark the scope average. Top-left: review. Bottom-right: keep and promote. Click a bubble to filter."
          legend={[
            { label: 'Items', color: C.s1, kind: 'dot' },
            { label: 'Flagged for high loss', color: C.s2, kind: 'dot' },
          ]}
          table={{
            head: ['Item', 'GM %', 'Loss %', 'Gross sales'],
            rows: [...mapPoints].sort((a, b) => b.z - a.z).slice(0, 40).map((p) => [p.name, pct(p.x), pct(p.y), money(p.z)]),
          }}
        >
          <ItemMap
            points={mapPoints}
            xRef={gmPct ?? 0}
            yRef={lossPct ?? 0}
            xDomain={mapDomain.x}
            yDomain={mapDomain.y}
            onSelect={(id) => update(actions.item(id))}
            fmtX={(v) => `${(v * 100).toFixed(0)}%`}
            fmtY={(v) => `${(v * 100).toFixed(mapDomain.y[1] < 0.2 ? 1 : 0)}%`}
            fmtZ={(v) => moneyCompact(v)}
          />
        </ChartCard>
      </ChartGrid>

      <Banner kind="note">Item margin is available by day. Purchases and known loss are weekly in the source systems.</Banner>

      <section className="card table-card" aria-label="Category-item table">
        <p className="card-caption">Department › Category › Subcategory › Item · {range.label}</p>
        <div className="table-tools">
          <div className="cost-basis" role="group" aria-label="Cost includes">
            <span className="toggle-label">Cost includes</span>
            <button type="button" className="cost-chip" aria-pressed="true" disabled title="List cost is always included">
              List cost
            </button>
            {COST_ELEMENTS.map((e) => (
              <button key={e} type="button" className="cost-chip" aria-pressed={state.costBasis.includes(e)} onClick={() => toggleCost(e)}>
                {COST_LABEL[e]}
              </button>
            ))}
            <StatusChip status="Pending validation" />
            <InfoTip text="Default cost basis is list cost minus trade rates (PO cost). Each allowance switched on lowers net cost; freight billed separately adds to it. Margins recalculate immediately." />
          </div>
        </div>
        <HierTable
          key={scope.productKey}
          hierarchy="Department › Category › Subcategory › Item"
          columns={COLUMNS}
          defaultSort={{ key: 'gross', dir: 'desc' }}
          defaultExpanded={state.dept >= 0 ? [`d${state.dept}`, ...(state.cat >= 0 ? [`c${state.cat}`] : []), ...(state.sub >= 0 ? [`s${state.sub}`] : [])] : []}
          exportTitle={`Category-Item Summary ${range.label}`}
          total={{ id: 'total', label: 'Total', ...aggCells(total, basis, flaggedItems ? <span className="chip neutral">{count(flaggedItems)}</span> : '') }}
          rows={rows}
        />
      </section>
    </>
  );
}
