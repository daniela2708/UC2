/* eslint-disable react-refresh/only-export-components -- provider, hook and modal belong together */
import { Calculator, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LAST_COMPLETE_WEEK } from '../data/calendar';
import { getModel, NW } from '../data/generate';
import { ITEMS } from '../data/products';
import { currentPoCost, newPoCost, recipeCost, recipeLines } from '../data/purchasing';
import { moneyUnit, pct } from '../lib/format';
import { clampSimInput, pointsDiff, safeDiv, simulateCostChange } from '../lib/kpis';
import { Impact, Var } from './ui';
import { belowTarget, catBand } from '../data/targets';

const SimContext = createContext<(item: number) => void>(() => undefined);

export function useSimulator() {
  return useContext(SimContext);
}

export function SimulatorProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<number | null>(null);
  const open = useCallback((i: number) => setItem(i >= 0 && i < ITEMS.length ? i : null), []);
  return (
    <SimContext.Provider value={open}>
      {children}
      {item !== null && <SimulatorModal key={item} item={item} onClose={() => setItem(null)} />}
    </SimContext.Provider>
  );
}

/** Small icon button to open the simulator for an item (used on table rows). */
export function SimulateButton({ item, label = 'Simulate cost change' }: { item: number; label?: string }) {
  const open = useSimulator();
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={`${label}: ${ITEMS[item].name}`}
      onClick={(e) => {
        e.stopPropagation();
        open(item);
      }}
    >
      <Calculator size={14} />
    </button>
  );
}

function trailingUnits(i: number): number {
  const m = getModel();
  let u = 0;
  for (let w = Math.max(0, LAST_COMPLETE_WEEK - 51); w <= LAST_COMPLETE_WEEK; w++) u += m.units[i * NW + w];
  return u;
}

function currentRetail(i: number): number {
  const m = getModel();
  let s = 0;
  let u = 0;
  for (let w = LAST_COMPLETE_WEEK - 3; w <= LAST_COMPLETE_WEEK; w++) {
    s += m.sales[i * NW + w];
    u += m.units[i * NW + w];
  }
  return safeDiv(s, u) ?? m.retail[i * NW + LAST_COMPLETE_WEEK];
}

