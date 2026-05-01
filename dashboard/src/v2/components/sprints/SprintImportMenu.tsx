/* istanbul ignore file */
import { h } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { Download, FileText, Trello } from "lucide-preact";

interface SprintImportMenuProps {
  disabled?: boolean;
  onImportMarkdown: () => void;
}

export const SprintImportMenu = ({ disabled, onImportMarkdown }: SprintImportMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuId] = useState(() => `menu-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        containerRef.current?.querySelector("button")?.focus();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleEscapeKey);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
        Import
      </button>

      <div
        role="menu"
        id={menuId}
        className={`absolute bottom-[calc(100%+0.5rem)] right-0 z-[200] w-56 transform origin-bottom overflow-hidden rounded-[1.2rem] border border-black/[0.08] bg-white p-2 shadow-[0_18px_38px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.03] transition-all duration-300 dark:border-white/[0.08] dark:bg-void-800 dark:ring-white/[0.03] ${
          isOpen
            ? "translate-y-0 scale-100 opacity-100 pointer-events-auto"
            : "translate-y-4 scale-95 opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex flex-col gap-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportMarkdown();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal-500/10 text-signal-600 transition-transform group-hover:scale-110 group-hover:bg-signal-500/20 dark:text-signal-500">
              <FileText className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Markdown
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Import from text bundle
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0052CC]/10 text-[#0052CC] transition-transform group-hover:scale-110 group-hover:bg-[#0052CC]/20 dark:bg-[#4C9AFF]/10 dark:text-[#4C9AFF]">
              <Trello className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Jira
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Connect your backlog
              </span>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-500 dark:bg-void-900 dark:text-slate-400">
              Soon
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
