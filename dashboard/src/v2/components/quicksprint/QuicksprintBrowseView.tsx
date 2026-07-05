import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Plus, X, Zap } from "lucide-preact";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { TemplateCard } from "./quicksprint-shared.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import type { BuiltinPurposeOption } from "../../lib/quicksprint-panel-state.js";

const RAIL_SCROLL_STEP_RATIO = 0.88;
const RAIL_MIN_SCROLL_STEP = 320;
const RAIL_ROWS = 2;
const WHEEL_LINE_HEIGHT = 16;

function normalizeWheelDeltaY(event: WheelEvent, fallbackPageHeight: number): number {
  if (event.deltaMode === 1) {
    return event.deltaY * WHEEL_LINE_HEIGHT;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * fallbackPageHeight;
  }
  return event.deltaY;
}

function isVerticalScrollContainer(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight) {
    return false;
  }

  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

function canScrollVertically(element: HTMLElement, deltaY: number): boolean {
  const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
  if (deltaY < 0) {
    return element.scrollTop > 0;
  }
  return element.scrollTop < maxScrollTop - 1;
}

function findVerticalScrollTarget(start: HTMLElement, deltaY: number): HTMLElement | null {
  let current = start.parentElement;
  while (current) {
    if (isVerticalScrollContainer(current) && canScrollVertically(current, deltaY)) {
      return current;
    }
    current = current.parentElement;
  }

  const documentScroller = document.scrollingElement;
  if (
    documentScroller instanceof HTMLElement
    && documentScroller.scrollHeight > documentScroller.clientHeight
    && canScrollVertically(documentScroller, deltaY)
  ) {
    return documentScroller;
  }

  return null;
}

function scrollElementByDeltaY(element: HTMLElement, deltaY: number): void {
  const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
  const nextScrollTop = Math.min(maxScrollTop, Math.max(0, element.scrollTop + deltaY));
  element.scrollTop = nextScrollTop;
}

type TemplateRailProps = {
  railId: string;
  ariaLabel: string;
  templates: QuicksprintTemplateRecord[];
  onSelectTemplate: (template: QuicksprintTemplateRecord) => void;
  onEditTemplate?: (template: QuicksprintTemplateRecord) => void;
  onDeleteTemplate?: (template: QuicksprintTemplateRecord) => void;
  selectedTemplateId?: string | null;
};

const TemplateRail: FunctionComponent<TemplateRailProps> = ({
  railId,
  ariaLabel,
  templates,
  onSelectTemplate,
  onEditTemplate,
  onDeleteTemplate,
  selectedTemplateId = null,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasPotentialOverflow = templates.length > RAIL_ROWS;
  const [scrollState, setScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: hasPotentialOverflow,
  });

  const syncScrollState = useCallback(() => {
    const rail = scrollRef.current;
    if (!rail) {
      return;
    }

    if (rail.scrollWidth === 0 && rail.clientWidth === 0) {
      return;
    }

    const maxScrollLeft = Math.max(rail.scrollWidth - rail.clientWidth, 0);
    if (maxScrollLeft === 0) {
      setScrollState({ canScrollLeft: false, canScrollRight: false });
      return;
    }

    setScrollState({
      canScrollLeft: rail.scrollLeft > 1,
      canScrollRight: rail.scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncScrollState);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [syncScrollState, templates.length]);

  useEffect(() => {
    const rail = scrollRef.current;
    if (!rail) {
      return;
    }

    const handleScroll = () => {
      syncScrollState();
    };

    rail.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", syncScrollState);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
        syncScrollState();
      });
    resizeObserver?.observe(rail);

    return () => {
      rail.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", syncScrollState);
      resizeObserver?.disconnect();
    };
  }, [syncScrollState]);

  const scrollByDirection = useCallback((direction: -1 | 1) => {
    const rail = scrollRef.current;
    if (!rail) {
      return;
    }

    const amount = Math.max(RAIL_MIN_SCROLL_STEP, Math.round(rail.clientWidth * RAIL_SCROLL_STEP_RATIO));
    rail.scrollBy({ left: amount * direction, behavior: "smooth" });
  }, []);

  const onRailKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollByDirection(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollByDirection(1);
    }
  }, [scrollByDirection]);

  const onRailWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.shiftKey || event.deltaY === 0 || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      return;
    }

    const rail = scrollRef.current;
    if (!rail) {
      return;
    }

    const deltaY = normalizeWheelDeltaY(event, rail.clientHeight || window.innerHeight);
    const target = findVerticalScrollTarget(rail, deltaY);
    if (!target) {
      return;
    }

    event.preventDefault();
    scrollElementByDeltaY(target, deltaY);
  }, []);

  useEffect(() => {
    const rail = scrollRef.current;
    if (!rail) {
      return;
    }
    rail.addEventListener("wheel", onRailWheel, { passive: false });
    return () => {
      rail.removeEventListener("wheel", onRailWheel);
    };
  }, [onRailWheel]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => scrollByDirection(-1)}
          disabled={!scrollState.canScrollLeft}
          aria-label={`Scroll ${ariaLabel} left`}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-black/[0.08] bg-white/85 text-slate-500 shadow-sm transition hover:border-black/[0.12] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/[0.08] dark:bg-void-900/55 dark:text-slate-400 dark:hover:text-white dark:focus-visible:ring-offset-void-800"
        >
          <ChevronLeft className="h-4.5 w-4.5" strokeWidth={2.6} />
        </button>
        <button
          type="button"
          onClick={() => scrollByDirection(1)}
          disabled={!scrollState.canScrollRight}
          aria-label={`Scroll ${ariaLabel} right`}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-black/[0.08] bg-white/85 text-slate-500 shadow-sm transition hover:border-black/[0.12] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/[0.08] dark:bg-void-900/55 dark:text-slate-400 dark:hover:text-white dark:focus-visible:ring-offset-void-800"
        >
          <ChevronRight className="h-4.5 w-4.5" strokeWidth={2.6} />
        </button>
      </div>

      <div
        ref={scrollRef}
        id={railId}
        role="region"
        tabIndex={0}
        aria-label={ariaLabel}
        onKeyDown={onRailKeyDown}
        data-qs-template-rail={railId}
        className="dashboard-scrollbar grid max-w-full grid-flow-col grid-rows-2 gap-4 overflow-x-auto overflow-y-visible overscroll-x-contain pb-4 pr-2 outline-none scrollbar-hide touch-auto scroll-smooth auto-cols-[minmax(19rem,calc(100vw-4rem))] sm:auto-cols-[21rem] lg:auto-cols-[22rem]"
      >
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSelect={() => onSelectTemplate(template)}
            onEdit={onEditTemplate ? () => onEditTemplate(template) : undefined}
            onDelete={onDeleteTemplate ? () => onDeleteTemplate(template) : undefined}
            selected={template.id === selectedTemplateId}
          />
        ))}
      </div>
    </div>
  );
};

