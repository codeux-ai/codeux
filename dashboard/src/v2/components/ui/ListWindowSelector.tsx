import type { FunctionComponent } from "preact";
import { type ListWindowOption, LIST_WINDOW_OPTIONS } from "../../lib/list-window.js";
import { ChevronDown, ListFilter } from "lucide-preact";
import { useState, useRef, useEffect } from "preact/hooks";

interface ListWindowSelectorProps {
  value: ListWindowOption;
  onChange: (value: ListWindowOption) => void;
  label?: string;
}

export const ListWindowSelector: FunctionComponent<ListWindowSelectorProps> = ({
  value,
  onChange,
  label = "Show",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-slate-600 transition-colors hover:border-signal-500/50 hover:bg-signal-500/[0.02] dark:border-white/[0.06] dark:bg-void-900 dark:text-slate-300 dark:hover:border-signal-500/50"
      >
        <ListFilter className="h-3.5 w-3.5 opacity-60" />
        <span className="opacity-60">{label}</span>
        <span className="font-mono">{value}</span>
        <ChevronDown
          className={`h-3 w-3 opacity-50 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-[100] mt-2 w-32 overflow-hidden rounded-xl border border-black/[0.08] bg-white p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:border-white/[0.08] dark:bg-void-900 dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {LIST_WINDOW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                value === option
                  ? "bg-signal-500/10 text-signal-600 dark:bg-signal-500/20 dark:text-signal-400"
                  : "text-slate-600 hover:bg-black/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.03]"
              }`}
            >
              <span className="font-mono">{option}</span>
              {value === option && (
                <span className="h-1.5 w-1.5 rounded-full bg-signal-500" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
