import { useMemo, useState } from 'react';
import { formatDay, weekEndDay, weekLabel, weekStartDay } from '../data/calendar';
import { CATS, DEPTS, ITEMS } from '../data/products';
import { DISTRICTS, REGIONS, STORES } from '../data/stores';
import { PLANTED } from '../data/planted';
import { Banner, KeyFigures, SectionHeading, type Tile } from '../components/Blocks';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { CellBar, Var } from '../components/ui';
import { C, ChartCard, ChartGrid, hbarHeight, HBars } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { actions } from '../lib/filterStore';
import { count, money, moneyCompact, pct, volume } from '../lib/format';
import { lossPctOfSales, pointsDiff } from '../lib/kpis';
import { findFlags, storeCatLoss, topLossItems, type StoreCatLoss } from '../lib/selectors';
import { incompleteStores, useScope, ViewToggles, type ViewProps } from './common';

interface Node {
  sales: number;
  loss: number;
  lySales: number;
  lyLoss: number;
  donations: number;
  flags: number;
}
const empty = (): Node => ({ sales: 0, loss: 0, lySales: 0, lyLoss: 0, donations: 0, flags: 0 });

const COLUMNS: HierCol[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'loss', label: 'Known Loss $' },
  { key: 'lossPct', label: 'Loss %' },
  { key: 'ly', label: 'vs LY' },
  { key: 'don', label: 'Donations $' },
  { key: 'flags', label: 'Flags' },
];

