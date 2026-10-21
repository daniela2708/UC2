import { useMemo, useState, type ReactNode } from 'react';
import { CATS, DEPTS, ITEMS, SUBS } from '../data/products';
import { Banner, BannerStack, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { CellBar, FlagCell, InfoTip, Segmented, StatusChip, Var } from '../components/ui';
import { C, ChartCard, ChartGrid, ItemMap, TrendLines, Waterfall, type ItemPoint } from '../components/Charts';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { actions } from '../lib/filterStore';
import { DASH, money, moneyCompact, moneyUnit, pct, pctChange, volume, volumeCompact, weekTick } from '../lib/format';
import {
  COST_ELEMENTS,
  grossMargin,
  grossMarginRate,
  lossPctOfSales,
  pointsDiff,
  safeDiv,
  totalLoss,
  yoyGrowth,
  type CostElement,
  marginAfterLoss,
  purchaseCostPerUnitPurchased,
  sellThrough,
  type LossBasis,
  type MarginBase,
} from '../lib/kpis';
import { addAgg, emptyAgg, findFlags, isEntryError, itemAggregates, itemStores, trendWeeks, weeklyMargin, type Agg, type ItemAgg } from '../lib/selectors';
import { belowTarget, catBand, deptBand, type TargetBand } from '../data/targets';
import { STORES } from '../data/stores';
import { LAST_COMPLETE_WEEK } from '../data/calendar';
import { RETAIL_LOSS_FACTOR } from '../data/generate';
import { SimulateButton } from '../components/Simulator';
import { FlagRulesButton } from '../components/FlagRules';
import { ExportButton } from '../components/ExportButton';
import { LossBasisControl } from '../components/LossBasis';
import { fiscalOfWeek } from '../data/calendar';
import { extremeInScope, goToExtreme, goToShrimp, lossBasisWord, lossTitle, P8_FY2026, shrimpStory, useScope, ViewToggles, type ViewProps } from './common';

const COST_LABEL: Record<CostElement, string> = {
  trade: 'Trade rates',
  offInvoice: 'Off-invoice',
  deals: 'Deals',
  scanbacks: 'Scan-backs',
  freight: 'Freight billed separately',
};

function itemColumns(idStores: boolean, basis: LossBasis): HierCol[] {
  const yoy = idStores ? 'ID Stores YoY' : 'YoY';
  return [
    { key: 'gross', label: 'Total Gross Sales', title: 'Sales prior to discounts', group: 'Sales' },
    { key: 'net', label: 'Total Net Sales', title: 'Sales after discounts', group: 'Sales' },
    { key: 'vol', label: 'Total Volume', title: 'Units (ea) or weight (lb) sold. Never summed across units.', group: 'Sales' },
    { key: 'nspu', label: 'Net Sales per Unit', title: 'SUM(Net Sales) ÷ SUM(Volume), within one unit of measure', group: 'Sales' },
    { key: 'arpu', label: 'Average Retail Price per Unit', title: 'SUM(Gross Sales) ÷ SUM(Volume)', group: 'Sales', defaultHidden: true },
    { key: 'gm', label: 'Gross Margin $', title: 'Net Sales − Total Net Cost', group: 'Margin' },
    { key: 'gmr', label: 'Gross Margin Rate', title: 'SUM(Gross Margin) ÷ SUM(Gross Sales); shaded band = target (Proposed)', group: 'Margin' },
    { key: 'purch', label: 'Total Purchases', title: 'Purchase cost after trade rates (merchandise channels, allocated to items)', group: 'Cost' },
    { key: 'pcpu', label: 'Purchase Cost per Unit', title: 'SUM(Total Purchases) ÷ SUM(Volume)', group: 'Cost' },
    { key: 'po', label: 'PO Cost / Unit', title: 'Purchase order cost per unit (landed), weighted by units sold', group: 'Cost' },
    { key: 'tnc', label: 'Total Net Cost', title: 'Cost of units sold under the selected cost basis', group: 'Cost' },
    { key: 'ncu', label: 'Net Cost / Unit', title: 'Total Net Cost ÷ Total Volume', group: 'Cost' },
    { key: 'loss', label: `Total Loss ($) · ${lossBasisWord(basis)}`, title: lossTitle(basis), group: 'Loss' },
    { key: 'lossU', label: 'Total Loss (Units)', title: 'Known loss in units or lb', group: 'Loss' },
    { key: 'flag', label: 'High Loss Flag', title: 'Item-store-weeks with known loss above $1,000 (workbook); reason labels are proposed', group: 'Loss' },
    { key: 'pcpuP', label: 'Purchase Cost per Unit Purchased', title: 'Proposed: Total Purchases ÷ units purchased', group: 'Cost', defaultHidden: true },
    { key: 'rel', label: 'Cost reliability', title: 'UPC: average cost is reliable. PLU and random weight: under review.', group: 'Cost', defaultHidden: true, left: true },
    { key: 'mal', label: 'Margin After Loss %', title: 'Proposed: Gross Margin Rate − loss rate (actual known loss or the expected rate)', group: 'Margin', defaultHidden: true },
    { key: 'gmLy', label: 'GM Rate vs LY', title: 'Gross Margin Rate − same fiscal weeks last year', group: 'Margin', defaultHidden: true },
    { key: 'shipU', label: 'Units shipped', title: 'Warehouse bill-out. Outside vendors (C&S, DSD) not included yet.', group: 'Sell-through', defaultHidden: true },
    { key: 'soldU', label: 'Units sold', group: 'Sell-through', defaultHidden: true },
    { key: 'st', label: 'Sell-through %', title: 'Units sold ÷ units shipped', group: 'Sell-through', defaultHidden: true },
    { key: 'shipV', label: 'Shipped value $', title: 'Warehouse bill-out value', group: 'Sell-through', defaultHidden: true },
    { key: 'lyG', label: 'Last Year Gross Sales', group: 'YoY', defaultHidden: true },
    { key: 'yoyG', label: `${yoy} Gross Sales Growth $`, group: 'YoY', defaultHidden: true },
    { key: 'yoyGp', label: `${yoy} Gross Sales Growth %`, group: 'YoY', defaultHidden: true },
    { key: 'lyN', label: 'Last Year Net Sales', group: 'YoY', defaultHidden: true },
    { key: 'yoyN', label: `${yoy} Net Sales Growth $`, group: 'YoY', defaultHidden: true },
    { key: 'yoyNp', label: `${yoy} Net Sales Growth %`, group: 'YoY', defaultHidden: true },
  ];
}

function singleUom(a: Agg): 'ea' | 'lb' | null {
  if (a.ea > 0 && a.lb === 0) return 'ea';
  if (a.lb > 0 && a.ea === 0) return 'lb';
  return null;
}

/** Per-unit value within one unit of measure; mixed scopes show one line per unit, "—" where a unit has no volume. */
function perUnit(a: Agg, numEa: number, numLb: number): { cell: ReactNode; sort: number | null } {
  const uom = singleUom(a);
  if (uom) {
    const v = uom === 'ea' ? safeDiv(numEa, a.ea) : safeDiv(numLb, a.lb);
    return { cell: moneyUnit(v), sort: v };
  }
  const ea = safeDiv(numEa, a.ea);
  const lb = safeDiv(numLb, a.lb);
  return {
    cell: (
      <span title="Mixed units: one value per unit of measure">
        {ea === null ? DASH : `${moneyUnit(ea)} / ea`}
        <span className="cell-sub">{lb === null ? DASH : `${moneyUnit(lb)} / lb`}</span>
      </span>
    ),
    sort: null,
  };
}

function twoVolumes(ea: number, lb: number, uom: 'ea' | 'lb' | null): ReactNode {
  if (uom === 'ea') return volume(ea, 'ea');
  if (uom === 'lb') return volume(lb, 'lb');
  return (
    <>
      {volume(ea, 'ea')}
      <span className="cell-sub">{volume(lb, 'lb')}</span>
    </>
  );
}

interface CellOpts {
  basis: 'cost' | 'retail';
  marginBase: MarginBase;
  /** Loss rate used for Margin After Loss: null = actual known loss ÷ sales. */
  expectedLoss: number | null;
  reliability?: string;
}

function signedMoney(v: number | null): string {
  if (v === null) return DASH;
  return `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;
}

function aggCells(
  a: Agg,
  o: CellOpts,
  flags: ReactNode,
  band?: TargetBand,
): { cells: Record<string, ReactNode>; sort: Record<string, number | string | null> } {
  const uom = singleUom(a);
  const gm = grossMargin(a.net, a.cost);
  const gmr = grossMarginRate(gm, a.gross, a.net, o.marginBase);
  const lyGmr = grossMarginRate(grossMargin(a.lyNet, a.lyCost), a.lyGross, a.lyNet, o.marginBase);
  const loss = totalLoss(a.loss, a.lossRetail, o.basis);
  const lossRate = o.expectedLoss ?? lossPctOfSales(loss, a.gross);
  const mal = marginAfterLoss(gmr, lossRate);
  const nspu = perUnit(a, a.netEa, a.netLb);
  const arpu = perUnit(a, a.grossEa, a.grossLb);
  const pcpu = perUnit(a, a.purchEa, a.purchLb);
  const pcpuP = (() => {
    if (uom) {
      const v = uom === 'ea' ? purchaseCostPerUnitPurchased(a.purchEa, a.purchUnitsEa) : purchaseCostPerUnitPurchased(a.purchLb, a.purchUnitsLb);
      return { cell: moneyUnit(v), sort: v };
    }
    return { cell: DASH as ReactNode, sort: null };
  })();
  const po = perUnit(a, a.poEa, a.poLb);
  const ncu = perUnit(a, a.costEa, a.costLb);
  const st = sellThrough(a.ea + a.lb, a.shipEa + a.shipLb);
  const yg = yoyGrowth(a.gross, a.lyGross);
  const yn = yoyGrowth(a.net, a.lyNet);
  return {
    cells: {
      gross: money(a.gross),
      net: money(a.net),
      vol: twoVolumes(a.ea, a.lb, uom),
      nspu: nspu.cell,
      arpu: arpu.cell,
      gm: money(gm),
      gmr: <CellBar value={gmr} max={0.75} text={pct(gmr)} band={band} />,
      purch: money(a.purch),
      pcpu: pcpu.cell,
      pcpuP: pcpuP.cell,
      po: po.cell,
      tnc: money(a.cost),
      ncu: ncu.cell,
      rel: o.reliability ?? '',
      loss: money(loss),
      lossU: twoVolumes(a.lossUnitsEa, a.lossUnitsLb, uom),
      flag: flags,
      mal: pct(mal),
      gmLy: <Var value={pointsDiff(gmr, lyGmr)} />,
      shipU: twoVolumes(a.shipEa, a.shipLb, uom),
      soldU: twoVolumes(a.ea, a.lb, uom),
      st: uom ? pct(st) : <span title="Mixed units: sell-through is shown within one unit of measure">{pct(st)}</span>,
      shipV: money(a.shipVal),
      lyG: money(a.lyGross),
      yoyG: signedMoney(yg.abs),
      yoyGp: <Var value={yg.pct} kind="pct" />,
      lyN: money(a.lyNet),
      yoyN: signedMoney(yn.abs),
      yoyNp: <Var value={yn.pct} kind="pct" />,
    },
    sort: {
      label: null,
      gross: a.gross,
      net: a.net,
      vol: uom ? (uom === 'ea' ? a.ea : a.lb) : a.ea + a.lb,
      nspu: nspu.sort,
      arpu: arpu.sort,
      gm,
      gmr,
      purch: a.purch,
      pcpu: pcpu.sort,
      pcpuP: pcpuP.sort,
      po: po.sort,
      tnc: a.cost,
      ncu: ncu.sort,
      rel: o.reliability ?? null,
      loss,
      lossU: a.lossUnitsEa + a.lossUnitsLb,
      flag: a.highFlags,
      mal,
      gmLy: pointsDiff(gmr, lyGmr),
      shipU: a.shipEa + a.shipLb,
      soldU: a.ea + a.lb,
      st,
      shipV: a.shipVal,
      lyG: a.lyGross,
      yoyG: yg.abs,
      yoyGp: yg.pct,
      lyN: a.lyNet,
      yoyN: yn.abs,
      yoyNp: yn.pct,
    },
  };
}

export function CategoryItemView({ openDefinitions }: ViewProps) {
  const { state, update, range, scope } = useScope();
  const aggs = useMemo(() => itemAggregates(scope, state.costBasis, state.costSource), [scope, state.costBasis, state.costSource]);
  const basis = state.lossBasis;
  const mb = state.marginBase;
  const weeks = useMemo(() => trendWeeks(range), [range]);
  const weekly = useMemo(() => weeklyMargin(scope, state.costBasis, weeks, state.costSource), [scope, state.costBasis, weeks, state.costSource]);
  const depts = useMemo(() => [...new Set(scope.items.map((i) => ITEMS[i].dept))], [scope.items]);
  const [belowOnly, setBelowOnly] = useState(false);
  const [drillItem, setDrillItem] = useState<number | null>(null);
  const shown = useMemo(
    () =>
      belowOnly
        ? aggs.filter((a) => belowTarget(grossMarginRate(a.net - a.cost, a.gross, a.net, mb), catBand(ITEMS[a.item].cat)))
        : aggs,
    [aggs, belowOnly, mb],
  );
  const drillRows = useMemo(() => (drillItem !== null && scope.itemMask[drillItem] ? itemStores(scope, drillItem) : []), [drillItem, scope]);

  const cellOpts: CellOpts = { basis, marginBase: mb, expectedLoss: null };
  const expFor = (d: number) => (state.lossRateBasis === 'expected' ? state.expLoss[DEPTS[d].name] ?? null : null);
  const { total, rows, staleCount, totalExp } = useMemo(() => {
    const total = emptyAgg();
    const byDept = new Map<number, Agg>();
    const byCat = new Map<number, Agg>();
    const bySub = new Map<number, Agg>();
    const items = new Map<number, ItemAgg>();
    let staleCount = 0;
    const bump = (m: Map<number, Agg>, k: number, a: Agg) => {
      if (!m.has(k)) m.set(k, emptyAgg());
      addAgg(m.get(k)!, a);
    };
    for (const a of shown) {
      const it = ITEMS[a.item];
      items.set(a.item, a);
      addAgg(total, a);
      bump(byDept, it.dept, a);
      bump(byCat, it.cat, a);
      bump(bySub, it.sub, a);
      if (it.composite && it.composite.ageMonths > 6) staleCount++;
    }
    const flagsOf = (a: Agg) => (a.highFlags ? <FlagCell flags={a.highFlags} errors={a.errFlags} /> : '');
    const itemRow = (a: ItemAgg): HierRow => {
      const it = ITEMS[a.item];
      const band = catBand(it.cat);
      const below = belowTarget(grossMarginRate(a.net - a.cost, a.gross, a.net, mb), band);
      const reasons = below ? [...a.flagReasons, 'Below target'] : a.flagReasons;
      const c = aggCells(
        a,
        { ...cellOpts, expectedLoss: expFor(it.dept), reliability: it.costType === 'UPC' ? 'Reliable (average cost)' : 'Under review' },
        reasons.length || a.highFlags ? (
          <FlagCell
            flags={a.highFlags}
            errors={a.errFlags}
            extra={reasons.map((r) => (
              <span key={r} className={`chip ${r === 'Negative margin' ? 'error' : r === 'Below target' ? 'neutral' : 'amber'}`}>
                {r}
              </span>
            ))}
          />
        ) : (
          ''
        ),
        band,
      );
      return {
        id: `i${a.item}`,
        label: (
          <>
            <span className="code-tag">{it.code}</span>
            {it.name} <span className={`chip ${it.costType === 'UPC' ? 'neutral' : 'rw'}`}>{it.costType === 'RW' ? 'RW' : it.costType}</span>
          </>
        ),
        sub: it.composite ? (
          <span className={it.composite.ageMonths > 6 ? 'amber' : undefined}>Cost last updated {it.composite.updatedLabel}</span>
        ) : undefined,
        ...c,
        extra: <SimulateButton item={a.item} />,
        onSelect: () => setDrillItem((x) => (x === a.item ? null : a.item)),
        selected: drillItem === a.item,
        drill: { label: `Open ${it.name} in Item Cost Over Time`, onClick: () => update((s) => ({ ...s, icItem: a.item, tab: 'itemcost' })) },
      };
    };
    const rows: HierRow[] = [...byDept.entries()].map(([d, da]) => ({
      id: `d${d}`,
      label: DEPTS[d].name,
      ...aggCells(da, { ...cellOpts, expectedLoss: expFor(d) }, flagsOf(da), deptBand(d)),
      drill: { label: `Filter to ${DEPTS[d].name}`, onClick: () => update(actions.dept(d)) },
      children: DEPTS[d].cats
        .filter((c) => byCat.has(c))
        .map((c) => ({
          id: `c${c}`,
          label: CATS[c].name,
          ...aggCells(byCat.get(c)!, { ...cellOpts, expectedLoss: expFor(d) }, flagsOf(byCat.get(c)!), catBand(c)),
          drill: { label: `Filter to ${CATS[c].name}`, onClick: () => update(actions.cat(c)) },
          children: CATS[c].subs
            .filter((s) => bySub.has(s))
            .map((s) => ({
              id: `s${s}`,
              label: SUBS[s].name,
              ...aggCells(bySub.get(s)!, { ...cellOpts, expectedLoss: expFor(d) }, flagsOf(bySub.get(s)!), catBand(c)),
              drill: { label: `Filter to ${SUBS[s].name}`, onClick: () => update((st) => ({ ...actions.cat(c)(st), sub: s })) },
              children: SUBS[s].items.filter((i) => items.has(i)).map((i) => itemRow(items.get(i)!)),
            })),
        })),
    }));
    // Expected-rate basis: the total weights each department's rate by its gross sales.
    let expNum = 0;
    for (const [d, da] of byDept) expNum += da.gross * (state.expLoss[DEPTS[d].name] ?? 0);
    const totalExp = state.lossRateBasis === 'expected' && total.gross > 0 ? expNum / total.gross : null;
    return { total, rows, staleCount, totalExp };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cellOpts and expFor derive from basis, mb and the loss-rate state listed here
  }, [shown, basis, mb, update, drillItem, state.lossRateBasis, state.expLoss]);

  const gm = grossMargin(total.net, total.cost);
  const gmr = grossMarginRate(gm, total.gross, total.net, mb);
  const altGmr = grossMarginRate(grossMargin(total.net, total.costAlt), total.gross, total.net, mb);
  const lyGm = grossMargin(total.lyNet, total.lyCost);
  const lyGmr = grossMarginRate(lyGm, total.lyGross, total.lyNet, mb);
  const loss = totalLoss(total.loss, total.lossRetail, basis);
  const lossPct = lossPctOfSales(loss, total.gross);
  // Entry errors in scope, to show Total Loss with and without them side by side.
  const errLoss = useMemo(() => {
    let v = 0;
    for (const f of findFlags(scope, Math.min(range.startWeek, LAST_COMPLETE_WEEK), Math.min(range.endWeek, LAST_COMPLETE_WEEK)))
      if (isEntryError(f)) v += basis === 'cost' ? f.cost : f.cost * RETAIL_LOSS_FACTOR[ITEMS[f.item].dept];
    return v;
  }, [scope, range.startWeek, range.endWeek, basis]);
  const lossExcl = state.flagged === 'excl' ? loss ?? 0 : (loss ?? 0) - errLoss;
  const lossIncl = state.flagged === 'excl' ? (loss ?? 0) + errLoss : loss ?? 0;
  const ly = range.lyAvailable;
  const idWord = state.idStores ? 'ID stores YoY' : 'YoY';
  const scopeLabel = `${describeProductScope(state)} · ${describeStoreScope(state)}`;
  const lossWord = lossBasisWord(basis);
  const baseWord = mb === 'gross' ? 'Gross Sales' : 'Net Sales';
  const yoy = (ty: number, lyv: number) => {
    const g = yoyGrowth(ty, lyv);
    return (
      <>
        {idWord} <Var value={g.pct} kind="pct" /> ({g.abs === null ? '—' : `${g.abs >= 0 ? '+' : '−'}${moneyCompact(Math.abs(g.abs))}`}) · LY {moneyCompact(lyv)}
      </>
    );
  };

  const tiles: Tile[] = [
    { label: 'Total Gross Sales', info: 'Sales prior to discounts.', value: moneyCompact(total.gross), sub: ly ? yoy(total.gross, total.lyGross) : 'No last-year history' },
    { label: 'Total Net Sales', info: 'Sales after discounts.', value: moneyCompact(total.net), sub: ly ? yoy(total.net, total.lyNet) : 'No last-year history' },
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
    { label: 'Gross Margin $', info: 'Net Sales − Total Net Cost at the selected cost basis.', value: moneyCompact(gm), sub: ly ? <><Var value={yoyGrowth(gm, lyGm).pct} kind="pct" /> vs same fiscal weeks LY</> : 'No last-year history' },
    {
      label: 'Gross Margin Rate',
      info: `SUM(Gross Margin) ÷ SUM(${baseWord}). Ratio of totals.`,
      value: pct(gmr),
      sub: <>{ly && <><Var value={pointsDiff(gmr, lyGmr)} /> vs LY · </>}on {baseWord}</>,
    },
    {
      label: 'Total Purchases',
      info: 'Purchase cost after trade rates: merchandise channels (Whse, DSD, Reclaim, Transfers, In transit) allocated to items by cost of goods plus loss.',
      value: moneyCompact(total.purch),
      sub: `Merchandise · weekly W${(range.startWeek % 52) + 1}–W${(range.endWeek % 52) + 1}`,
    },
    {
      label: 'Total Loss ($)',
      info: `${lossTitle(basis, 'Known loss (KL1011 Dept Known Loss by Item)')} Likely entry errors are excluded by default.`,
      value: moneyCompact(lossIncl),
      sub: (
        <>
          excl. errors <b>{moneyCompact(lossExcl)}</b> · {pct(lossPctOfSales(lossExcl, total.gross))} of sales · {lossWord}
        </>
      ),
    },
  ];

  const shrimp = shrimpStory();
  const seafoodInScope = depts.includes(DEPTS.findIndex((d) => d.name === 'Seafood')) && range.endWeek >= P8_FY2026;
  const extreme = extremeInScope(scope);

  const latestFy = fiscalOfWeek(weeks[weeks.length - 1]).fy;
  const trendData = weekly.map((p) => ({
    x: weekTick(p.week, latestFy),
    ty: grossMarginRate(p.net - p.cost, p.gross, p.net, mb),
    ly: p.lyNet !== null && p.lyCost !== null ? grossMarginRate(p.lyNet - p.lyCost, p.lyGross, p.lyNet, mb) : null,
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
        x: grossMarginRate(a.net - a.cost, a.gross, a.net, mb) ?? 0,
        y: l / a.gross,
        z: a.gross,
        flagged: a.highFlags > 0,
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
        {describeProductScope(state)}, {range.label}: Total Gross Sales <b>{moneyCompact(total.gross)}</b>, Gross Margin Rate <b>{pct(gmr)}</b>
        {ly && (
          <>
            {' '}(<b>{pointsDiff(gmr, lyGmr) !== null ? <Var value={pointsDiff(gmr, lyGmr)} /> : DASH}</b> vs. last year)
          </>
        )}
        , Total Purchases <b>{moneyCompact(total.purch)}</b>, Total Loss <b>{moneyCompact(loss)}</b> (<b>{pct(lossPct)}</b> of sales).
      </SectionHeading>

      <BannerStack>
        {extreme && (
          <Banner
            lead={extreme.flagged && state.flagged === 'excl' ? 'Excluded from totals:' : 'Included in totals:'}
            kind={extreme.flagged && state.flagged === 'excl' ? 'alert' : 'danger'}
            details={{ label: 'Review in Known Loss Report', onClick: () => goToExtreme(update) }}
          >
            a {moneyCompact(extreme.cost)} known loss entry ({extreme.item}, store {extreme.store}, {extreme.week}) is flagged as an entry error
            {state.flagged === 'excl' ? ' and left out of loss totals pending review.' : '. Switch to Excl. flagged to remove it from totals.'}
          </Banner>
        )}
        {staleCount > 0 && (
          <Banner lead="Stale costs:" details={{ label: 'Open Cost Watch', onClick: () => update(actions.tab('cost')) }}>
            {staleCount} Deli and Bakery composite PLUs in scope have recipe costs older than 6 months, so their margins are likely overstated.
          </Banner>
        )}
        {seafoodInScope && (
          <Banner lead="Cost pressure:" details={{ label: 'Show Seafood since P8', onClick: () => goToShrimp(update) }}>
            Shrimp cost is up <b>{pct(shrimp.costChange)}</b> since {shrimp.fromLabel} with retail flat ({pctChange(shrimp.retailChange)}); Seafood gross margin is <b>{pct(shrimp.gmNow)}</b> vs <b>{pct(shrimp.gmLy)}</b> for the same weeks last year.
          </Banner>
        )}
      </BannerStack>

      <ViewToggles loss flagged margin>
        <span className="toggle-group">
          <span className="toggle-label">Cost source</span>
          <Segmented<'po' | 'hq'>
            small
            label="Cost source for PLU and random-weight items"
            value={state.costSource}
            onChange={(v) => update((s) => ({ ...s, costSource: v }))}
            options={[
              { value: 'po', label: 'PO (real-time)' },
              { value: 'hq', label: 'HQ (current)' },
            ]}
          />
          <StatusChip status="Pending validation" />
          <InfoTip text="PLU and random-weight items: PO = real-time cost from purchase orders (Biceps), freight included; HQ = the default cost in HQ / Retalix. UPC items always use the HQ average cost, which already works. Biceps access is an open question." />
          <span className="flip-delta">
            On {state.costSource === 'po' ? 'HQ' : 'PO'} cost: {pct(altGmr)} (<Var value={pointsDiff(altGmr, gmr)} />)
          </span>
        </span>
      </ViewToggles>

      <KeyFigures
        caption={`Key figures · ${scopeLabel} · ${range.fyLabel} · ${range.label}`}
        tiles={tiles}
        note={
          <>
            Total Net Sales, Gross Margin Rate and Total Loss are <b>Pending validation</b>; cost basis and the item purchases allocation are <b>Proposed</b>.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('gm-rate')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartGrid cols={3}>
        <ChartCard
          title="Gross Margin Rate by week"
          subtitle={`On ${baseWord} · this year vs same fiscal weeks last year · ${weekTick(weeks[0], latestFy)}–${weekTick(weeks[weeks.length - 1], latestFy)}`}
          legend={[
            { label: 'This year', color: C.s1 },
            { label: 'Last year', color: C.ly },
          ]}
          table={{ head: ['Week', 'GM Rate TY', 'GM Rate LY'], rows: trendData.map((d) => [String(d.x), pct(d.ty), pct(d.ly)]) }}
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
          subtitle={`Each bubble is an item sized by gross sales; lines mark the scope average. Gross Margin Rate on ${baseWord}. Click a bubble to filter.`}
          legend={[
            { label: 'Items', color: C.s1, kind: 'dot' },
            { label: 'High Loss Flag', color: C.s2, kind: 'dot' },
          ]}
          table={{
            head: ['Item', 'Gross Margin Rate', 'Loss % of sales', 'Total Gross Sales'],
            rows: [...mapPoints].sort((a, b) => b.z - a.z).slice(0, 40).map((p) => [p.name, pct(p.x), pct(p.y), money(p.z)]),
          }}
        >
          <ItemMap
            points={mapPoints}
            xRef={gmr ?? 0}
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

      <Banner kind="note">Item sales and margin are available by day. Purchases and known loss are weekly in the source systems and are prorated for partial weeks.</Banner>

      <section className="card table-card" aria-label="Category-item table">
        <p className="card-caption">Department › Category › Subcategory › SKU Number · {range.label}</p>
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
          <span className="filter-spacer" />
          <label className="check-row">
            <input type="checkbox" checked={belowOnly} onChange={(e) => setBelowOnly(e.target.checked)} />
            Show items below target <StatusChip status="Proposed" />
          </label>
          <LossBasisControl />
          <FlagRulesButton />
        </div>
        <HierTable
          key={scope.productKey}
          hierarchy="Department › Category › Subcategory › SKU Number"
          columns={itemColumns(state.idStores, state.lossBasis)}
          tableId="items"
          defaultSort={{ key: 'gross', dir: 'desc' }}
          defaultExpanded={state.dept >= 0 ? [`d${state.dept}`, ...(state.cat >= 0 ? [`c${state.cat}`] : []), ...(state.sub >= 0 ? [`s${state.sub}`] : [])] : []}
          exportTitle={`Category-Item Summary ${range.label}`}
          total={{ id: 'total', label: 'Total', ...aggCells(total, { ...cellOpts, expectedLoss: totalExp }, total.highFlags ? <FlagCell flags={total.highFlags} errors={total.errFlags} /> : '') }}
          rows={rows}
        />
        {drillItem !== null && (
          <div className="store-drill" aria-label="Stores for the selected item">
            <div className="side-actions">
              <div>
                <h3 className="side-title">Stores · {ITEMS[drillItem].name}</h3>
                <p className="side-sub">
                  {range.label} · units sold, units scanned out (known loss) and Total Loss ($) by store, largest loss first
                </p>
              </div>
              <ExportButton
                fileName={`Stores ${ITEMS[drillItem].name}`}
                getSheet={() => ({
                  title: `Stores · ${ITEMS[drillItem].name} (${ITEMS[drillItem].code})`,
                  subtitle: range.label,
                  head: ['Store', 'District', 'Units sold', 'Units scanned out', 'Total Loss ($)', 'High Loss Flag', 'Likely entry errors (proposed label)'],
                  rows: drillRows.map((r) => [STORES[r.store].code, STORES[r.store].district, Math.round(r.unitsSold), Math.round(r.unitsScannedOut), Math.round(r.loss * 100) / 100, r.errFlags + r.reviewFlags, r.errFlags]),
                })}
              />
            </div>
            <div className="po-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th className="left">Store</th>
                    <th>Units sold</th>
                    <th>Units scanned out</th>
                    <th>Total Loss ($)</th>
                    <th>High Loss Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {drillRows.slice(0, 200).map((r) => (
                    <tr key={r.store} className={r.errFlags ? 'is-hot' : undefined}>
                      <td className="left">
                        Store {STORES[r.store].code} <span className="code-tag">{STORES[r.store].district}</span>
                      </td>
                      <td>{volume(r.unitsSold, ITEMS[drillItem].uom)}</td>
                      <td>{volume(r.unitsScannedOut, ITEMS[drillItem].uom)}</td>
                      <td>{money(r.loss)}</td>
                      <td>
                        <FlagCell flags={r.errFlags + r.reviewFlags} errors={r.errFlags} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