function SimulatorModal({ item, onClose }: { item: number; onClose: () => void }) {
  const it = ITEMS[item];
  const unit = it.uom;
  const cost = currentPoCost(item);
  const retail = Math.round(currentRetail(item) * 100) / 100;
  const prefill = newPoCost(item) ?? cost;
  const lines = useMemo(() => (it.composite ? recipeLines(it) : []), [it]);
  const [newCostText, setNewCostText] = useState(prefill.toFixed(2));
  const [retailText, setRetailText] = useState('');
  const [comp, setComp] = useState(lines[0]?.key ?? '');
  const [compText, setCompText] = useState(lines[0] ? lines[0].newUnitCost.toFixed(lines[0].newUnitCost < 1 ? 3 : 2) : '');
  const closeRef = useRef<HTMLButtonElement>(null);
  const annualUnits = useMemo(() => trailingUnits(item), [item]);
  const band = catBand(it.cat);
  const sharedCount = it.composite ? ITEMS.filter((x) => x.idx !== item && x.composite?.components.some((c) => c.key === comp)).length : 0;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // For composite PLUs, one component's new cost recomputes the PLU cost from the recipe.
  const compCost = it.composite ? (/^\s*\d{1,6}(\.\d{1,3})?\s*$/.test(compText) && Number(compText) > 0 ? Number(compText) : null) : null;
  const newCost = it.composite ? (compCost === null ? null : recipeCost(lines, { key: comp, unitCost: compCost })) : clampSimInput(newCostText);
  const newRetail = retailText.trim() === '' ? null : clampSimInput(retailText);
  const invalid = newCost === null || (retailText.trim() !== '' && newRetail === null);
  const r = invalid ? null : simulateCostChange({ cost, retail, newCost: newCost!, newRetail, annualUnits });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="sim-modal" role="dialog" aria-modal="true" aria-labelledby="sim-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-title-row">
          <h2 id="sim-title">Simulate cost change</h2>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close simulator" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="side-sub">
          {it.code} · {it.name} · per {unit}
        </p>
        <div className="banner note" role="note">
          Simulation only. Nothing is saved or sent to any system.
        </div>
        <div className="sim-grid">
          <div className="sim-inputs">
            {it.composite ? (
              <>
                <label className="field-label" htmlFor="sim-comp">
                  Ingredient
                </label>
                <select
                  id="sim-comp"
                  className="text-input"
                  value={comp}
                  onChange={(e) => {
                    const l = lines.find((x) => x.key === e.target.value);
                    setComp(e.target.value);
                    if (l) setCompText(l.newUnitCost.toFixed(l.newUnitCost < 1 ? 3 : 2));
                  }}
                >
                  {lines.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.name} ({Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(2)} {l.unit} per unit)
                    </option>
                  ))}
                </select>
                <label className="field-label" htmlFor="sim-comp-cost">
                  New ingredient cost ($ / {lines.find((l) => l.key === comp)?.unit})
                </label>
                <input id="sim-comp-cost" className="text-input" inputMode="decimal" maxLength={10} value={compText} onChange={(e) => setCompText(e.target.value.slice(0, 10))} />
                <p className="side-sub">
                  PLU cost recomputed from the recipe: {moneyUnit(newCost)}. The ingredient is in {sharedCount} other PLU recipe{sharedCount === 1 ? '' : 's'}; the Ingredients View shows
                  them all (Where used).
                </p>
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="sim-cost">
                  New cost per {unit} (prefilled with the Real-time PO Cost)
                </label>
                <input id="sim-cost" className="text-input" inputMode="decimal" maxLength={9} value={newCostText} onChange={(e) => setNewCostText(e.target.value.slice(0, 9))} />
              </>
            )}
            <label className="field-label" htmlFor="sim-retail">
              New retail per {unit} (optional)
            </label>
            <input
              id="sim-retail"
              className="text-input"
              inputMode="decimal"
              maxLength={9}
              placeholder={`Current ${moneyUnit(retail)}`}
              value={retailText}
              onChange={(e) => setRetailText(e.target.value.slice(0, 9))}
            />
            {invalid && (
              <p className="access-error" role="alert">
                Enter a positive amount with up to 6 digits and 2 decimals.
              </p>
            )}
          </div>
          <table className="mini-table sim-out">
            <tbody>
              <tr>
                <td className="left">Current cost · retail</td>
                <td>
                  {moneyUnit(cost)} · {moneyUnit(retail)}
                </td>
              </tr>
              <tr>
                <td className="left">Gross Margin Rate today</td>
                <td>{pct(r?.marginNow)}</td>
              </tr>
              <tr>
                <td className="left">At current retail with the new cost</td>
                <td>
                  {pct(r?.marginNewCost)} <Var value={r ? pointsDiff(r.marginNewCost, r.marginNow) : null} />
                </td>
              </tr>
              <tr>
                <td className="left">Target band (Proposed)</td>
                <td>
                  {(band.lo * 100).toFixed(0)}–{(band.hi * 100).toFixed(0)} %{r && belowTarget(r.marginNewCost, band) && <span className="cell-sub">New cost puts it below target</span>}
                </td>
              </tr>
              <tr>
                <td className="left">Retail needed to hold the margin (.x9)</td>
                <td>{moneyUnit(r?.retailToHold)}</td>
              </tr>
              <tr>
                <td className="left">Annual units (trailing 52 weeks)</td>
                <td>
                  {Math.round(annualUnits).toLocaleString('en-US')} {unit}
                </td>
              </tr>
              <tr className="total">
                <td className="left">Annual cost change</td>
                <td>
                  <Impact value={r ? r.annualCostChange : null} kind="cost" />
                </td>
              </tr>
              <tr className="total">
                <td className="left">Margin impact · no retail change</td>
                <td>
                  <Impact value={r ? r.impactNoRetailChange : null} kind="margin" />
                </td>
              </tr>
              <tr className="total">
                <td className="left">Margin impact · {newRetail !== null ? `retail ${moneyUnit(newRetail)}` : 'retail to hold the margin'}</td>
                <td>
                  <Impact value={r ? r.impactWithRetailChange : null} kind="margin" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
