import { Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { ITEMS } from '../data/products';
import { sanitizeSearch, searchItems, SEARCH_MAX } from '../lib/filters';
import { Field } from './ui';

export function SkuSearch({
  item,
  onSelect,
  disabledReason,
}: {
  item: number;
  onSelect: (item: number) => void;
  disabledReason?: string | null;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const results = useMemo(() => searchItems(text), [text]);
  const selected = item >= 0 ? ITEMS[item] : null;

  const choose = (i: number) => {
    onSelect(i);
    setText('');
    setOpen(false);
  };

  return (
    <Field label="SKU / PLU" disabledReason={disabledReason} htmlFor={`${id}-input`}>
      <div className="typeahead">
        <Search size={14} aria-hidden="true" />
        <input
          id={`${id}-input`}
          className="text-input"
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && results.length ? `${id}-opt-${active}` : undefined}
          placeholder={selected ? `${selected.code} · ${selected.name}` : 'Search number or name'}
          maxLength={SEARCH_MAX}
          disabled={!!disabledReason}
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
        {(selected || text) && !disabledReason && (
          <button
            type="button"
            className="clear-btn"
            aria-label="Clear SKU / PLU"
            onClick={() => {
              setText('');
              onSelect(-1);
            }}
          >
            <X size={14} />
          </button>
        )}
        {open && results.length > 0 && (
          <ul className="typeahead-list" role="listbox" id={`${id}-list`}>
            {results.map((i, n) => (
              <li
                key={i}
                id={`${id}-opt-${n}`}
                role="option"
                aria-selected={n === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                <span>{ITEMS[i].name}</span>
                <span className="code">{ITEMS[i].code}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