export function StoreLossView({ openDefinitions }: ViewProps) {
  const { state, update, range, scope } = useScope();
  const data = useMemo(() => storeCatLoss(scope), [scope]);
  const flags = useMemo(() => findFlags(scope), [scope]);
  const basis = state.lossBasis;
  const pick = (v: StoreCatLoss): Node => ({
    sales: v.sales,
    loss: basis === 'cost' ? v.loss : v.lossRetail,
    lySales: v.lySales,
    lyLoss: basis === 'cost' ? v.lyLoss : v.lyLossRetail,
    donations: v.donations,
    flags: v.flags,
  });

  const { total, storeNodes, districtNodes, regionNodes, storeDeptCat } = useMemo(() => {
    const total = empty();
    const storeNodes = new Map<number, Node>();
    const districtNodes = new Map<string, Node>();
    const regionNodes = new Map<number, Node>();
    const storeDeptCat = new Map<number, { dept: Map<number, Node>; cat: Map<number, Node> }>();
    const addTo = (n: Node, v: Node) => {
      n.sales += v.sales;
      n.loss += v.loss;
      n.lySales += v.lySales;
      n.lyLoss += v.lyLoss;
      n.donations += v.donations;
      n.flags += v.flags;
    };
    for (const [s, row] of data) {
      const st = STORES[s];
      const sn = empty();
      const dc = { dept: new Map<number, Node>(), cat: new Map<number, Node>() };
      row.forEach((v, c) => {
        if (v.sales === 0 && v.loss === 0) return;
        const n = pick(v);
        addTo(sn, n);
        const d = CATS[c].dept;
        if (!dc.dept.has(d)) dc.dept.set(d, empty());
        addTo(dc.dept.get(d)!, n);
        dc.cat.set(c, n);
      });
      if (sn.sales === 0) continue;
      storeNodes.set(s, sn);
      storeDeptCat.set(s, dc);
      if (!districtNodes.has(st.district)) districtNodes.set(st.district, empty());
      if (!regionNodes.has(st.region)) regionNodes.set(st.region, empty());
      addTo(districtNodes.get(st.district)!, sn);
      addTo(regionNodes.get(st.region)!, sn);
      addTo(total, sn);
    }
    return { total, storeNodes, districtNodes, regionNodes, storeDeptCat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, basis]);

  const defaultStore = useMemo(() => {
    let best = -1;
    let bestLoss = -1;
    for (const [s, n] of storeNodes)
      if (n.loss > bestLoss) {
        bestLoss = n.loss;
        best = s;
      }
    return best;
  }, [storeNodes]);
  const [picked, setPicked] = useState<number | null>(null);
  const selStore = picked !== null && storeNodes.has(picked) ? picked : defaultStore;
  const top = useMemo(() => (selStore >= 0 ? topLossItems(scope, selStore, basis) : []), [scope, selStore, basis]);

  const ly = range.lyAvailable;
  const cells = (n: Node) => {
    const lp = lossPctOfSales(n.loss, n.sales);
    const lyP = lossPctOfSales(n.lyLoss, n.lySales);
    const vs = ly ? pointsDiff(lp, lyP) : null;
    return {
      cells: {
        sales: money(n.sales),
        loss: money(n.loss),
        lossPct: <CellBar value={lp} max={0.08} text={pct(lp)} warm />,
        ly: <Var value={vs} invert />,
        don: money(n.donations),
        flags: n.flags ? <span className="chip error">{count(n.flags)}</span> : '',
      },
      sort: { sales: n.sales, loss: n.loss, lossPct: lp, ly: vs, don: n.donations, flags: n.flags },
    };
  };

  const districtPct = new Map<string, number | null>();
  for (const [d, n] of districtNodes) districtPct.set(d, lossPctOfSales(n.loss, n.sales));
  let aboveAvg = 0;
  for (const [s, n] of storeNodes) {
    const dp = districtPct.get(STORES[s].district);
    const sp = lossPctOfSales(n.loss, n.sales);
    if (dp !== null && dp !== undefined && sp !== null && sp > dp) aboveAvg++;
  }

  const storeRow = (s: number): HierRow => {
    const n = storeNodes.get(s)!;
    const dc = storeDeptCat.get(s)!;
    const st = STORES[s];
    return {
      id: `s${s}`,
      label: `Store ${st.code}`,
      sub: incompleteStores(scope).includes(st.id) ? <span className="amber">Known loss not posted for W42</span> : undefined,
      ...cells(n),
      onSelect: () => setPicked(s),
      selected: s === selStore,
      children: [...dc.dept.entries()].map(([d, dn]) => ({
        id: `s${s}d${d}`,
        label: DEPTS[d].name,
        ...cells(dn),
        children: DEPTS[d].cats.filter((c) => dc.cat.has(c)).map((c) => ({ id: `s${s}c${c}`, label: CATS[c].name, ...cells(dc.cat.get(c)!) })),
      })),
    };
  };

  const rows: HierRow[] = REGIONS.filter((r) => regionNodes.has(r)).map((r) => ({
    id: `r${r}`,
    label: `Region ${r}`,
    ...cells(regionNodes.get(r)!),
    drill: { label: `Filter to Region ${r}`, onClick: () => update(actions.region(r)) },
    children: DISTRICTS.filter((d) => d.region === r && districtNodes.has(d.id)).map((d) => ({
      id: `d${d.id}`,
      label: d.id,
      ...cells(districtNodes.get(d.id)!),
      drill: { label: `Filter to ${d.id}`, onClick: () => update((st) => ({ ...actions.region(d.region)(st), districts: [d.id], stores: [] })) },
      children: d.stores.filter((s) => storeNodes.has(s)).map(storeRow),
    })),
  }));

  const lp = lossPctOfSales(total.loss, total.sales);
  const vsLy = ly ? pointsDiff(lp, lossPctOfSales(total.lyLoss, total.lySales)) : null;
  const flaggedItems = new Set(flags.map((f) => f.item)).size;
  const incomplete = incompleteStores(scope);
  const weeklyRange = `${formatDay(weekStartDay(range.startWeek))} – ${formatDay(weekEndDay(range.endWeek))}`;
  const basisWord = basis === 'cost' ? 'at cost' : 'at retail';
  const sel = selStore >= 0 ? STORES[selStore] : null;
  const selNode = selStore >= 0 ? storeNodes.get(selStore) : undefined;

  const topStores = [...storeNodes.entries()]
    .map(([s, n]) => ({ s, lp: lossPctOfSales(n.loss, n.sales) ?? 0, n }))
    .sort((a, b) => b.lp - a.lp)
    .slice(0, 30)
    .map(({ s, lp, n }) => {
      const st = STORES[s];
      const dp = districtPct.get(st.district) ?? null;
      return {
        id: s,
        label: `${st.code} · ${st.district}`,
        value: lp * 100,
        compare: dp === null ? null : dp * 100,
        color: s === selStore ? C.s2 : C.s1,
        tip: [
          { label: 'Loss % of sales', value: pct(lp), color: C.s1 },
          { label: `${st.district} average`, value: pct(dp), color: C.ly },
          { label: 'Known loss', value: money(n.loss) },
        ],
      };
    });
  const deptRows = (() => {
    const agg = new Map<number, Node>();
    for (const dc of storeDeptCat.values())
      for (const [d, n] of dc.dept) {
        if (!agg.has(d)) agg.set(d, empty());
        const a = agg.get(d)!;
        a.sales += n.sales;
        a.loss += n.loss;
        a.lySales += n.lySales;
        a.lyLoss += n.lyLoss;
      }
    return [...agg.entries()]
      .map(([d, n]) => {
        const l = lossPctOfSales(n.loss, n.sales);
        const lyl = ly ? lossPctOfSales(n.lyLoss, n.lySales) : null;
        return {
          id: d,
          label: DEPTS[d].name,
          value: (l ?? 0) * 100,
          compare: lyl === null ? null : lyl * 100,
          tip: [
            { label: 'Loss % this year', value: pct(l), color: C.s1 },
            { label: 'Loss % last year', value: pct(lyl), color: C.ly },
            { label: 'Known loss', value: money(n.loss) },
          ],
        };
      })
      .sort((a, b) => b.value - a.value);
  })();

  const storeCats = (() => {
    const dc = selStore >= 0 ? storeDeptCat.get(selStore) : undefined;
    if (!dc) return [];
    const all = new Map<number, Node>();
    for (const d of storeDeptCat.values())
      for (const [c, n] of d.cat) {
        if (!all.has(c)) all.set(c, empty());
        const a = all.get(c)!;
        a.sales += n.sales;
        a.loss += n.loss;
      }
    return [...dc.cat.entries()]
      .map(([c, n]) => {
        const l = lossPctOfSales(n.loss, n.sales) ?? 0;
        const a = all.get(c);
        const al = a ? lossPctOfSales(a.loss, a.sales) : null;
        return {
          id: c,
          label: `${CATS[c].name}`,
          value: l * 100,
          compare: al === null ? null : al * 100,
          tip: [
            { label: 'Store loss %', value: pct(l), color: C.s1 },
            { label: 'All stores in scope', value: pct(al), color: C.ly },
            { label: 'Store known loss', value: money(n.loss) },
          ],
        };
      })
      .sort((a, b) => b.value - a.value);
  })();

  const tiles: Tile[] = [
    { label: 'Known Loss $', info: 'KL1011 known loss for the complete weeks in range.', value: moneyCompact(total.loss), sub: `${basisWord} · ${state.flagged === 'excl' ? 'excl.' : 'incl.'} flagged` },
    { label: 'Loss % of sales', info: 'Known Loss ÷ Gross Sales.', value: pct(lp), sub: `of ${moneyCompact(total.sales)} sales` },
    { label: 'vs LY', info: 'Loss % − Loss % for the same fiscal weeks last year. Lower is better.', value: <Var value={vsLy} invert />, sub: ly ? 'Same fiscal weeks last year' : 'No last-year history' },
    { label: 'Stores above district avg', info: "Stores whose loss % is above their own district's loss %.", value: `${count(aboveAvg)} / ${count(storeNodes.size)}`, sub: 'Loss % above own district' },
    { label: 'Items flagged', info: 'Distinct items with at least one item-store-week above the flag rule.', value: count(flaggedItems), sub: `${count(flags.length)} item-store-weeks` },
  ];

  return (
    <>
      <SectionHeading eyebrow="Store loss" title="Store Loss View" question="Which stores and categories drive loss this week?">
        {describeProductScope(state)}, {weeklyRange}: Known Loss <b>{moneyCompact(total.loss)}</b> {basisWord} (<b>{pct(lp)}</b> of sales
        {ly && (
          <>
            ,{' '}
            <b>
              <Var value={vsLy} invert />
            </b>{' '}
            vs. last year
          </>
        )}
        ); <b>{count(aboveAvg)}</b> stores are above their district average.
      </SectionHeading>

      {incomplete.length > 0 && (
        <Banner
          lead="Incomplete reporting:"
          details={{ content: <>Stores {incomplete.map((s) => String(s).padStart(3, '0')).join(', ')} show $0 known loss for {weekLabel(PLANTED.incomplete.week)}. Their loss % and district averages are understated until they post.</> }}
        >
          {incomplete.length} store{incomplete.length > 1 ? 's have' : ' has'} not posted known loss for {weekLabel(PLANTED.incomplete.week).split(' ')[1]}.
        </Banner>
      )}

      <ViewToggles loss flagged />

      <KeyFigures
        caption={`Key figures · ${describeProductScope(state)} · ${describeStoreScope(state)} · ${range.fyLabel} · ${weeklyRange}`}
        tiles={tiles}
        note={
          <>
            Known loss valuation is <b>Pending validation</b>.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('total-loss')}>
              See definitions
            </button>
          </>
        }
      />
      <ChartGrid cols={2}>
        <ChartCard
          title="Stores with the highest loss %"
          subtitle={`Top 30 · ${weeklyRange} · gray bar is the store's district average · click to see its top items`}
          height={340}
          contentHeight={hbarHeight(topStores.length, true)}
          legend={[
            { label: 'Store loss %', color: C.s1, kind: 'rect' },
            ...(topStores.some((t) => t.id === selStore) ? [{ label: `Selected store (${sel?.code ?? ''})`, color: C.s2, kind: 'rect' as const }] : []),
            { label: 'District average', color: C.ly, kind: 'rect' },
          ]}
          table={{ head: ['Store', 'Loss %', 'District avg'], rows: topStores.map((t) => [t.label, `${t.value.toFixed(1)}%`, t.compare === null ? '—' : `${t.compare.toFixed(1)}%`]) }}
        >
          <HBars data={topStores} labelWidth={84} compareLabel="District average" format={(v) => `${v.toFixed(1)}%`} onSelect={(d) => setPicked(Number(d.id))} />
        </ChartCard>
        <ChartCard
          title="Loss % by department"
          subtitle={`${weeklyRange} · this year vs same weeks last year`}
          height={340}
          contentHeight={hbarHeight(deptRows.length, true)}
          legend={[
            { label: 'This year', color: C.s1, kind: 'rect' },
            { label: 'Last year', color: C.ly, kind: 'rect' },
          ]}
          table={{ head: ['Department', 'Loss %', 'LY'], rows: deptRows.map((t) => [t.label, `${t.value.toFixed(1)}%`, t.compare === null ? '—' : `${t.compare.toFixed(1)}%`]) }}
        >
          <HBars data={deptRows} labelWidth={70} compareLabel="Last year" format={(v) => `${v.toFixed(1)}%`} />
        </ChartCard>
      </ChartGrid>
      {range.snapped && <Banner kind="note">Known loss is weekly. Values aggregate to complete fiscal weeks ({weeklyRange}).</Banner>}

      <section className="card table-card" aria-label="Known loss by store">
          <p className="card-caption">Region › District › Store › Department › Category · {weeklyRange}</p>
          <HierTable
            key={`${scope.storeKey.length}-${state.districts.join()}`}
            hierarchy="Region › District › Store › Department › Category"
            columns={COLUMNS}
            defaultSort={{ key: 'loss', dir: 'desc' }}
            defaultExpanded={state.districts.length || state.region ? [...REGIONS.map((r) => `r${r}`), ...state.districts.map((d) => `d${d}`)] : []}
            total={{ id: 'total', label: 'Total', ...cells(total) }}
            rows={rows}
            exportTitle={`Store Loss ${weeklyRange}`}
          />
          <p className="card-caption" style={{ marginTop: 10 }}>
            Select a store row to see its top items.
          </p>
        </section>

      <ChartGrid cols={2}>
        <section className="card side-card" aria-label="Top 10 items by loss">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Top 10 items by loss{sel ? ` · Store ${sel.code}` : ''}</h3>
              <p className="side-sub">
                {sel ? `${sel.district} · Region ${sel.region} · ` : ''}
                {weeklyRange} · {basisWord}
                {selNode ? ` · store loss ${pct(lossPctOfSales(selNode.loss, selNode.sales))} of sales` : ''}
              </p>
            </div>
            <ExportButton
              fileName={`Top items store ${sel?.code ?? ''}`}
              getSheet={() => ({
                title: `Top 10 items by loss · Store ${sel?.code ?? ''}`,
                subtitle: `${weeklyRange} · ${basisWord}`,
                head: ['Item', 'Code', 'Sales', 'Known loss $', 'Loss %', 'Loss units', 'UoM', 'Flags'],
                rows: top.map((t) => {
                  const it = ITEMS[t.item];
                  return [it.name, it.code, Math.round(t.sales * 100) / 100, Math.round(t.loss * 100) / 100, pct(lossPctOfSales(t.loss, t.sales)), Math.round(t.lossUnits * 10) / 10, it.uom, t.flags];
                }),
              })}
            />
          </div>
          {top.length === 0 ? (
            <p className="empty">No stores in scope.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr>
                  <th className="left">Item</th>
                  <th>Sales</th>
                  <th>Known Loss $</th>
                  <th>Loss %</th>
                  <th>Loss units</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t) => {
                  const it = ITEMS[t.item];
                  return (
                    <tr key={t.item}>
                      <td className="left">
                        <span className="code-tag">{it.code}</span>
                        {it.name}
                      </td>
                      <td>{money(t.sales)}</td>
                      <td>{money(t.loss)}</td>
                      <td>{pct(lossPctOfSales(t.loss, t.sales))}</td>
                      <td>{volume(t.lossUnits, it.uom)}</td>
                      <td>{t.flags ? <span className="chip error">{t.flags}</span> : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <ChartCard
          title={`Loss % by category${sel ? ` · Store ${sel.code}` : ''}`}
          subtitle={`${weeklyRange} · gray bar is the same category across all stores in scope`}
          height={340}
          contentHeight={hbarHeight(storeCats.length, true)}
          legend={[
            { label: `Store ${sel?.code ?? ''}`, color: C.s1, kind: 'rect' },
            { label: 'All stores in scope', color: C.ly, kind: 'rect' },
          ]}
          table={{ head: ['Category', 'Store loss %', 'All stores loss %'], rows: storeCats.map((c) => [c.label, `${c.value.toFixed(1)}%`, c.compare === null ? '—' : `${c.compare.toFixed(1)}%`]) }}
        >
          <HBars data={storeCats} labelWidth={150} compareLabel="All stores in scope" format={(v) => `${v.toFixed(1)}%`} />
        </ChartCard>
      </ChartGrid>
    </>
  );
}
