/* istanbul ignore file */
import { h } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { Download, FileText, Github, Gitlab } from "lucide-preact";
import { JiraIcon } from "../icons/JiraIcon.js";

interface SprintImportMenuProps {
  disabled?: boolean;
  onImportMarkdown: () => void;
  onImportIssues: () => void;
  onImportJira?: () => void;
}

export const SprintImportMenu = ({ disabled, onImportMarkdown, onImportIssues, onImportJira }: SprintImportMenuProps) => {
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
        className={`absolute bottom-[calc(100%+0.5rem)] right-0 z-[200] w-72 transform origin-bottom overflow-hidden rounded-[1.2rem] border border-black/[0.08] bg-white p-2 shadow-[0_18px_38px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.03] transition-all duration-300 dark:border-white/[0.08] dark:bg-void-800 dark:ring-white/[0.03] ${
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
                Structured sprint and task bundle
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportIssues();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900/[0.07] text-slate-800 transition-transform group-hover:scale-110 group-hover:bg-slate-900/[0.12] dark:bg-white/[0.08] dark:text-white">
              <Github className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                GitHub Issues
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Search, filter, and multi-select
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportIssues();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-500/10 text-ember-600 transition-transform group-hover:scale-110 group-hover:bg-ember-500/20 dark:text-ember-400">
              <Gitlab className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                GitLab Issues
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Import issue scope from GitLab
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportJira?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0052CC]/10 text-[#0052CC] transition-transform group-hover:scale-110 group-hover:bg-[#0052CC]/20 dark:bg-[#4C9AFF]/10 dark:text-[#4C9AFF] dark:group-hover:bg-[#4C9AFF]/20">
              <JiraIcon className="h-4 w-4" />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Jira Issues
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Import issue scope from Jira
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
