import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CURRENT_WEEK, fiscalOfWeek, formatDay, LAST_COMPLETE_WEEK, weekEndDay, weekStartDay } from '../data/calendar';
import { periodWeeksOf } from '../data/generate';
import { CATS, DEPTS } from '../data/products';
import { DISTRICTS, REGIONS, STORES } from '../data/stores';
import { Banner, BannerStack, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { C, ChartCard, ChartGrid, hbarHeight, HBars, rankSlice, TrendLines, type RankOrder } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { LossBasisControl } from '../components/LossBasis';
import { CellBar, InfoTip, Var } from '../components/ui';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { actions } from '../lib/filterStore';
import { DASH, money, moneyCompact, moneyUnit, pct, pts, volume, volumeCompact, weekTick } from '../lib/format';
import {
  budgetGpPct,
  CHANNEL_LABEL,
  freshGpPct,
  grossMarginRate,
  marginAfterLoss,
  sellThrough,
  lossPctOfSales,
  pointsDiff,
  PURCHASE_CHANNELS,
  safeDiv,
  totalLoss,
  totalPurchases,
  yoyGrowth,
  type MarginBase,
  type PurchaseBreakdown,
} from '../lib/kpis';
import { addBreakdown, freshStoreDays, freshStoreWeeks, storeCatLoss, trendWeeks, zeroBreakdown, type StoreWeekFresh } from '../lib/selectors';
import { lossBasisWord, lossTitle, useScope, ViewToggles, type ViewProps } from './common';

interface Node {
  sales: number;
  net: number;
  ea: number;
  lb: number;
  gEa: number;
  gLb: number;
  purchases: PurchaseBreakdown;
  budget: number;
  lySales: number;
  lyNet: number;
  lyPurchases: number;
  loss: number;
  cogs: number;
  /** Period columns (weeks of the fiscal period, or days of the week in Day mode), plus the bucket before. */
  cols: { sales: number; purchases: number }[];
}

function emptyNode(n: number): Node {
  return {
    sales: 0,
    net: 0,
    ea: 0,
    lb: 0,
    gEa: 0,
    gLb: 0,
    purchases: zeroBreakdown(),
    budget: 0,
    lySales: 0,
    lyNet: 0,
    lyPurchases: 0,
    loss: 0,
    cogs: 0,
    cols: Array.from({ length: n }, () => ({ sales: 0, purchases: 0 })),
  };
}

function addNode(into: Node, n: Node): void {
  into.sales += n.sales;
  into.net += n.net;
  into.ea += n.ea;
  into.lb += n.lb;
  into.gEa += n.gEa;
  into.gLb += n.gLb;
  addBreakdown(into.purchases, n.purchases);
  into.budget += n.budget;
  into.lySales += n.lySales;
  into.lyNet += n.lyNet;
  into.lyPurchases += n.lyPurchases;
  into.loss += n.loss;
  into.cogs += n.cogs;
  n.cols.forEach((c, i) => {
    into.cols[i].sales += c.sales;
    into.cols[i].purchases += c.purchases;
  });
}

function addCell(n: Node, c: StoreWeekFresh) {
  n.sales += c.sales;
  n.net += c.net;
  n.ea += c.ea;
  n.lb += c.lb;
  n.gEa += c.gEa;
  n.gLb += c.gLb;
  addBreakdown(n.purchases, c.purchases);
  n.budget += c.budget;
  n.cogs += c.cogs;
}

/** Average Retail Price per Unit by unit of measure; never divides by a mixed ea + lb total. */
function avgRetailCell(n: Node): { cell: ReactNode; sort: number | null } {
  const ea = safeDiv(n.gEa, n.ea);
  const lb = safeDiv(n.gLb, n.lb);
  if (n.ea > 0 && n.lb === 0) return { cell: moneyUnit(ea), sort: ea };
  if (n.lb > 0 && n.ea === 0) return { cell: moneyUnit(lb), sort: lb };
  return {
    cell: (
      <>
        {ea === null ? DASH : `${moneyUnit(ea)} / ea`}
        <span className="cell-sub">{lb === null ? DASH : `${moneyUnit(lb)} / lb`}</span>
      </>
    ),
    sort: null,
  };
}

function volCell(n: Node): ReactNode {
  if (n.lb === 0) return volume(n.ea, 'ea');
  if (n.ea === 0) return volume(n.lb, 'lb');
  return (
    <>
      {volume(n.ea, 'ea')}
      <span className="cell-sub">{volume(n.lb, 'lb')}</span>
    </>
  );
}

const purchOf = (c: StoreWeekFresh) => totalPurchases(c.purchases);

export function FreshReportView({ openDefinitions }: ViewProps) {
  const { state, update, range, scope } = useScope({ noItem: true });
  const [districtOrder, setDistrictOrder] = useState<RankOrder>('top');
  const mb: MarginBase = state.marginBase;
  const depts = useMemo(() => (state.cat >= 0 ? [CATS[state.cat].dept] : state.dept >= 0 ? [state.dept] : DEPTS.map((d) => d.idx)), [state.cat, state.dept]);
  const [selected, setSelected] = useState<string>('total');
  const [showCols, setShowCols] = useState(false);
  const daily = range.end - range.start + 1 < 7;

  // Main figures: complete weeks, or the exact days in Day mode.
  const mainBuckets = useMemo(() => {
    const out: number[] = [];
    if (daily) for (let d = range.start; d <= range.end; d++) out.push(d);
    else for (let w = range.startWeek; w <= range.endWeek; w++) out.push(w);
    return out;
  }, [daily, range.start, range.end, range.startWeek, range.endWeek]);
  // Collapsible columns: the fiscal period's weeks, or in Day mode the days of the week (each with the change vs the bucket before).
  const colBuckets = useMemo(() => {
    if (daily) {
      const ws = weekStartDay(Math.floor(range.end / 7));
      return Array.from({ length: 7 }, (_, k) => ws + k);
    }
    return periodWeeksOf(range.endWeek);
  }, [daily, range.end, range.endWeek]);

  const { total, regionNodes, districtNodes, storeNodes } = useMemo(() => {
    const lyBuckets = range.lyAvailable ? mainBuckets.map((b) => b - (daily ? 364 : 52)).filter((b) => b >= 0) : [];
    const cols = [colBuckets[0] - 1, ...colBuckets];
    const known = (b: number) => b >= 0 && (daily ? b <= range.end : b <= LAST_COMPLETE_WEEK);
    const colKnown = cols.filter(known);
    const fetch = (buckets: number[]) => (daily ? freshStoreDays(scope, depts, buckets) : freshStoreWeeks(scope, depts, buckets));
    const main = fetch(mainBuckets);
    const lyRows = lyBuckets.length ? fetch(lyBuckets) : null;
    const colRows = fetch(colKnown);
    const colIdx = new Map(colKnown.map((b, i) => [b, i]));
    const lossRows = storeCatLoss(scope);
    const lossScale = daily ? mainBuckets.length / 7 : 1;
    const storeNodes = new Map<number, Node>();
    for (const [s, row] of main) {
      const n = emptyNode(cols.length);
      for (const c of row) addCell(n, c);
      const lr = lyRows?.get(s);
      if (lr)
        for (const c of lr) {
          n.lySales += c.sales;
          n.lyNet += c.net;
          n.lyPurchases += purchOf(c);
        }
      const cr = colRows.get(s);
      cols.forEach((b, i) => {
        const k = colIdx.get(b);
        if (k === undefined || !cr) return;
        n.cols[i].sales = cr[k].sales;
        n.cols[i].purchases = purchOf(cr[k]);
      });
      const lossRow = lossRows.get(s);
      if (lossRow)
        lossRow.forEach((v, c) => {
          if (depts.includes(CATS[c].dept)) n.loss += (totalLoss(v.loss, v.lossRetail, state.lossBasis) ?? 0) * lossScale;
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
  }, [scope, depts, daily, mainBuckets, colBuckets, range.lyAvailable, range.end, state.lossBasis]);

  // Store outliers: more than 5 pts below budget over the last 4 complete weeks combined, explained by DSD well above the norm.
  const outliers = useMemo(() => {
    const last4 = [range.endWeek - 3, range.endWeek - 2, range.endWeek - 1, range.endWeek].filter((w) => w >= 0);
    const out: { store: number; dept: number; gap: number; dsd: number }[] = [];
    for (const d of depts) {
      const rows = freshStoreWeeks(scope, [d], last4);
      let chainSales = 0;
      let chainDsd = 0;
      for (const row of rows.values())
        for (const c of row) {
          chainSales += c.sales;
          chainDsd += c.purchases.dsd;
        }
      const dsdNorm = chainSales > 0 ? chainDsd / chainSales : 0;
      for (const [s, row] of rows) {
        let sales = 0;
        let purch = 0;
        let budget = 0;
        let dsd = 0;
        for (const c of row) {
          sales += c.sales;
          purch += purchOf(c);
          budget += c.budget;
          dsd += c.purchases.dsd;
        }
        const gap = sales > 0 ? (freshGpPct(sales, purch)! - budget / sales) * 100 : 0;
        if (row.length === 4 && gap < -5 && dsd / sales > dsdNorm * 1.5) out.push({ store: s, dept: d, gap, dsd: dsd / sales });
      }
    }
    return out.sort((a, b) => a.gap - b.gap);
  }, [scope, depts, range.endWeek]);

  const tWeeks = useMemo(() => trendWeeks(range), [range]);
  const trend = useMemo(() => {
    const all = [...tWeeks, ...tWeeks.map((w) => w - 52).filter((w) => w >= 0)];
    const rows = freshStoreWeeks(scope, depts, all);
    const sum = (w: number) => {
      const i = all.indexOf(w);
      if (i < 0) return null;
      let sales = 0;
      let net = 0;
      let purch = 0;
      let budget = 0;
      for (const row of rows.values()) {
        sales += row[i].sales;
        net += row[i].net;
        purch += purchOf(row[i]);
        budget += row[i].budget;
      }
      return { gp: grossMarginRate(sales - purch, sales, net, mb), budget: safeDiv(budget, sales) };
    };
    const fy = fiscalOfWeek(tWeeks[tWeeks.length - 1]).fy;
    return tWeeks.map((w) => {
      const ty = sum(w);
      const ly = w >= 52 ? sum(w - 52) : null;
      return { x: weekTick(w, fy), gp: ty?.gp ?? null, budget: ty?.budget ?? null, ly: ly?.gp ?? null };
    });
  }, [scope, depts, tWeeks, mb]);

  // Expected-rate basis: the departments in scope, weighted by their sales over the range's complete weeks.
  const expRate = useMemo(() => {
    if (state.lossRateBasis !== 'expected') return null;
    const weeks: number[] = [];
    for (let w = range.startWeek; w <= range.endWeek; w++) weeks.push(w);
    let num = 0;
    let den = 0;
    for (const d of depts) {
      let sales = 0;
      for (const row of freshStoreWeeks(scope, [d], weeks).values()) for (const c of row) sales += c.sales;
      num += sales * (state.expLoss[DEPTS[d].name] ?? 0);
      den += sales;
    }
    return den > 0 ? num / den : null;
  }, [state.lossRateBasis, state.expLoss, depts, scope, range.startWeek, range.endWeek]);
  const colLabel = (b: number) => (daily ? formatDay(b).slice(0, 5) : `W${fiscalOfWeek(b).week}`);
  const groupLabel = daily ? 'Daily Gross Margin Rate (week)' : `Weekly Gross Margin Rate (P${fiscalOfWeek(range.endWeek).period})`;
  const columns: HierCol[] = [
    { key: 'gross', label: 'Total Gross Sales', title: 'Sales prior to discounts', group: 'Sales' },
    { key: 'net', label: 'Total Net Sales', title: 'Sales after discounts', group: 'Sales' },
    { key: 'arpu', label: 'Average Retail Price per Unit', title: 'Avg. Unit Retail in the Fresh Report: SUM(Gross Sales) ÷ SUM(Volume) within one unit of measure', group: 'Sales' },
    { key: 'vol', label: 'Total Volume', title: 'Units (ea) and weight (lb) sold; never added together', group: 'Sales' },
    { key: 'gm', label: 'Gross Margin $', title: 'Fresh Report gross profit: Gross Sales − Total Purchases', group: 'Margin' },
    { key: 'gmr', label: 'Gross Margin Rate', title: 'Fresh Report: (Gross Sales − Total Purchases) ÷ Gross Sales', group: 'Margin' },
    { key: 'purch', label: 'Total Purchases · Fresh Report', title: 'Fresh Report purchases: store-level purchase cost after trade rates by channel (Whse, DSD, Packaging, Reclaim, Transfers, In transit, Donations, WC credit, Scan credit). Not the same measure as item PO spend in the Category-Item Summary.', group: 'Cost' },
    { key: 'loss', label: `Total Loss ($) · ${lossBasisWord(state.lossBasis)}`, title: lossTitle(state.lossBasis), group: 'Loss' },
    { key: 'budget', label: 'Budget GP %', title: 'Fresh Report budget, weighted by sales', group: 'Budget' },
    { key: 'vsBudget', label: 'vs Budget', title: 'Fresh gross profit rate − Budget GP %, in points', group: 'Budget' },
    { key: 'mal', label: 'Margin After Loss %', title: 'Proposed: Gross Margin Rate − loss rate (actual known loss or the expected rate)', group: 'Margin', defaultHidden: true },
    { key: 'shipU', label: 'Units shipped', title: 'Warehouse bill-out, estimated at average landed cost. Outside vendors (C&S, DSD) not included yet.', group: 'Sell-through', defaultHidden: true },
    { key: 'soldU', label: 'Units sold', group: 'Sell-through', defaultHidden: true },
    { key: 'st', label: 'Sell-through %', title: 'Units sold ÷ units shipped', group: 'Sell-through', defaultHidden: true },
    { key: 'shipV', label: 'Shipped value $', title: 'Warehouse (Whse) purchases', group: 'Sell-through', defaultHidden: true },
    { key: 'lyG', label: 'Last Year Gross Sales', group: 'YoY', defaultHidden: true },
    { key: 'yoyGp', label: `${state.idStores ? 'ID Stores YoY' : 'YoY'} Gross Sales Growth %`, group: 'YoY', defaultHidden: true },
    { key: 'lyN', label: 'Last Year Net Sales', group: 'YoY', defaultHidden: true },
    { key: 'yoyNp', label: `${state.idStores ? 'ID Stores YoY' : 'YoY'} Net Sales Growth %`, group: 'YoY', defaultHidden: true },
    ...(showCols
      ? colBuckets.map((b, i) => ({
          key: `c${i}`,
          label: colLabel(b),
          title: daily ? formatDay(b) : `${formatDay(weekStartDay(b))} – ${formatDay(weekEndDay(b))}`,
          group: 'Period' as const,
        }))
      : []),
  ];

  const nodeRow = (id: string, label: ReactNode, n: Node, children?: HierRow[], drill?: HierRow['drill']): HierRow => {
    const purch = totalPurchases(n.purchases);
    const gm = n.sales - purch;
    const gmr = grossMarginRate(gm, n.sales, n.net, mb);
    const budget = budgetGpPct(n.budget, n.sales);
    const vsB = pointsDiff(freshGpPct(n.sales, purch), budget);
    const ar = avgRetailCell(n);
    const cells: Record<string, ReactNode> = {
      gross: money(n.sales),
      net: money(n.net),
      arpu: ar.cell,
      vol: volCell(n),
      gm: money(gm),
      gmr: <CellBar value={gmr} max={0.7} text={pct(gmr)} />,
      purch: money(purch),
      loss: money(n.loss),
      budget: pct(budget),
      vsBudget: <Var value={vsB} />,
      mal: pct(marginAfterLoss(gmr, expRate ?? lossPctOfSales(n.loss, n.sales))),
      shipU: n.cogs > 0 ? volCell({ ...n, ea: (n.ea * n.purchases.whse) / n.cogs, lb: (n.lb * n.purchases.whse) / n.cogs }) : DASH,
      soldU: volCell(n),
      st: pct(sellThrough(n.cogs, n.purchases.whse)),
      shipV: money(n.purchases.whse),
      lyG: money(n.lySales),
      yoyGp: <Var value={yoyGrowth(n.sales, n.lySales).pct} kind="pct" />,
      lyN: money(n.lyNet),
      yoyNp: <Var value={yoyGrowth(n.net, n.lyNet).pct} kind="pct" />,
    };
    const sort: Record<string, number | null> = {
      gross: n.sales,
      net: n.net,
      arpu: ar.sort,
      vol: n.ea + n.lb,
      gm,
      gmr,
      purch,
      loss: n.loss,
      budget,
      vsBudget: vsB,
      mal: marginAfterLoss(gmr, expRate ?? lossPctOfSales(n.loss, n.sales)),
      shipU: n.cogs > 0 ? ((n.ea + n.lb) * n.purchases.whse) / n.cogs : null,
      soldU: n.ea + n.lb,
      st: sellThrough(n.cogs, n.purchases.whse),
      shipV: n.purchases.whse,
      lyG: n.lySales,
      yoyGp: yoyGrowth(n.sales, n.lySales).pct,
      lyN: n.lyNet,
      yoyNp: yoyGrowth(n.net, n.lyNet).pct,
    };
    if (showCols)
      colBuckets.forEach((b, i) => {
        const cur = n.cols[i + 1];
        const prev = n.cols[i];
        const g = freshGpPct(cur.sales, cur.purchases);
        const future = daily ? b > range.end : b > LAST_COMPLETE_WEEK;
        cells[`c${i}`] = future ? (
          <span className="flat">
            {DASH}
            <span className="cell-sub">{!daily && b === CURRENT_WEEK ? 'In progress' : 'Not yet'}</span>
          </span>
        ) : (
          <>
            {pct(g)}
            <span className="cell-sub">
              <Var value={pointsDiff(g, freshGpPct(prev.sales, prev.purchases))} />
            </span>
          </>
        );
        sort[`c${i}`] = future ? null : g;
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
          d.stores.filter((s) => storeNodes.has(s)).map((s) => nodeRow(`s${s}`, `Store ${STORES[s].code}`, storeNodes.get(s)!)),
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
  const gm = total.sales - purch;
  const gmr = grossMarginRate(gm, total.sales, total.net, mb);
  const lyGmr = grossMarginRate(total.lySales - total.lyPurchases, total.lySales, total.lyNet, mb);
  const budget = budgetGpPct(total.budget, total.sales);
  const productLabel = describeProductScope({ ...state, item: -1 });
  const rangeLabel = daily ? range.label : `${formatDay(weekStartDay(range.startWeek))} – ${formatDay(weekEndDay(range.endWeek))}`;
  const baseWord = mb === 'gross' ? 'Gross Sales' : 'Net Sales';
  const ly = range.lyAvailable;
  const yoySub = (ty: number, lyv: number) => (
    <>
      {state.idStores ? 'ID stores YoY' : 'YoY'} <Var value={yoyGrowth(ty, lyv).pct} kind="pct" /> · LY {moneyCompact(lyv)}
    </>
  );

  const tiles: Tile[] = [
    { label: 'Total Gross Sales', info: 'Sales prior to discounts.', value: moneyCompact(total.sales), sub: ly ? yoySub(total.sales, total.lySales) : 'Sales prior to discounts' },
    { label: 'Total Net Sales', info: 'Sales after discounts.', value: moneyCompact(total.net), sub: ly ? yoySub(total.net, total.lyNet) : 'Sales after discounts' },
    {
      label: 'Total Volume',
      info: 'Units (ea) and weight (lb) sold. Never added together.',
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
    { label: 'Gross Margin $', info: 'In the Fresh Report, gross margin is gross profit: Gross Sales − Total Purchases.', value: moneyCompact(gm), sub: 'Sales − Purchases (Fresh method)' },
    {
      label: 'Gross Margin Rate',
      info: `Fresh Report gross profit ÷ ${baseWord}.`,
      value: pct(gmr),
      sub: (
        <>
          {ly && (
            <>
              <Var value={pointsDiff(gmr, lyGmr)} /> vs LY ·{' '}
            </>
          )}
          budget {pct(budget)}
        </>
      ),
    },
    {
      label: 'Total Purchases',
      info: 'Total purchase cost after trade rates: Whse + DSD + Packaging + Reclaim + Transfers + In transit + Donations + WC credit + Scan credit.',
      value: moneyCompact(purch),
      sub: 'Fresh Report purchases · C&S cases not included',
    },
    {
      label: 'Total Loss ($)',
      info: `${lossTitle(state.lossBasis)} Likely entry errors are excluded by default.`,
      value: moneyCompact(total.loss),
      sub: `${pct(lossPctOfSales(total.loss, total.sales))} of sales · ${lossBasisWord(state.lossBasis)}${daily ? ' · weekly loss prorated' : ''}`,
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
          { label: 'Gross Margin Rate', value: pct(g) },
          { label: 'Budget GP %', value: pct(b) },
          { label: 'vs budget', value: pts(v) },
        ],
      };
    });
  const districtBars = rankSlice(districtGaps, (d) => d.value, districtOrder);

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
        {productLabel}, {rangeLabel}: Total Gross Sales <b>{moneyCompact(total.sales)}</b>, Total Purchases <b>{moneyCompact(purch)}</b>, Gross Margin Rate{' '}
        <b>{pct(gmr)}</b> (
        <b>
          <Var value={pointsDiff(freshGpPct(total.sales, purch), budget)} />
        </b>{' '}
        vs. budget
        {ly && (
          <>
            ,{' '}
            <b>
              <Var value={pointsDiff(gmr, lyGmr)} />
            </b>{' '}
            vs. last year
          </>
        )}
        ).
      </SectionHeading>

      <BannerStack>
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
              store {st.code} ({st.district}) {DEPTS[o.dept].name} Gross Margin Rate is <b>{Math.abs(o.gap).toFixed(1)} pts below budget</b> over the last 4 weeks
              combined, with DSD purchases at <b>{pct(o.dsd)}</b> of sales.
            </Banner>
          );
        })}
        <Banner lead="Known gap:" details={{ label: 'Details', onClick: () => openDefinitions('total-purchases') }}>
          cases shipped through outside vendors such as C&S, and DSD tracked by email and Excel, are not fully in the source systems.
        </Banner>
      </BannerStack>

      <ViewToggles loss margin />

      <KeyFigures
        caption={`Key figures · ${productLabel} · ${describeStoreScope(state)} · ${range.fyLabel} · ${rangeLabel}`}
        tiles={tiles}
        note={
          <>
            Gross Margin here is the Fresh Report gross profit (Sales − Purchases), not item-level margin. Purchases and budget are <b>Draft</b>.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('fresh-gm')}>
              See definitions
            </button>
          </>
        }
      />

      {daily && (
        <Banner kind="note">
          Daily gross profit swings because purchases do not line up with sales: deliveries arrive 2–3 times a week. Read it by week or period to date.
        </Banner>
      )}

      <ChartGrid cols={2}>
        <ChartCard
          title="Gross Margin Rate by week"
          subtitle={`${productLabel} · Fresh method on ${baseWord} vs budget and last year · ${trend[0]?.x ?? ''}–${trend[trend.length - 1]?.x ?? ''}`}
          legend={[
            { label: 'This year', color: C.s1 },
            { label: 'Budget GP %', color: C.s2 },
            { label: 'Last year', color: C.ly },
          ]}
          table={{ head: ['Week', 'Gross Margin Rate', 'Budget GP %', 'LY'], rows: trend.map((t) => [t.x, pct(t.gp), pct(t.budget), pct(t.ly)]) }}
        >
          <TrendLines
            data={trend}
            series={[
              { key: 'gp', label: 'This year', color: C.s1 },
              { key: 'budget', label: 'Budget GP %', color: C.s2 },
              { key: 'ly', label: 'Last year', color: C.ly },
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
          subtitle={`Gross Margin Rate minus Budget GP %, ${rangeLabel} · ${districtOrder === 'top' ? 'highest first' : 'lowest first'} · click a district to filter`}
          height={340}
          contentHeight={hbarHeight(districtBars.length)}
          rank={{ order: districtOrder, onChange: setDistrictOrder }}
          table={{ head: ['District', 'Gross Margin Rate', 'Budget GP %', 'vs Budget'], rows: districtBars.map((d) => [d.label, pct(d.gp), pct(d.budget), pts(d.value)]) }}
        >
          <HBars
            data={districtBars}
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

      <section className="card table-card" aria-label="Fresh Report table">
        <p className="card-caption">Region › District › Store Number · {rangeLabel}</p>
        <HierTable
          tools={
            <>
          <button type="button" className="chart-view-btn" aria-expanded={showCols} onClick={() => setShowCols((v) => !v)}>
            {showCols ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            {groupLabel}
          </button>
          <InfoTip text="Gross Margin Rate for each week of the fiscal period (each day of the week in Day mode), with the change in points under each value." />
          <span className="filter-spacer" />
          <LossBasisControl />
            </>
          }
          hierarchy="Region › District › Store Number"
          columns={columns}
          defaultSort={{ key: 'label', dir: 'asc' }}
          defaultExpanded={state.districts.length ? REGIONS.map((r) => `r${r}`).concat(state.districts.map((d) => `d${d}`)) : []}
          total={nodeRow('total', 'Total', total)}
          rows={rows}
          key={`${scope.storeKey.length}-${state.districts.join()}`}
          exportTitle={`Fresh Report ${rangeLabel}`}
          tableId="fresh"
          presets={[
            { label: 'Budget focus', keys: ['gross', 'gmr', 'purch', 'budget', 'vsBudget'] },
            { label: 'Loss focus', keys: ['gross', 'gmr', 'loss', 'mal'] },
          ]}
        />
        <p className="card-caption" style={{ marginTop: 10 }}>
          Select a row to see its purchases breakdown.
        </p>
      </section>

      <ChartGrid cols={2}>
        <section className="card side-card" aria-label="Purchases breakdown">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Purchases breakdown · {selLabel}</h3>
              <p className="side-sub">
                {productLabel} · {rangeLabel} · Fresh Report channels
              </p>
            </div>
            {selNode && (
              <ExportButton
                fileName={`Purchases breakdown ${selLabel}`}
                getSheet={() => ({
                  title: `Purchases breakdown · ${selLabel}`,
                  subtitle: `${productLabel} · ${rangeLabel}`,
                  head: ['Channel', '$', '% of sales'],
                  rows: [
                    ...PURCHASE_CHANNELS.map((ch) => [CHANNEL_LABEL[ch], Math.round(selNode.purchases[ch] * 100) / 100, pct(safeDiv(selNode.purchases[ch], selNode.sales))]),
                    ['Outside vendors (C&S): not in source', null, null],
                    ['Total Purchases', Math.round(selPurch * 100) / 100, pct(safeDiv(selPurch, selNode.sales))],
                    ['Total Gross Sales', Math.round(selNode.sales * 100) / 100, null],
                    ['Gross Margin Rate', null, pct(freshGpPct(selNode.sales, selPurch))],
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
                    Outside vendors (C&S): not in source{' '}
                    <InfoTip text="Cases shipped by outside vendors such as C&S are tracked by email and Excel, so they are missing from purchases and gross margin is overstated by their amount." />
                  </td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                </tr>
                <tr className="total">
                  <td className="left">Total Purchases</td>
                  <td>{money(selPurch)}</td>
                  <td>{pct(safeDiv(selPurch, selNode.sales))}</td>
                </tr>
                <tr className="total">
                  <td className="left">Total Gross Sales · Gross Margin Rate</td>
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
