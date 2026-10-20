import { useMemo } from 'react';
import { fiscalOfWeek, formatDay, weekEndDay, weekLabel, weekStartDay } from '../data/calendar';
import { RETAIL_LOSS_FACTOR } from '../data/generate';
import { PLANTED } from '../data/planted';
import { DEPTS, ITEMS } from '../data/products';
import { STORES } from '../data/stores';
import { Banner, BannerStack, KeyFigures, SectionHeading, Sparkline, type Tile } from '../components/Blocks';
import { C, ChartCard, ChartGrid, ColumnsVsLy, hbarHeight, HBars } from '../components/Charts';
import { ExportButton } from '../components/ExportButton';
import { FlagRulesForm } from '../components/FlagRules';
import { StatusChip } from '../components/ui';
import { describeProductScope, describeStoreScope } from '../lib/filters';
import { count, money, moneyCompact, pct, volume, weekTick } from '../lib/format';
import { lossPctOfSales } from '../lib/kpis';
import { findFlags, isEntryError, newItemsWatch, storeCatLoss, weeklyLoss, type FlagHit } from '../lib/selectors';
import { extremeInScope, incompleteStores, useScope, ViewToggles, type ViewProps } from './common';

function tierLabel(f: FlagHit): string {
  if (isEntryError(f)) return 'Likely entry error';
  return f.kind === 'overstock' ? 'High loss to review · post-holiday overstock' : 'High loss to review';
}

function ruleText(f: FlagHit, dollars: number): string {
  const ratio = Number.isFinite(f.ratio) ? `${f.ratio >= 100 ? f.ratio.toFixed(0) : f.ratio.toFixed(1)}×` : 'Far above';
  return `${ratio} its 26-week average and above ${money(dollars)}`;
}

