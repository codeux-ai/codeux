import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';

interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const toggleOption = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const selectedOptions = options.filter((opt) => value.includes(opt.value));

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[0.95rem] border border-black/[0.06] bg-transparent px-3 py-1.5 text-xs text-slate-500 outline-none transition-colors focus-within:border-signal-500 cursor-pointer dark:border-white/[0.07] dark:text-slate-300"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-slate-400">{placeholder}</span>
        ) : (
          selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-white/[0.1] dark:text-slate-200"
              onClick={(e) => {
                e.stopPropagation();
                toggleOption(opt.value);
              }}
            >
              {opt.label}
              <span className="text-slate-400 hover:text-slate-900 dark:hover:text-white">&times;</span>
            </span>
          ))
        )}
      </div>

      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg dark:border-white/[0.08] dark:bg-void-800">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">No options</div>
          ) : (
            options.map((option) => {
              const isSelected = value.includes(option.value);
              return (
                <div
                  key={option.value}
                  className={`flex cursor-pointer items-center px-3 py-2 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.05] ${
                    isSelected ? 'bg-signal-500/10 text-signal-700 dark:text-signal-400' : 'text-slate-700 dark:text-slate-300'
                  }`}
                  onClick={() => toggleOption(option.value)}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="mr-2 h-3 w-3 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                  />
                  {option.label}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
