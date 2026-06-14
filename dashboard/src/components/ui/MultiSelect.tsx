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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeIndexRef = useRef<number>(-1);
  const [listboxId] = useState(() => 'ms-' + Math.random().toString(36).slice(2, 7));

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
      <button
        type="button"
        ref={triggerRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[0.95rem] border border-black/[0.06] bg-transparent px-3 py-1.5 text-xs text-slate-500 outline-none transition-colors focus-within:border-signal-500 cursor-pointer dark:border-white/[0.07] dark:text-slate-300"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            setIsOpen(true);
            setTimeout(() => {
              activeIndexRef.current = 0;
              const firstOption = containerRef.current?.querySelector('[role="option"]') as HTMLElement;
              firstOption?.focus();
            }, 0);
          } else if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-slate-400">{placeholder}</span>
        ) : (
          selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-white/[0.1] dark:text-slate-200"
            >
              {opt.label}
              <button
                type="button"
                aria-label={`Remove ${opt.label}`}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOption(opt.value);
                }}
              >
                &times;
              </button>
            </span>
          ))
        )}
      </button>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg dark:border-white/[0.08] dark:bg-void-800"
          onKeyDown={(e) => {
            if (!isOpen) return;

            const items = containerRef.current?.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>;
            if (!items || items.length === 0) return;

            if (e.key === 'ArrowDown') {
              e.preventDefault();
              activeIndexRef.current = (activeIndexRef.current + 1) % items.length;
              items[activeIndexRef.current]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              activeIndexRef.current = activeIndexRef.current - 1 < 0 ? items.length - 1 : activeIndexRef.current - 1;
              items[activeIndexRef.current]?.focus();
            } else if (e.key === 'Home') {
              e.preventDefault();
              activeIndexRef.current = 0;
              items[activeIndexRef.current]?.focus();
            } else if (e.key === 'End') {
              e.preventDefault();
              activeIndexRef.current = items.length - 1;
              items[activeIndexRef.current]?.focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (activeIndexRef.current >= 0 && activeIndexRef.current < options.length) {
                toggleOption(options[activeIndexRef.current].value);
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setIsOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">No options</div>
          ) : (
            options.map((option) => {
              const isSelected = value.includes(option.value);
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  className={`flex cursor-pointer items-center px-3 py-2 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.05] outline-none focus:bg-black/[0.04] dark:focus:bg-white/[0.05] ${
                    isSelected ? 'bg-signal-500/10 text-signal-700 dark:text-signal-400' : 'text-slate-700 dark:text-slate-300'
                  }`}
                  onClick={() => toggleOption(option.value)}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    aria-hidden="true"
                    tabIndex={-1}
                    className="mr-2 h-3 w-3 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                    onChange={() => {}}
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