export function LossReviewView({ openDefinitions }: ViewProps) {
  const { state, range, scope } = useScope();
  const flags = useMemo(() => findFlags(scope), [scope]);
  const lossWeeks = useMemo(() => {
    const out: number[] = [];
    for (let w = Math.max(0, range.endWeek - 25); w <= range.endWeek; w++) out.push(w);
    return out;
  }, [range.endWeek]);
  const lossSeries = useMemo(() => weeklyLoss(scope, lossWeeks), [scope, lossWeeks]);
  const newItems = useMemo(() => newItemsWatch(scope), [scope]);
  const storeLoss = useMemo(() => storeCatLoss(scope), [scope]);
  const basis = state.lossBasis;

  const errors = flags.filter(isEntryError);
  const review = flags.filter((f) => !isEntryError(f));
  const errDollars = errors.reduce((a, f) => a + f.cost, 0);
  const reviewDollars = review.reduce((a, f) => a + f.cost, 0);
  const ranked = flags.filter((f) => !f.extreme);
  const extremes = flags.filter((f) => f.extreme);

  // Store ranking: stores whose loss % is more than 1 pt above their district's.
  const { stores, total } = useMemo(() => {
    const perStore = new Map<number, { sales: number; loss: number }>();
    const perDist = new Map<string, { sales: number; loss: number }>();
    let tSales = 0;
    let tLoss = 0;
    for (const [s, row] of storeLoss) {
      let sales = 0;
      let loss = 0;
      for (const v of row) {
        sales += v.sales;
        loss += basis === 'cost' ? v.loss : v.lossRetail;
      }
      if (sales <= 0) continue;
      perStore.set(s, { sales, loss });
      const d = STORES[s].district;
      const a = perDist.get(d) ?? { sales: 0, loss: 0 };
      a.sales += sales;
      a.loss += loss;
      perDist.set(d, a);
      tSales += sales;
      tLoss += loss;
    }
    const stores = [...perStore.entries()]
      .map(([s, v]) => {
        const d = perDist.get(STORES[s].district)!;
        const lp = v.loss / v.sales;
        const dp = d.loss / d.sales;
        return { store: s, sales: v.sales, loss: v.loss, lp, dp, gap: (lp - dp) * 100 };
      })
      .filter((x) => x.gap > 1)
      .sort((a, b) => b.gap - a.gap);
    return { stores, total: { sales: tSales, loss: tLoss } };
  }, [storeLoss, basis]);

  const incomplete = incompleteStores(scope);
  const extreme = extremeInScope(scope);
  const weeklyRange = `${formatDay(weekStartDay(range.startWeek))} – ${formatDay(weekEndDay(range.endWeek))}`;
  const latestFy = fiscalOfWeek(range.endWeek).fy;
  const basisWord = basis === 'cost' ? 'at cost' : 'at retail';
  const retailF = (f: FlagHit) => (basis === 'cost' ? 1 : RETAIL_LOSS_FACTOR[ITEMS[f.item].dept]);
  const lossIncl = state.flagged === 'excl' ? total.loss + errors.reduce((a, f) => a + f.cost * retailF(f), 0) : total.loss;
  const lossExcl = state.flagged === 'excl' ? total.loss : total.loss - errors.reduce((a, f) => a + f.cost * retailF(f), 0);

  const tiles: Tile[] = [
    { label: 'Total Loss ($)', info: 'Known loss (KL1011) including likely entry errors.', value: moneyCompact(lossIncl), sub: <>excl. errors <b>{moneyCompact(lossExcl)}</b> · {basisWord}</> },
    { label: 'Loss % of sales', info: 'Total Loss excluding likely entry errors ÷ Total Gross Sales.', value: pct(lossPctOfSales(lossExcl, total.sales)), sub: `of ${moneyCompact(total.sales)} sales` },
    { label: 'Likely entry errors', info: 'Loss units above 20× the item-store typical weekly units, or above the $100,000 plausibility cap.', value: count(errors.length), sub: `${moneyCompact(errDollars)} at cost` },
    { label: 'High loss to review', info: 'Weekly loss above the $ threshold and more than the % threshold above the 26-week average, not an entry error.', value: count(review.length), sub: `${moneyCompact(reviewDollars)} at cost` },
    { label: 'New items in window', info: 'Items in their first 12 weeks since first sale.', value: count(newItems.length), sub: 'First 12 weeks on sale' },
    { label: 'Stores > 1 pt above district', info: "Stores whose loss % is more than 1 pt above their district's loss %.", value: count(stores.length), sub: `of ${count(storeLoss.size)} stores` },
  ];

  const lossFactor = basis === 'cost' ? 1 : lossIncl / Math.max(1, lossExcl);
  const lossChart = lossSeries.map((p) => ({
    x: weekTick(p.week, latestFy),
    value: p.loss * lossFactor,
    ly: p.ly === null ? null : p.ly * lossFactor,
    note: p.flags ? `${p.flags} flagged entr${p.flags > 1 ? 'ies' : 'y'}` : undefined,
  }));
  const lossAvg = lossChart.reduce((a, d) => a + d.value, 0) / Math.max(1, lossChart.length);
  const flagDept = DEPTS.map((d) => {
    const fs = flags.filter((f) => ITEMS[f.item].dept === d.idx);
    return { id: d.idx, label: d.name, value: fs.filter(isEntryError).length, compare: fs.filter((f) => !isEntryError(f)).length, color: C.s2 };
  }).filter((d) => d.value + d.compare > 0);
  const storeBars = stores.slice(0, 30).map((x) => ({
    id: x.store,
    label: `${STORES[x.store].code} · ${STORES[x.store].district}`,
    value: x.lp * 100,
    compare: x.dp * 100,
    tip: [
      { label: 'Store loss %', value: pct(x.lp), color: C.s1 },
      { label: `${STORES[x.store].district} average`, value: pct(x.dp), color: C.ly },
      { label: 'Above district by', value: `${x.gap.toFixed(1)} pts` },
    ],
  }));
  const flagSheet = () => ({
    title: 'Flagged items',
    subtitle: `${describeProductScope(state)} · ${describeStoreScope(state)} · ${weeklyRange}`,
    head: ['Rank', 'Item', 'Code', 'Store', 'District', 'Week', 'Known loss $ (cost)', 'Loss units', 'UoM', 'Typical weekly units', 'Times average', 'High Loss Flag'],
    rows: flags.map((f, n) => {
      const it = ITEMS[f.item];
      const st = STORES[f.store];
      return [n + 1, it.name, it.code, st.code, st.district, weekLabel(f.week), Math.round(f.cost * 100) / 100, Math.round(f.units * 10) / 10, it.uom, Math.round(f.avgUnits * 10) / 10, Number.isFinite(f.ratio) ? Math.round(f.ratio * 10) / 10 : null, tierLabel(f)];
    }),
  });

  return (
    <>
      <SectionHeading eyebrow="Known loss" title="Loss Review" question="Where is loss real, where is it an entry error, and what is driving it?">
        {describeProductScope(state)}, {weeklyRange}: Total Loss <b>{moneyCompact(lossIncl)}</b> (excl. errors <b>{moneyCompact(lossExcl)}</b>),{' '}
        <b>{count(errors.length)}</b> likely entry errors and <b>{count(review.length)}</b> high-loss entries to review
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

      <div className="toggle-row">
        <span className="chip status-proposed">Proposed view</span>
        <span className="toggle-label">Flag thresholds</span>
        <StatusChip status="Pending validation" />
      </div>
      <ViewToggles loss flagged />

      <KeyFigures
        caption={`Key figures · ${describeProductScope(state)} · ${describeStoreScope(state)} · ${range.fyLabel} · ${weeklyRange}`}
        tiles={tiles}
        note={
          <>
            High Loss Flag thresholds are workbook open question 3.{' '}
            <button type="button" className="btn-link" onClick={() => openDefinitions('high-loss-flag')}>
              See definitions
            </button>
          </>
        }
      />

      <ChartGrid cols={2}>
        <ChartCard
          title="Known loss by week"
          subtitle={`Last 26 weeks to ${weekTick(range.endWeek, latestFy)} · ${basisWord} · ${state.flagged === 'excl' ? 'entry errors excluded' : 'entry errors included'}`}
          legend={[
            { label: 'This year', color: C.s1, kind: 'rect' },
            { label: 'Last year', color: C.ly },
          ]}
          table={{ head: ['Week', 'Known loss', 'LY', 'Flags'], rows: lossChart.map((d) => [d.x, money(d.value), money(d.ly), d.note ?? '']) }}
        >
          <ColumnsVsLy data={lossChart} format={(v) => money(v)} tickFormat={(v) => moneyCompact(v)} avg={lossAvg} />
        </ChartCard>
        <ChartCard
          title="Flagged entries by department"
          subtitle="Item-store-weeks above the rule · likely entry errors vs high loss to review"
          contentHeight={hbarHeight(flagDept.length, true)}
          legend={[
            { label: 'Likely entry error', color: C.s2, kind: 'rect' },
            { label: 'High loss to review', color: C.s1, kind: 'rect' },
          ]}
          table={{ head: ['Department', 'Likely entry errors', 'High loss to review'], rows: flagDept.map((d) => [d.label, d.value, d.compare]) }}
        >
          <HBars data={flagDept} labelWidth={70} compareLabel="High loss to review" compareColor={C.s1} valueLabel="Likely entry error" format={(v) => count(v)} />
        </ChartCard>
      </ChartGrid>

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
                  {ITEMS[f.item].name} · store {STORES[f.store].code} · {weekLabel(f.week)} · <b>{moneyCompact(f.cost)}</b> <span className="chip error">Likely entry error</span>
                </div>
              ))}
            </div>
          )}
          {ranked.length === 0 ? (
            <p className="empty">No entries meet the rule for the current filters.</p>
          ) : (
            <ol className="flag-list" aria-label="Flagged item-store-weeks">
              {ranked.slice(0, 80).map((f, n) => {
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
                      <span className={`chip ${err ? 'error' : 'amber'}`}>{tierLabel(f)}</span>
                    </div>
                    <div className="flag-rule">{ruleText(f, state.rule.dollars)}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <section className="card side-card" aria-label="Flag rules">
          <h3 className="side-title">
            High Loss Flag rules <StatusChip status="Pending validation" />
          </h3>
          <FlagRulesForm />
        </section>
      </ChartGrid>

      <section className="card side-card" aria-label="New items watch">
        <div className="side-actions">
          <div>
            <h3 className="side-title">New items watch</h3>
            <p className="side-sub">Items in their first 12 weeks since first sale, weekly sales and loss · mirrors the weekly report the Deli team runs</p>
          </div>
          <ExportButton
            fileName="New items watch"
            getSheet={() => ({
              title: 'New items watch',
              subtitle: `${describeStoreScope(state)} · through ${weekLabel(range.endWeek)}`,
              head: ['Item', 'Department', 'First sale', 'Weeks on sale', 'Total Gross Sales', 'Total Loss ($)', 'Loss % of sales'],
              rows: newItems.map((n) => [ITEMS[n.item].name, DEPTS[ITEMS[n.item].dept].name, weekLabel(n.launchWeek), n.weeks, Math.round(n.sales), Math.round(n.loss), pct(lossPctOfSales(n.loss, n.sales))]),
            })}
          />
        </div>
        {newItems.length === 0 ? (
          <p className="empty">No items in their first 12 weeks for the current filters.</p>
        ) : (
          <table className="mini-table">
            <thead>
              <tr>
                <th className="left">Item</th>
                <th className="left">First sale</th>
                <th>Weeks on sale</th>
                <th>Weekly sales</th>
                <th>Total Gross Sales</th>
                <th>Weekly loss</th>
                <th>Total Loss ($)</th>
                <th>Loss %</th>
              </tr>
            </thead>
            <tbody>
              {newItems.map((n) => {
                const it = ITEMS[n.item];
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
                      <Sparkline values={n.weekly.map((x) => x.sales)} />
                    </td>
                    <td>{money(n.sales)}</td>
                    <td>
                      <Sparkline values={n.weekly.map((x) => x.loss)} />
                    </td>
                    <td>{money(n.loss)}</td>
                    <td>{pct(lossPctOfSales(n.loss, n.sales))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <ChartGrid cols={2}>
        <ChartCard
          title="Stores more than 1 pt above their district"
          subtitle={`${weeklyRange} · ${basisWord} · gray bar is the district average`}
          height={360}
          contentHeight={hbarHeight(storeBars.length, true)}
          legend={[
            { label: 'Store loss %', color: C.s1, kind: 'rect' },
            { label: 'District average', color: C.ly, kind: 'rect' },
          ]}
          table={{ head: ['Store', 'Loss %', 'District avg'], rows: storeBars.map((t) => [t.label, `${t.value.toFixed(1)}%`, `${(t.compare ?? 0).toFixed(1)}%`]) }}
        >
          <HBars data={storeBars} labelWidth={84} compareLabel="District average" format={(v) => `${v.toFixed(1)}%`} />
        </ChartCard>
        <section className="card side-card" aria-label="Store ranking">
          <div className="side-actions">
            <div>
              <h3 className="side-title">Store ranking · {count(stores.length)} stores</h3>
              <p className="side-sub">Loss % more than 1 pt above the store’s own district</p>
            </div>
            <ExportButton
              fileName="Store ranking"
              getSheet={() => ({
                title: 'Stores more than 1 pt above their district',
                subtitle: weeklyRange,
                head: ['Store', 'District', 'Total Gross Sales', 'Total Loss ($)', 'Loss %', 'District loss %', 'Above district (pts)'],
                rows: stores.map((x) => [STORES[x.store].code, STORES[x.store].district, Math.round(x.sales), Math.round(x.loss), pct(x.lp), pct(x.dp), Math.round(x.gap * 10) / 10]),
              })}
            />
          </div>
          <div className="po-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th className="left">Store</th>
                  <th>Sales</th>
                  <th>Total Loss ($)</th>
                  <th>Loss %</th>
                  <th>District</th>
                  <th>Above by</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((x) => (
                  <tr key={x.store}>
                    <td className="left">
                      Store {STORES[x.store].code} <span className="code-tag">{STORES[x.store].district}</span>
                    </td>
                    <td>{moneyCompact(x.sales)}</td>
                    <td>{money(x.loss)}</td>
                    <td>{pct(x.lp)}</td>
                    <td>{pct(x.dp)}</td>
                    <td>+{x.gap.toFixed(1)} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </ChartGrid>
    </>
  );
}
