import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, ListChecks, Target } from "lucide-preact";
import type { Sprint } from "../../types.js";
import { formatSprintDisplay } from "../../lib/format-sprint.js";
import { buildTaskBoardSprintScopeState } from "../../lib/tasks/task-board-view-model.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { clampSprintCompletion } from "../../lib/sprint-progress-display.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

export interface TaskBoardSprintSelectorProps {
  sprints: Sprint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  sprintKeyPrefix: string;
  loading: boolean;
}

function formatSprintDate(
  value: string,
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string,
): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : formatDate(parsed, { month: "short", day: "numeric" });
}

export const TaskBoardSprintSelector: FunctionComponent<TaskBoardSprintSelectorProps> = memo(({
  sprints,
  selectedId,
  onSelect,
  sprintKeyPrefix,
  loading,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const interactionTokens = useInteractionTokens();
  const { locale, translate, formatNumber, formatDate } = useOptionalDashboardI18n();
  const listboxId = "tasks-sprint-selector-listbox";
  const statusId = "tasks-sprint-selector-status";
  const selected = selectedId ? sprints.find((sprint: Sprint) => sprint.id === selectedId) : null;
  const selectedLabel = selected ? formatSprintDisplay(selected, sprintKeyPrefix) : null;
  const selectedAnnouncement = selectedLabel
    ? translate(taskMessages, "selectedScopeSprint", { scope: selectedLabel })
    : translate(taskMessages, "selectedScopeAll");
  const scopeState = buildTaskBoardSprintScopeState({
    sprints,
    selectedSprintId: selectedId,
    selectedSprintLabel: selectedLabel,
    loading,
    locale,
  });
  const options = useMemo(() => [
    {
      id: null as string | null,
      label: translate(taskMessages, "allSprints"),
      description: translate(taskMessages, "projectWideTaskScope"),
      sprint: null as Sprint | null,
      completion: 0,
    },
    ...sprints.map((sprint) => {
      const completion = clampSprintCompletion(sprint.completion);
      return {
        id: sprint.id,
        label: formatSprintDisplay(sprint, sprintKeyPrefix),
        description: translate(taskMessages, "sprintOptionDescription", {
          date: formatSprintDate(sprint.date, formatDate),
          tasks: `${formatNumber(sprint.tasksCount)} ${locale === "de" ? (sprint.tasksCount === 1 ? "Aufgabe" : "Aufgaben") : (sprint.tasksCount === 1 ? "task" : "tasks")}`,
          percent: formatNumber(completion),
        }),
        sprint,
        completion,
      };
    }),
  ], [formatDate, formatNumber, locale, sprints, sprintKeyPrefix, translate]);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));

  const closeListbox = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  const focusOption = useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(options.length - 1, index));
    setActiveIndex(nextIndex);
    const option = optionRefs.current[nextIndex];
    if (option) {
      option.focus({ preventScroll: true });
    } else {
      requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus({ preventScroll: true }));
    }
  }, [options.length]);

  const openListbox = useCallback((index = selectedIndex) => {
    setOpen(true);
    focusOption(index);
  }, [focusOption, selectedIndex]);

  const selectOption = useCallback((id: string | null) => {
    onSelect(id);
    closeListbox(true);
  }, [closeListbox, onSelect]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeListbox(false);
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeListbox(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [closeListbox, open]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(selectedIndex);
    }
  }, [open, selectedIndex]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    optionRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, open]);

  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openListbox(selectedIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openListbox(options.length - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      openListbox(0);
    } else if (event.key === "End") {
      event.preventDefault();
      openListbox(options.length - 1);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent, index: number, id: string | null) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeListbox(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(id);
    } else if (event.key === "Tab") {
      closeListbox(false);
    }
  };

  return (
    <div
      className="relative"
      ref={rootRef}
      style={{
        "--task-sprint-control-duration": interactionTokens.controlFeedback.duration,
        "--task-sprint-control-ease": interactionTokens.controlFeedback.ease,
        "--task-sprint-selection-duration": interactionTokens.selectionMovement.duration,
        "--task-sprint-selection-ease": interactionTokens.selectionMovement.ease,
        "--task-sprint-list-reveal-duration": interactionTokens.listReveal.duration,
        "--task-sprint-list-reveal-ease": interactionTokens.listReveal.ease,
        "--task-sprint-list-reorder-duration": interactionTokens.listReorder.duration,
        "--task-sprint-list-reorder-ease": interactionTokens.listReorder.ease,
      }}
      data-motion-control="controlFeedback"
      data-motion-selection="selectionMovement"
      data-motion-list-reveal="listReveal"
      data-motion-list-reorder="listReorder"
    >
      <div id={statusId} className="sr-only" aria-live="polite" aria-atomic="true">
        {open ? translate(taskMessages, "scopeListOpen", { description: scopeState.description }) : `${selectedAnnouncement} ${scopeState.description}`}
      </div>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-describedby={statusId}
        aria-busy={loading}
        aria-label={translate(taskMessages, "taskSprintScopeValue", { scope: scopeState.label })}
        onClick={() => {
          if (open) {
            closeListbox(false);
          } else {
            openListbox(selectedIndex);
          }
        }}
        onKeyDown={(event) => handleTriggerKeyDown(event as KeyboardEvent)}
        style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
        className={`group flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all min-w-0 max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
          selected
            ? "bg-ember-500/[0.06] dark:bg-ember-500/[0.08] border-ember-500/20 dark:border-ember-500/25 shadow-[0_0_20px_rgba(255,184,0,0.06)]"
            : "bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06]"
        } hover:border-ember-500/40 dark:hover:border-ember-500/40`}
      >
        <Target className={`w-4 h-4 shrink-0 ${selected || open ? "text-ember-500" : "text-slate-400"} transition-colors`} strokeWidth={2} />
        <span className={`text-sm font-bold tracking-tight truncate min-w-0 ${selected ? "text-ember-600 dark:text-ember-400" : "text-slate-600 dark:text-slate-400"}`}>
          {scopeState.label}
        </span>
        <span className={`hidden rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] sm:inline-flex ${
          scopeState.isLoading
            ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:text-signal-400"
            : scopeState.isScoped
              ? "border-ember-500/25 bg-ember-500/[0.08] text-ember-600 dark:text-ember-400"
              : "border-black/[0.06] bg-black/[0.03] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
        }`}>
          {translate(taskMessages, scopeState.isLoading ? "loading" : scopeState.isScoped ? "selected" : scopeState.isEmpty ? "empty" : "all")}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={translate(taskMessages, "taskSprintScope")}
          aria-activedescendant={`tasks-sprint-option-${activeIndex}`}
          aria-busy={loading}
          style={{ transitionDuration: interactionTokens.listReveal.duration, transitionTimingFunction: interactionTokens.listReveal.ease }}
          className="absolute left-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] z-50 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col max-h-[60vh] motion-reduce:transition-none"
          data-motion-contract="listReveal"
        >
          <button
            id="tasks-sprint-option-0"
            ref={(node) => { optionRefs.current[0] = node; }}
            type="button"
            role="option"
            aria-selected={!selectedId}
            tabIndex={0}
            onClick={() => selectOption(null)}
            onKeyDown={(event) => handleOptionKeyDown(event as KeyboardEvent, 0, null)}
            style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
            className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 ${
              !selectedId ? "bg-signal-500/[0.06] dark:bg-signal-500/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            }`}
          >
            <ListChecks className="w-4 h-4 text-signal-500" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-bold text-slate-800 dark:text-white">{translate(taskMessages, "allSprints")}</span>
              <span className="block truncate text-[9px] font-mono uppercase tracking-[0.1em] text-slate-400">{translate(taskMessages, "projectWideScope")}</span>
            </div>
            {!selectedId && <span className="rounded-full bg-signal-500/[0.1] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-signal-600 dark:text-signal-400">{translate(taskMessages, "selected")}</span>}
          </button>

          <div className="h-px bg-black/[0.04] dark:bg-white/[0.04] shrink-0" />

          <div
            className="overflow-y-auto min-h-0"
            style={{ transitionDuration: interactionTokens.listReorder.duration, transitionTimingFunction: interactionTokens.listReorder.ease }}
            data-motion-contract="listReorder"
          >
            {loading && (
              <div role="status" className="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                {translate(taskMessages, "loadingSprintScopes")}
              </div>
            )}
            {!loading && sprints.length === 0 && (
              <div role="status" className="px-5 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                {translate(taskMessages, "noSprintScopes")}
              </div>
            )}
            {sprints.map((sprint, sprintIndex) => {
              const index = sprintIndex + 1;
              const isActive = selectedId === sprint.id;
              return (
                <button
                  key={sprint.id}
                  id={`tasks-sprint-option-${index}`}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  onClick={() => selectOption(sprint.id)}
                  onKeyDown={(event) => handleOptionKeyDown(event as KeyboardEvent, index, sprint.id)}
                  style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                  className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/40 ${
                    isActive ? "bg-ember-500/[0.06] dark:bg-ember-500/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <div
                    aria-hidden="true"
                    data-sprint-status-dot={sprint.status}
                    className={`w-2 h-2 rounded-full shrink-0 ${
                    sprint.status === "running" ? "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)] motion-safe:animate-pulse motion-reduce:animate-none motion-reduce:ring-2 motion-reduce:ring-status-green/25" :
                    sprint.status === "paused" ? "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.45)]" :
                    sprint.status === "completed" ? "bg-signal-500" :
                    sprint.status === "failed" ? "bg-status-red" :
                    sprint.status === "cancelled" ? "bg-slate-400 dark:bg-slate-500" :
                    "bg-slate-400 dark:bg-slate-600"
                  }`}
                  />
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className={`text-sm font-bold tracking-tight truncate min-w-0 ${isActive ? "text-ember-600 dark:text-ember-400" : "text-slate-800 dark:text-white"}`}>
                      {formatSprintDisplay(sprint, sprintKeyPrefix)}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.1em] truncate min-w-0">{formatSprintDate(sprint.date, formatDate)}</span>
                      <span className="sr-only">{options[index].description}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0 pl-2">
                    {isActive && <span className="rounded-full bg-ember-500/[0.1] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-ember-600 dark:text-ember-400">{translate(taskMessages, "selected")}</span>}
                    <span className="text-[10px] font-mono font-bold text-slate-500">{formatNumber(sprint.tasksCount)}</span>
                    <div className="w-12 h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full bg-signal-500 transition-all duration-500" style={{ width: `${options[index].completion}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
