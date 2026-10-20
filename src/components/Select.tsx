import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { Field } from './ui';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

export function Select({
  label,
  value,
  options,
  onChange,
  disabledReason,
  disabled,
  className,
}: {
  className?: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  disabledReason?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const groups: (string | undefined)[] = [];
  for (const o of options) if (!groups.includes(o.group)) groups.push(o.group);
  const render = (o: SelectOption) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );
  return (
    <Field label={label} disabledReason={disabledReason} htmlFor={id} className={className}>
      <div className="select-wrap">
        <select id={id} value={value} disabled={!!disabledReason || disabled} onChange={(e) => onChange(e.target.value)}>
          {groups.map((g) =>
            g ? (
              <optgroup key={g} label={g}>
                {options.filter((o) => o.group === g).map(render)}
              </optgroup>
            ) : (
              options.filter((o) => !o.group).map(render)
            ),
          )}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </Field>
  );
}