export const QuicksprintBrowseView: FunctionComponent<{
  templates: QuicksprintTemplateRecord[];
  builtinPurposeOptions: BuiltinPurposeOption[];
  selectedBuiltinPurpose: string;
  setSelectedBuiltinPurpose: (purpose: string) => void;
  announcePhaseStatus?: (message: string) => void;
  phaseStatus?: string;
  handleSelectTemplate: (t: QuicksprintTemplateRecord) => void;
  openEditor: (t: QuicksprintTemplateRecord | null) => void;
  handleDeleteTemplate?: (t: QuicksprintTemplateRecord) => void;
  activeBuiltinPurpose: BuiltinPurposeOption | null;
  loading: boolean;
  onClose: () => void;
  selectedTemplateId?: string | null;
}> = ({
  templates,
  builtinPurposeOptions,
  selectedBuiltinPurpose,
  setSelectedBuiltinPurpose,
  announcePhaseStatus,
  phaseStatus = "Choose a quicksprint template.",
  handleSelectTemplate,
  activeBuiltinPurpose,
  loading,
  openEditor,
  handleDeleteTemplate,
  onClose,
  selectedTemplateId = null,
}) => {
  const hasTemplates = templates.length > 0;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="p-6 sm:p-8 lg:p-10">
      {/* Header */}
      <div data-qs-stagger className="flex items-start justify-between gap-4">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/15 bg-ember-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-600 dark:text-ember-400">
            <Zap className="h-3.5 w-3.5" strokeWidth={2.3} />
            Quicksprint
          </div>
          <div className="space-y-3">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-2xl font-semibold leading-none tracking-tight text-slate-900 outline-none dark:text-white sm:text-3xl"
            >
              Launch A Quicksprint.
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400 sm:text-[15px]">
              Browse default and custom templates together to spin up a focused sprint fast.
            </p>
            <p className="max-w-2xl rounded-[1.1rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-xs font-semibold leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
              {phaseStatus}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-[44px] min-w-[44px] h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
          aria-label="Close quicksprint"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ember-500 border-t-transparent" />
        </div>
      ) : (
        <>
          <div data-qs-stagger className="mt-10">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Templates</div>
                <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Default templates and project templates share one browse rail. The purpose filter narrows the default set while keeping custom templates nearby.
                </p>
              </div>
              <div className="flex w-full flex-col gap-3 sm:max-w-xl sm:flex-row sm:items-end sm:justify-end">
                {builtinPurposeOptions.length > 0 && (
                <div className="w-full rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03] sm:max-w-xs">
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Default Purpose</div>
                  <div className="mt-2">
                    <AvantgardeSelect
                      aria-label="Default template purpose"
                      variant="compact"
                      value={activeBuiltinPurpose?.value || ""}
                      onChange={(purpose) => {
                        setSelectedBuiltinPurpose(purpose);
                        const option = builtinPurposeOptions.find((item) => item.value === purpose);
                        announcePhaseStatus?.(`Default template purpose changed to ${option?.label || "General"}.`);
                      }}
                      options={builtinPurposeOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      placeholder="Select Purpose"
                    />
                  </div>
                </div>
                )}
                <button
                  type="button"
                  onClick={() => openEditor(null)}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-ember-500/20 bg-ember-500/[0.06] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ember-600 transition-colors hover:bg-ember-500/[0.12] dark:text-ember-400"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  New Template
                </button>
              </div>
            </div>
            {activeBuiltinPurpose?.description && (
              <p className="mt-4 max-w-3xl text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                {activeBuiltinPurpose.description}
              </p>
            )}

            {!hasTemplates ? (
              <button
                type="button"
                onClick={() => openEditor(null)}
                className="w-full rounded-[1.4rem] border border-dashed border-black/[0.08] bg-black/[0.015] p-8 text-center transition-colors hover:border-ember-500/30 hover:bg-ember-500/[0.03] dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-ember-500/30"
              >
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-ember-500/10">
                  <Plus className="h-5 w-5 text-ember-500" />
                </div>
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Create your first custom template</div>
                <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">Combine agent presets with custom prompts for reusable sprint flows</div>
              </button>
            ) : (
              <TemplateRail
                railId="quicksprint-template-rail"
                ariaLabel="quicksprint templates"
                templates={templates}
                onSelectTemplate={handleSelectTemplate}
                onEditTemplate={openEditor}
                onDeleteTemplate={handleDeleteTemplate}
                selectedTemplateId={selectedTemplateId}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};
