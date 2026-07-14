/* istanbul ignore file */
import { h } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useState, useRef, useEffect, useLayoutEffect } from "preact/hooks";
import { Boxes, CheckSquare, Download, FileText, Github, Gitlab, Layers, ListTodo, Palette, Shapes } from "lucide-preact";
import { JiraIcon } from "../icons/JiraIcon.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

interface SprintImportMenuProps {
  disabled?: boolean;
  onImportMarkdown: () => void;
  onImportGitHubIssues: () => void;
  onImportGitLabIssues: () => void;
  onImportJira?: () => void;
  onImportNotion?: () => void;
  onImportAsana?: () => void;
  onImportLinear?: () => void;
  onImportMiro?: () => void;
  onImportLucid?: () => void;
  onImportFigma?: () => void;
  onImportMural?: () => void;
}

export const SprintImportMenu = ({
  disabled,
  onImportMarkdown,
  onImportGitHubIssues,
  onImportGitLabIssues,
  onImportJira,
  onImportNotion,
  onImportAsana,
  onImportLinear,
  onImportMiro,
  onImportLucid,
  onImportFigma,
  onImportMural,
}: SprintImportMenuProps) => {
  const { translate } = useDashboardI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [menuId] = useState(() => `menu-${Math.random().toString(36).substr(2, 9)}`);

  const calculateMenuPosition = useCallback((): { top: number; left: number } | null => {
    if (!triggerRef.current) {
      return null;
    }
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 288;
    const menuHeight = menuRef.current?.getBoundingClientRect().height ?? 420;
    const viewportPadding = 16;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - menuWidth),
      maxLeft,
    );
    const top = Math.min(
      triggerRect.bottom + 8,
      maxTop,
    );
    return { top, left };
  }, []);

  const updateMenuPosition = useCallback(() => {
    const nextPosition = calculateMenuPosition();
    if (nextPosition) {
      setMenuPosition(nextPosition);
    }
  }, [calculateMenuPosition]);

  const handleTriggerClick = useCallback(() => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const nextPosition = calculateMenuPosition();
    if (nextPosition) {
      setMenuPosition(nextPosition);
    }
    setIsOpen(true);
  }, [calculateMenuPosition, isOpen]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current
        && !containerRef.current.contains(target)
        && (!menuRef.current || !menuRef.current.contains(target))
      ) {
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
      updateMenuPosition();
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleEscapeKey);
      window.addEventListener("resize", updateMenuPosition);
      window.addEventListener("scroll", updateMenuPosition, { capture: true, passive: true });
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscapeKey);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, { capture: true });
    };
  }, [isOpen, updateMenuPosition]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateMenuPosition();
    }
  }, [isOpen, updateMenuPosition]);

  return (
    <div className="relative inline-block w-full sm:w-auto" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white sm:w-auto sm:px-4"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
        {translate(sprintsMessages, "import")}
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          id={menuId}
          className="fixed z-[9999] max-h-[calc(100vh-2rem)] w-72 origin-top overflow-y-auto rounded-[1.2rem] border border-black/[0.08] bg-white p-2 shadow-[0_18px_38px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.03] dark:border-white/[0.08] dark:bg-void-800 dark:ring-white/[0.03]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
        <div className="flex flex-col gap-1">
          <MenuSectionLabel label={translate(sprintsMessages, "sprintSources")} />
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
                {translate(sprintsMessages, "structuredSprintBundle")}
              </span>
            </div>
          </button>

          <MenuSectionLabel label={translate(sprintsMessages, "issueWorkItemImports")} />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportGitHubIssues();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900/[0.07] text-slate-800 transition-transform group-hover:scale-110 group-hover:bg-slate-900/[0.12] dark:bg-white/[0.08] dark:text-white">
              <Github className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                {translate(sprintsMessages, "githubIssues")}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "githubIssuesDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportGitLabIssues();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-500/10 text-ember-600 transition-transform group-hover:scale-110 group-hover:bg-ember-500/20 dark:text-ember-400">
              <Gitlab className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                {translate(sprintsMessages, "gitlabIssues")}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "gitlabIssuesDescription")}
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
                {translate(sprintsMessages, "jiraIssues")}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "jiraIssuesDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportNotion?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900/[0.07] text-slate-800 transition-transform group-hover:scale-110 group-hover:bg-slate-900/[0.12] dark:bg-white/[0.08] dark:text-white">
              <FileText className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Notion
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "notionDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportAsana?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FC636B]/10 text-[#B42334] transition-transform group-hover:scale-110 group-hover:bg-[#FC636B]/20 dark:text-[#FDA4AF]">
              <CheckSquare className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Asana
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "asanaDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportLinear?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5E6AD2]/10 text-[#3F46A3] transition-transform group-hover:scale-110 group-hover:bg-[#5E6AD2]/20 dark:text-[#B8BCF8]">
              <ListTodo className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Linear
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "linearDescription")}
              </span>
            </div>
          </button>

          <MenuSectionLabel label={translate(sprintsMessages, "canvasImports")} />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportMiro?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFD02F]/15 text-[#835B00] transition-transform group-hover:scale-110 group-hover:bg-[#FFD02F]/25 dark:text-[#FFE08A]">
              <Shapes className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Miro
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "miroDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportLucid?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF7A1A]/10 text-[#B64A00] transition-transform group-hover:scale-110 group-hover:bg-[#FF7A1A]/20 dark:text-[#FDBA74]">
              <Boxes className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Lucid
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "lucidDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportFigma?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#A259FF]/10 text-[#6D28D9] transition-transform group-hover:scale-110 group-hover:bg-[#A259FF]/20 dark:text-[#D8B4FE]">
              <Palette className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Figma / FigJam
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "figmaDescription")}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onImportMural?.();
            }}
            className="group flex w-full items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#12B3A8]/10 text-[#0F766E] transition-transform group-hover:scale-110 group-hover:bg-[#12B3A8]/20 dark:text-[#67E8F9]">
              <Layers className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-xs font-bold text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-white">
                Mural
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {translate(sprintsMessages, "muralDescription")}
              </span>
            </div>
          </button>
        </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

const MenuSectionLabel = ({ label }: { label: string }) => (
  <div className="px-3 pb-1 pt-2 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
    {label}
  </div>
);
