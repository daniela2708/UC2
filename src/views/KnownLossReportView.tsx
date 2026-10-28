import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDay, LAST_COMPLETE_WEEK, weekEndDay, weekLabel, weekStartDay } from '../data/calendar';
import { RETAIL_LOSS_FACTOR } from '../data/generate';
import { PLANTED } from '../data/planted';
import { CATS, DEPTS, ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import { Banner, BannerStack, KeyFigures, SectionHeading, Sparkline, type Tile } from '../components/Blocks';
import { ChartGrid } from '../components/Charts';
import { FlagRulesButton } from '../components/FlagRules';
import { HierTable, type HierCol, type HierRow } from '../components/HierTable';
import { ItReviewList, ReportToItButton } from '../components/ItReport';
import { SkuSearch } from '../components/SkuSearch';
import { FlagCell, StatusChip } from '../components/ui';
import { ExportButton } from '../components/ExportButton';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { count, money, moneyCompact, pct, volume } from '../lib/format';
import { flagReason } from '../lib/itReport';
import { HIGH_LOSS_FLAG_TIP, lossPctOfSales, totalLoss, type LossBasis } from '../lib/kpis';
import { addAgg, emptyAgg, findFlags, isEntryError, itemAggregates, newItemsWatch, storeKnownLoss, type Agg, type FlagHit } from '../lib/selectors';
import { extremeInScope, incompleteStores, lossBasisWord, lossTitle, useScope, ViewToggles, type ViewProps } from './common';

/** Agreed in the technical session: shrink may become its own use case. */
const KL_SCOPE_NOTE =
  'May move to a separate use case or a later wave; the MVP focuses on item cost and ingredient costing. The High Loss Flag remains a required KPI in Category-Item Summary.';

function volCell(ea: number, lb: number): ReactNode {
  if (lb === 0) return volume(ea, 'ea');
  if (ea === 0) return volume(lb, 'lb');
  return (
    <>
      {volume(ea, 'ea')}
      <span className="cell-sub">{volume(lb, 'lb')}</span>
    </>
  );
}

/** Sort key for a volume: only meaningful when one unit of measure is present. */
const volSort = (ea: number, lb: number) => (ea > 0 && lb > 0 ? null : ea + lb);

function itemCols(basis: LossBasis): HierCol[] {
  return [
    { key: 'vol', label: 'Volume Sold', title: 'Units sold (ea) or pounds (lb); never added across units of measure', group: 'Sales' },
    { key: 'sales', label: 'Sales ($)', title: 'Gross Sales', group: 'Sales' },
    { key: 'klu', label: 'Known Loss (Units)', title: 'Units scanned out as known loss', group: 'Loss' },
    { key: 'kl', label: `Known Loss ($) · ${lossBasisWord(basis)}`, title: lossTitle(basis), group: 'Loss' },
    { key: 'lossPct', label: 'Loss % of sales', title: `Known Loss ($, ${lossBasisWord(basis)}) ÷ Sales ($)`, group: 'Loss', defaultHidden: true },
    { key: 'flag', label: 'High Loss Flag', title: HIGH_LOSS_FLAG_TIP, group: 'Loss' },
  ];
}

export function KnownLossReportView({ openDefinitions }: ViewProps) {
  const { state, range, scope } = useScope();
  const basis = state.lossBasis;
  const [sku, setSku] = useState(state.item);
  useEffect(() => setSku(state.item), [state.item]);

  const aggs = useMemo(() => itemAggregates(scope, state.costBasis, state.costSource), [scope, state.costBasis, state.costSource]);
  const lw0 = Math.min(range.startWeek, LAST_COMPLETE_WEEK);
  const lw1 = Math.min(range.endWeek, LAST_COMPLETE_WEEK);
  const flags = useMemo(() => findFlags(scope, lw0, lw1), [scope, lw0, lw1]);
  const skuValid = sku >= 0 && scope.itemMask[sku] === 1;
  const storeRows = useMemo(() => storeKnownLoss(scope, skuValid ? sku : -1), [scope, sku, skuValid]);
  const [newOpen, setNewOpen] = useState(true);
  const newItems = useMemo(() => newItemsWatch(scope), [scope]);

  const flagCost = (f: FlagHit) => (basis === 'cost' ? f.cost : f.cost * RETAIL_LOSS_FACTOR[ITEMS[f.item].dept]);

  const { rows, total } = useMemo(() => {
    const total = emptyAgg();
    const byDept = new Map<number, Agg>();
    const byCat = new Map<number, Agg>();
    const add = (m: Map<number, Agg>, k: number, a: Agg) => {
      if (!m.has(k)) m.set(k, emptyAgg());
      addAgg(m.get(k)!, a);
    };
    for (const a of aggs) {
      if (a.gross === 0 && a.loss === 0) continue;
      const it = ITEMS[a.item];
      addAgg(total, a);
      add(byDept, it.dept, a);
      add(byCat, it.cat, a);
    }
    const cells = (a: Agg, flagNode: ReactNode) => {
      const l = totalLoss(a.loss, a.lossRetail, basis) ?? 0;
      return {
        cells: {
          vol: volCell(a.ea, a.lb),
          sales: money(a.gross),
          klu: volCell(a.lossUnitsEa, a.lossUnitsLb),
          kl: money(l),
          lossPct: pct(lossPctOfSales(l, a.gross)),
          flag: flagNode,
        },
        sort: { vol: volSort(a.ea, a.lb), sales: a.gross, klu: volSort(a.lossUnitsEa, a.lossUnitsLb), kl: l, lossPct: lossPctOfSales(l, a.gross), flag: a.highFlags },
      };
    };
    const flagNode = (a: Agg) => (a.highFlags ? <FlagCell flags={a.highFlags} errors={a.errFlags} /> : '');
    const rows: HierRow[] = DEPTS.filter((d) => byDept.has(d.idx)).map((d) => ({
      id: `d${d.idx}`,
      label: d.name,
      ...cells(byDept.get(d.idx)!, flagNode(byDept.get(d.idx)!)),
      children: d.cats
        .filter((c) => byCat.has(c))
        .map((c) => ({
          id: `c${c}`,
          label: CATS[c].name,
          ...cells(byCat.get(c)!, flagNode(byCat.get(c)!)),
          children: aggs
            .filter((a) => ITEMS[a.item].cat === c && (a.gross > 0 || a.loss > 0))
            .map((a) => ({
              id: `i${a.item}`,
              label: ITEMS[a.item].name,
              sub: <span className="code-tag">{ITEMS[a.item].code}</span>,
              ...cells(a, flagNode(a)),
              onSelect: () => setSku((cur) => (cur === a.item ? -1 : a.item)),
              selected: sku === a.item,
            })),
        })),
    }));
    return { rows, total };
  }, [aggs, basis, sku]);

  const errors = flags.filter(isEntryError);
  const errLoss = errors.reduce((a, f) => a + flagCost(f), 0);
  const lossShown = totalLoss(total.loss, total.lossRetail, basis) ?? 0;
  const lossIncl = state.flagged === 'excl' ? lossShown + errLoss : lossShown;
  const lossExcl = state.flagged === 'excl' ? lossShown : lossShown - errLoss;
  const basisWord = lossBasisWord(basis);
  const weeklyRange = `${formatDay(weekStartDay(range.startWeek))} – ${formatDay(weekEndDay(range.endWeek))}`;

  const tiles: Tile[] = [
    { label: 'Volume Sold', info: 'Units (ea) and pounds (lb) sold, shown separately.', value: total.ea > 0 || total.lb === 0 ? volume(total.ea, 'ea') : volume(total.lb, 'lb'), sub: total.ea > 0 && total.lb > 0 ? volume(total.lb, 'lb') : range.label },
    { label: 'Sales ($)', info: 'Gross Sales for the items and stores in scope.', value: moneyCompact(total.gross), sub: range.label },
    {
      label: 'Known Loss (Units)',
      info: 'Units scanned out as known loss, ea and lb shown separately.',
      value: total.lossUnitsEa > 0 || total.lossUnitsLb === 0 ? volume(total.lossUnitsEa, 'ea') : volume(total.lossUnitsLb, 'lb'),
      sub: total.lossUnitsEa > 0 && total.lossUnitsLb > 0 ? volume(total.lossUnitsLb, 'lb') : basisWord,
    },
    {
      label: 'Known Loss ($)',
      info: `${lossTitle(basis)} The Excl. | Incl. errors toggle (Proposed) decides whether likely entry errors are in the totals.`,
      value: moneyCompact(state.flagged === 'excl' ? lossExcl : lossIncl),
      sub: (
        <>
          {state.flagged === 'excl' ? 'incl.' : 'excl.'} errors <b>{moneyCompact(state.flagged === 'excl' ? lossIncl : lossExcl)}</b> · {basisWord}
        </>
      ),
    },
    { label: 'Loss % of sales', info: 'Known Loss ($) ÷ Sales ($).', value: pct(lossPctOfSales(lossShown, total.gross)), sub: `of ${moneyCompact(total.gross)} sales` },
    {
      label: 'High Loss Flags',
      info: HIGH_LOSS_FLAG_TIP,
      value: count(flags.length),
      sub: `${count(errors.length)} likely entry error${errors.length === 1 ? '' : 's'} (proposed label)`,
    },
  ];

  // Store table, flagged entries and IT actions follow the SKU filter.
  const skuFlags = skuValid ? flags.filter((f) => f.item === sku) : flags;
  const flagsByStore = useMemo(() => {
    const m = new Map<number, FlagHit[]>();
    for (const f of skuFlags) {
      if (!m.has(f.store)) m.set(f.store, []);
      m.get(f.store)!.push(f);
    }
    return m;
  }, [skuFlags]);

  const storeTotal = storeRows.reduce(
    (a, r) => {
      a.gross += r.gross;
      a.ea += r.ea;
      a.lb += r.lb;
      a.loss += r.loss;
      a.lossUnitsEa += r.lossUnitsEa;
      a.lossUnitsLb += r.lossUnitsLb;
      a.flags += r.flags;
      a.errFlags += r.errFlags;
      return a;
    },
    { gross: 0, ea: 0, lb: 0, loss: 0, lossUnitsEa: 0, lossUnitsLb: 0, flags: 0, errFlags: 0 },
  );
  const retailF = skuValid ? RETAIL_LOSS_FACTOR[ITEMS[sku].dept] : lossShown / Math.max(1e-9, total.loss);
  const storeLoss = (l: number) => (basis === 'cost' ? l : l * retailF);
  const storeCells = (r: typeof storeTotal, district: string) => {
    const l = storeLoss(r.loss);
    return {
      cells: {
        district,
        vol: volCell(r.ea, r.lb),
        sales: money(r.gross),
        klu: volCell(r.lossUnitsEa, r.lossUnitsLb),
        kl: money(l),
        lossPct: pct(lossPctOfSales(l, r.gross)),
        flag: r.flags ? <FlagCell flags={r.flags} errors={r.errFlags} /> : '',
      },
      sort: { district, vol: volSort(r.ea, r.lb), sales: r.gross, klu: volSort(r.lossUnitsEa, r.lossUnitsLb), kl: l, lossPct: lossPctOfSales(l, r.gross), flag: r.flags },
    };
  };
  const storeTableRows: HierRow[] = storeRows.map((r) => {
    const st = STORES[r.store];
    const fl = flagsByStore.get(r.store) ?? [];
    return {
      id: `s${r.store}`,
      label: `Store ${st.code}`,
      ...storeCells(r, st.district),
      extra: fl.length ? <ReportToItButton flags={fl} /> : undefined,
      className: r.errFlags ? 'is-hot' : undefined,
    };
  });

  const largest = flags.find((f) => !f.extreme);
  const incomplete = incompleteStores(scope);
  const extreme = extremeInScope(scope);
  const skuName = skuValid ? `${ITEMS[sku].name} (${ITEMS[sku].code})` : null;

  return (
    <>
      <SectionHeading
        eyebrow="Known loss · KL1011"
        title="Known Loss Report"
        badge={
          <span className="chip status-pending" title={KL_SCOPE_NOTE}>
            Scope TBD
          </span>
        }
        question="Where does known loss come from, by item and by store, and which entries should IT remove?"
        painPoint="High loss and data entry errors are found late, and removing them depends on emails to IT."
        validate="Scope TBD, may move to a separate use case (#9). The source of truth for loss, KL1011 or Ops 300, blocks the build (#16), and where the SQL for the $1,000 rule lives is unknown (#26)."
      >
        {describeProductScope(state)}, {describeStoreScope(state)}, {weeklyRange}: Known Loss <b>{moneyCompact(lossShown)}</b> {basisWord} on <b>{moneyCompact(total.gross)}</b> of sales, with{' '}
        <b>{count(flags.length)}</b> High Loss Flag{flags.length === 1 ? '' : 's'} (weekly loss above $1,000)
        {largest && (
          <>
            ; the largest below the $100,000 plausibility cap is <b>{ITEMS[largest.item].name}</b> in store <b>{STORES[largest.store].code}</b> at <b>{money(largest.cost)}</b>
          </>
        )}
        .
      </SectionHeading>

      <Banner kind="note" lead="Scope TBD:">
        {KL_SCOPE_NOTE}
      </Banner>

      <BannerStack>
        {extreme && (
          <Banner lead={state.flagged === 'excl' ? 'Extreme entry excluded:' : 'Extreme entry included:'} kind={state.flagged === 'excl' ? 'alert' : 'danger'}>
            {extreme.item}, store {extreme.store}, {extreme.week}: <b>{moneyCompact(extreme.cost)}</b> of known loss.{' '}
            {state.flagged === 'excl' ? 'It is a likely entry error and is left out of totals by default.' : 'Totals now include it, which distorts department loss.'}
          </Banner>
        )}
        {incomplete.length > 0 && (
          <Banner
            lead="Incomplete reporting:"
            details={{ content: <>Stores {incomplete.map((s) => String(s).padStart(3, '0')).join(', ')} show no known loss for {weekLabel(PLANTED.incomplete.week)}.</> }}
          >
            {incomplete.length} store{incomplete.length > 1 ? 's have' : ' has'} not posted known loss for {weekLabel(PLANTED.incomplete.week).split(' ')[1]}.
          </Banner>
        )}
      </BannerStack>

      <ViewToggles loss flagged>
        <span className="filter-spacer" />
        <FlagRulesButton />
      </ViewToggles>

      <KeyFigures
        caption={`Key figures · ${describeProductScope(state)} · ${describeStoreScope(state)} · ${range.fyLabel} · ${weeklyRange}`}
        tiles={tiles}
        note={
          <>
            High Loss Flag: known loss higher than $1,000 for an item in a store in a given week (open question 2). Threshold basis: at cost, assumed{' '}
            <StatusChip status="Pending validation" /> (not yet in the tracker).{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('high-loss-flag')}>
              See definitions
            </button>
          </>
        }
      />

      <section className="card table-card" aria-label="Known loss by item">
        <div className="side-actions">
          <div>
            <h3 className="side-title">Known loss by item</h3>
            <p className="side-sub">Department › Category › Item · click an item to filter the store table below</p>
          </div>
        </div>
        <HierTable
          key={scope.productKey}
          hierarchy="Department › Category › Item"
          columns={itemCols(basis)}
          tableId="kl"
          defaultSort={{ key: 'kl', dir: 'desc' }}
          defaultExpanded={state.dept >= 0 ? [`d${state.dept}`, ...(state.cat >= 0 ? [`c${state.cat}`] : [])] : []}
          exportTitle={`Known Loss Report by item ${range.label}`}
          total={{ id: 'total', label: 'Total', ...((): Pick<HierRow, 'cells' | 'sort'> => {
            const l = lossShown;
            return {
              cells: {
                vol: volCell(total.ea, total.lb),
                sales: money(total.gross),
                klu: volCell(total.lossUnitsEa, total.lossUnitsLb),
                kl: money(l),
                lossPct: pct(lossPctOfSales(l, total.gross)),
                flag: total.highFlags ? <FlagCell flags={total.highFlags} errors={total.errFlags} /> : '',
              },
              sort: {},
            };
          })() }}
          rows={rows}
        />
      </section>

      <section className="card table-card" aria-label="Known loss by store">
        <div className="side-actions">
          <div>
            <h3 className="side-title">Known loss by store{skuName ? ` · ${skuName}` : ''}</h3>
            <p className="side-sub">One row per Store Num · {skuName ? 'filtered by SKU Number' : 'all items in scope; pick a SKU Number to narrow it'}</p>
          </div>
        </div>
        <HierTable
          key={`stores-${sku}`}
          tools={
            <span className="sku-filter">
          <SkuSearch item={skuValid ? sku : -1} onSelect={(i) => setSku(i)} />
          {skuValid && (
            <button type="button" className="chart-view-btn" onClick={() => setSku(-1)}>
              <X size={13} aria-hidden="true" />
              Clear SKU
            </button>
          )}
            </span>
          }
          hierarchy="Store Num"
          columns={[{ key: 'district', label: 'District', left: true }, ...itemCols(basis)]}
          tableId="klstores"
          defaultSort={{ key: 'kl', dir: 'desc' }}
          exportTitle={`Known Loss Report by store ${skuName ?? ''} ${range.label}`}
          maxHeight={480}
          total={{ id: 'total', label: 'Total', ...storeCells(storeTotal, '') }}
          rows={storeTableRows}
        />
      </section>

      <section className="card side-card" aria-label="New items watch">
        <div className="side-actions">
          <button type="button" className="collapse-head" aria-expanded={newOpen} onClick={() => setNewOpen((o) => !o)}>
            {newOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            <span>
              <span className="side-title">
                New items watch · {count(newItems.length)} <StatusChip status="Proposed" />
              </span>
              <span className="side-sub">
                Items in their first 12 weeks since first sale, week by week through {weekLabel(Math.min(range.endWeek, LAST_COMPLETE_WEEK))} · mirrors the weekly KL1011 review the Deli team runs
              </span>
            </span>
          </button>
          <ExportButton
            fileName="New items watch"
            getSheet={() => ({
              title: 'New items watch (Proposed)',
              subtitle: `${describeProductScope(state)} · ${describeStoreScope(state)} · ${lossBasisWord(basis)}`,
              head: ['Item', 'SKU Number', 'Department', 'First sale', 'Week', 'Week on sale', 'Volume Sold', 'UoM', 'Sales ($)', 'Known Loss (Units)', `Known Loss ($, ${lossBasisWord(basis)})`],
              rows: newItems.flatMap((n) => {
                const it = ITEMS[n.item];
                const rf = basis === 'cost' ? 1 : RETAIL_LOSS_FACTOR[it.dept];
                return n.weekly.map((w, k) => [
                  it.name,
                  it.code,
                  DEPTS[it.dept].name,
                  weekLabel(n.launchWeek),
                  weekLabel(w.week),
                  k + 1,
                  Math.round(w.volume * 10) / 10,
                  it.uom,
                  Math.round(w.sales * 100) / 100,
                  Math.round(w.lossUnits * 10) / 10,
                  Math.round(w.loss * rf * 100) / 100,
                ]);
              }),
            })}
          />
        </div>
        {newOpen &&
          (newItems.length === 0 ? (
            <p className="empty">No items in their first 12 weeks for the current filters.</p>
          ) : (
            <div className="po-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th className="left">Item</th>
                    <th className="left">First sale</th>
                    <th>Weeks on sale</th>
                    <th>Weekly volume</th>
                    <th>Volume Sold</th>
                    <th>Weekly sales</th>
                    <th>Sales ($)</th>
                    <th>Known Loss (Units)</th>
                    <th>Weekly known loss</th>
                    <th title={lossTitle(basis)}>Known Loss ($) · {lossBasisWord(basis)}</th>
                    <th>Loss % of sales</th>
                  </tr>
                </thead>
                <tbody>
                  {newItems.map((n) => {
                    const it = ITEMS[n.item];
                    const rf = basis === 'cost' ? 1 : RETAIL_LOSS_FACTOR[it.dept];
                    return (
                      <tr key={n.item}>
                        <td className="left">
                          <span className="code-tag">{it.code}</span>
                          {it.name}
                          <span className="cell-sub">{DEPTS[it.dept].name}</span>
                        </td>
                        <td className="left">{weekLabel(n.launchWeek)}</td>
                        <td>{n.weeks}</td>
                        <td>
                          <Sparkline values={n.weekly.map((w) => w.volume)} />
                        </td>
                        <td>{volume(n.volume, it.uom)}</td>
                        <td>
                          <Sparkline values={n.weekly.map((w) => w.sales)} />
                        </td>
                        <td>{money(n.sales)}</td>
                        <td>{volume(n.lossUnits, it.uom)}</td>
                        <td>
                          <Sparkline values={n.weekly.map((w) => w.loss * rf)} />
                        </td>
                        <td>{money(n.loss * rf)}</td>
                        <td>{pct(lossPctOfSales(n.loss * rf, n.sales))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <ChartGrid cols={2}>
        <section className="card side-card" aria-label="Flagged entries">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Flagged entries · {count(skuFlags.length)}</h3>
              <p className="side-sub">Item-store-weeks with known loss above $1,000, largest first · known loss at cost (threshold basis assumed at cost, pending validation){skuName ? ` · ${skuName}` : ''}</p>
            </div>
            <div className="side-buttons">
              <ReportToItButton flags={skuFlags.filter(isEntryError)} label="Add all likely errors to IT Review List" />
              <ExportButton
                fileName="Flagged entries"
                getSheet={() => ({
                  title: 'High Loss Flags',
                  subtitle: `${describeProductScope(state)} · ${describeStoreScope(state)} · ${weeklyRange}`,
                  head: ['Item', 'SKU Number', 'Store Num', 'District', 'Week', 'Known Loss (Units)', 'UoM', 'Known Loss ($)', 'Typical weekly units', 'Reason (proposed)'],
                  rows: skuFlags.map((f) => {
                    const it = ITEMS[f.item];
                    return [it.name, it.code, STORES[f.store].code, STORES[f.store].district, weekLabel(f.week), Math.round(f.units * 10) / 10, it.uom, Math.round(f.cost * 100) / 100, Math.round(f.avgUnits * 10) / 10, flagReason(f)];
                  }),
                })}
              />
            </div>
          </div>
          {skuFlags.length === 0 ? (
            <p className="empty">No entries above $1,000 for the current filters.</p>
          ) : (
            <ol className="flag-list" aria-label="Flagged item-store-weeks">
              {skuFlags.slice(0, 100).map((f, n) => {
                const it = ITEMS[f.item];
                const st = STORES[f.store];
                const err = isEntryError(f);
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
                      <span className={`chip ${err ? 'error' : 'amber'}`} title="Reason label (Proposed)">
                        {flagReason(f)}
                      </span>
                      <ReportToItButton flags={[f]} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <ItReviewList />
      </ChartGrid>
    </>
  );
}
