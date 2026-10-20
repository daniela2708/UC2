import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { DISTRICTS, STORES } from '../data/stores';
import { districtsOf } from '../lib/filters';
import { Field } from './ui';

const MAX_QUERY = 12;

export function StorePopover({
  region,
  districts,
  stores,
  onChange,
}: {
  region: number;
  districts: string[];
  stores: number[];
  onChange: (districts: string[], stores: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = districtsOf(region);
  const q = query.replace(/\D/g, '').slice(0, 3);
  const dSet = new Set(districts);
  const sSet = new Set(stores);

  const toggleDistrict = (d: string) => {
    const dist = DISTRICTS.find((x) => x.id === d);
    const ids = new Set(dist?.stores.map((i) => STORES[i].id));
    if (dSet.has(d)) onChange(districts.filter((x) => x !== d), stores);
    else onChange([...districts, d], stores.filter((s) => !ids.has(s)));
  };
  const toggleStore = (sid: number, district: string) => {
    if (dSet.has(district)) {
      // Unticking one store of a ticked district keeps the rest of the district.
      const dist = DISTRICTS.find((x) => x.id === district)!;
      const rest = dist.stores.map((i) => STORES[i].id).filter((x) => x !== sid);
      onChange(districts.filter((x) => x !== district), [...stores, ...rest]);
    } else if (sSet.has(sid)) onChange(districts, stores.filter((x) => x !== sid));
    else onChange(districts, [...stores, sid]);
  };

  const label =
    districts.length === 0 && stores.length === 0
      ? 'All districts & stores'
      : [districts.length ? districts.join(', ') : '', stores.length ? `${stores.length} store${stores.length > 1 ? 's' : ''}` : '']
          .filter(Boolean)
          .join(' + ');
  const selectedCount = STORES.filter((s) => (region === 0 || s.region === region) && (dSet.has(s.district) || sSet.has(s.id))).length;

  return (
    <Field label="District & Store">
      <div className="popover-anchor" ref={ref}>
        <button
          ref={buttonRef}
          type="button"
          className="pop-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <span>{label}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && (
          <div className="popover" role="dialog" aria-label="Choose districts and stores" id={id}>
            <div className="popover-head">
              <input
                className="text-input"
                type="search"
                inputMode="numeric"
                placeholder="Search store number"
                aria-label="Search store number"
                maxLength={MAX_QUERY}
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY))}
              />
            </div>
            <div className="popover-body">
              {q
                ? STORES.filter(
                    (s) => (region === 0 || s.region === region) && s.code.includes(q),
                  ).map((s) => (
                    <label key={s.id} className="check-row">
                      <input type="checkbox" checked={dSet.has(s.district) || sSet.has(s.id)} onChange={() => toggleStore(s.id, s.district)} />
                      Store {s.code} <span className="code-tag">{s.district}</span>
                    </label>
                  ))
                : visible.map((d) => {
                    const isOpen = expanded.has(d.id);
                    return (
                      <div key={d.id}>
                        <div className="check-row district">
                          <button
                            type="button"
                            className="mini-toggle"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} stores in ${d.id}`}
                            onClick={() =>
                              setExpanded((s) => {
                                const n = new Set(s);
                                if (n.has(d.id)) n.delete(d.id);
                                else n.add(d.id);
                                return n;
                              })
                            }
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <label className="check-row" style={{ padding: 0 }}>
                            <input type="checkbox" checked={dSet.has(d.id)} onChange={() => toggleDistrict(d.id)} />
                            {d.id} · Region {d.region} · {d.stores.length} stores
                          </label>
                        </div>
                        {isOpen &&
                          d.stores.map((i) => {
                            const s = STORES[i];
                            return (
                              <label key={s.id} className="check-row store">
                                <input
                                  type="checkbox"
                                  checked={dSet.has(d.id) || sSet.has(s.id)}
                                  onChange={() => toggleStore(s.id, d.id)}
                                />
                                Store {s.code}
                              </label>
                            );
                          })}
                      </div>
                    );
                  })}
            </div>
            <div className="popover-foot">
              <span>{selectedCount ? `${selectedCount} stores selected` : 'All stores in scope'}</span>
              <button type="button" className="btn-link" onClick={() => onChange([], [])}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}
