import React from "react";

interface Option {
  value: string;
  label: React.ReactNode;
}

interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
}

export function Select({ id, value, onChange, options, className }: SelectProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        View
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        >
          {options.map((opt) => (
            <option key={String(opt.value)} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default Select;
