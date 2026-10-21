import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { COST_TYPE_LABEL, ITEMS } from '../data/products';
import { sanitizeSearch, SEARCH_MAX } from '../lib/filters';
import { Field } from './ui';

/** One-item picker (typeahead over a fixed list) for views that show a single SKU or PLU. */
export function ItemPicker({ list, value, onChange, label = 'SKU / PLU (required)' }: { list: number[]; value: number; onChange: (i: number) => void; label?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const q = text.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 1) return list.slice(0, 12);
    return list.filter((i) => ITEMS[i].code.startsWith(q) || ITEMS[i].name.toLowerCase().includes(q)).slice(0, 12);
  }, [q, list]);
  const sel = value >= 0 ? ITEMS[value] : null;
  const choose = (i: number) => {
    onChange(i);
    setText('');
    setOpen(false);
  };
  return (
    <Field label={label} htmlFor={`${id}-in`}>
      <div className="typeahead item-picker">
        <Search size={14} aria-hidden="true" />
        <input
          id={`${id}-in`}
          className="text-input"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && results.length ? `${id}-o${active}` : undefined}
          placeholder={sel ? `${sel.code} · ${sel.name}` : 'Search number or name'}
          maxLength={SEARCH_MAX}
          value={text}
          onChange={(e) => {
            setText(sanitizeSearch(e.target.value));
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && results[active] !== undefined) {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && results.length > 0 && (
          <ul className="typeahead-list" role="listbox" id={`${id}-list`}>
            {results.map((i, n) => (
              <li
                key={i}
                id={`${id}-o${n}`}
                role="option"
                aria-selected={n === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                <span>
                  {ITEMS[i].name} <span className="chip neutral">{COST_TYPE_LABEL[ITEMS[i].costType]}</span>
                </span>
                <span className="code">{ITEMS[i].code}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
