import type { FunctionComponent } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  CheckCircle2,
  ChevronRight,
  ListChecks,
  Loader2,
  PencilLine,
  XCircle,
} from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import type { SprintReviewSummary } from "../../types.js";
import { calculatePosition, type Position } from "../../lib/positioning/index.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

interface SprintReviewBadgeProps {
  summary: SprintReviewSummary;
  compact?: boolean;
  align?: "left" | "center" | "right";
  showCompactLabel?: boolean;
}

type ReviewState = "passed" | "changes_requested" | "failed";

interface ReviewPresentation {
  state: ReviewState;
  icon: LucideIcon;
  badgeLabel: string;
  compactLabel: string;
  heading: string;
  tone: string;
  accent: string;
  iconTone: string;
}

const REVIEW_PRESENTATIONS: Record<ReviewState, ReviewPresentation> = {
  passed: {
    state: "passed",
    icon: CheckCircle2,
    badgeLabel: "QA passed",
    compactLabel: "QA",
    heading: "QA Review Passed",
    tone: "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-300",
    accent: "before:from-signal-500 before:via-signal-400 before:to-signal-500",
    iconTone: "text-signal-500",
  },
  changes_requested: {
    state: "changes_requested",
    icon: PencilLine,
    badgeLabel: "QA changes requested",
    compactLabel: "QA edits",
    heading: "QA Changes Requested",
    tone: "border-blue-500/35 bg-blue-500/10 text-blue-700 shadow-[0_8px_22px_rgba(59,130,246,0.10)] dark:text-blue-300",
    accent: "before:from-blue-600 before:via-blue-400 before:to-blue-600",
    iconTone: "text-blue-500",
  },
  failed: {
    state: "failed",
    icon: XCircle,
    badgeLabel: "QA review failed",
    compactLabel: "QA failed",
    heading: "QA Provider Review Failed",
    tone: "border-status-red/30 bg-status-red/10 text-status-red shadow-[0_8px_22px_rgba(227,0,15,0.10)]",
    accent: "before:from-status-red before:via-ember-400 before:to-status-red",
    iconTone: "text-status-red",
  },
};

function getReviewPresentation(summary: SprintReviewSummary): ReviewPresentation {
  const status = summary.status.toLowerCase();
  const outcome = summary.outcome?.toLowerCase() ?? "";

  if (outcome === "changes_requested") {
    return REVIEW_PRESENTATIONS.changes_requested;
  }
  if (status === "failed" || status === "errored" || status === "cancelled") {
    return REVIEW_PRESENTATIONS.failed;
  }
  return REVIEW_PRESENTATIONS.passed;
}

const FollowUpTaskDisclosure: FunctionComponent<{
  task: NonNullable<SprintReviewSummary["followUpTasks"]>[number];
  index: number;
}> = ({ task, index }) => {
  const { formatNumber, translate } = useDashboardI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();

  return (
    <article className="rounded-xl border border-black/[0.08] bg-black/[0.02] dark:border-white/[0.08] dark:bg-white/[0.025]">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-700 outline-none transition-colors hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset motion-reduce:transition-none dark:text-slate-200 dark:hover:bg-white/[0.025]"
      >
        <span>{translate(sprintsMessages, "followUpTask", { number: formatNumber(index + 1) })}</span>
        <ChevronRight
          aria-hidden={true}
          className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${isExpanded ? "rotate-90" : ""}`}
        />
      </button>
      {isExpanded && (
        <dl id={contentId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-black/[0.06] px-3 py-3 text-xs dark:border-white/[0.06]">
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{translate(sprintsMessages, "title")}</dt>
          <dd className="break-words font-semibold text-slate-700 dark:text-slate-200">{task.title}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{translate(sprintsMessages, "description")}</dt>
          <dd className="whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">{task.description || translate(sprintsMessages, "notProvided")}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{translate(sprintsMessages, "priority")}</dt>
          <dd className="capitalize text-slate-600 dark:text-slate-300">{task.priority}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{translate(sprintsMessages, "dependencies")}</dt>
          <dd className="break-words text-slate-600 dark:text-slate-300">{task.dependsOnTaskKeys.length > 0 ? task.dependsOnTaskKeys.join(", ") : translate(sprintsMessages, "none")}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400 sm:col-span-2">{translate(sprintsMessages, "prompt")}</dt>
          <dd className="col-span-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-void-900/50 dark:text-slate-300">{task.promptMarkdown}</dd>
        </dl>
      )}
    </article>
  );
};

export const SprintReviewBadge: FunctionComponent<SprintReviewBadgeProps> = ({
  summary,
  compact = false,
  align = "center",
  showCompactLabel = false,
}) => {
  const { formatDate, formatNumber, translate } = useDashboardI18n();
  const overlayId = useId();
  const headingId = useId();
  const stateDescriptionId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const pointerInsideRef = useRef(false);
  const suppressFocusOpenRef = useRef(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const presentation = getReviewPresentation(summary);
  const StatusIcon = presentation.icon;
  const findings = summary.findings ?? [];
  const reviewHeading = translate(sprintsMessages, presentation.state === "passed" && summary.outcome?.toLowerCase() === "approved"
    ? "qaReviewComplete"
    : presentation.state === "passed"
      ? "qaReviewPassed"
      : presentation.state === "changes_requested"
        ? "qaChangesRequested"
        : "qaProviderFailed");
  const badgeLabel = translate(sprintsMessages, presentation.state === "passed" ? "qaPassed" : presentation.state === "changes_requested" ? "qaChangesRequestedBadge" : "qaReviewFailed");
  const compactLabel = translate(sprintsMessages, presentation.state === "passed" ? "qaCompact" : presentation.state === "changes_requested" ? "qaEdits" : "qaFailed");
  const preferredPosition: Position = align === "right" ? "left" : "right";
  const hasDetails = Boolean(
    summary.summary
    || findings.length > 0
    || summary.fixInstructions
    || summary.targetTaskKey
    || summary.followUpTasks?.length
    || summary.reviewer
    || summary.finishedAt,
  );

  const clearCloseTimeout = useCallback((): void => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openOverlay = useCallback((): void => {
    clearCloseTimeout();
    setIsOpen(true);
  }, [clearCloseTimeout]);

  const closeOverlay = useCallback((restoreFocus = false): void => {
    clearCloseTimeout();
    setIsOpen(false);
    if (restoreFocus) {
      suppressFocusOpenRef.current = document.activeElement !== triggerRef.current;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [clearCloseTimeout]);

  const scheduleClose = useCallback((): void => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      const focusIsInside = Boolean(
        activeElement
        && (triggerRef.current?.contains(activeElement) || overlayRef.current?.contains(activeElement)),
      );
      if (!pointerInsideRef.current && !focusIsInside) {
        setIsOpen(false);
      }
      closeTimeoutRef.current = null;
    }, 120);
  }, [clearCloseTimeout]);

  const updateOverlayPosition = useCallback((): void => {
    if (!triggerRef.current || !overlayRef.current) return;

    setCoords(calculatePosition({
      triggerRect: triggerRef.current.getBoundingClientRect(),
      contentRect: overlayRef.current.getBoundingClientRect(),
      position: preferredPosition,
      align: "center",
      gap: 10,
      padding: 12,
    }));
  }, [preferredPosition]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateOverlayPosition();
    }
  }, [isOpen, updateOverlayPosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleOutsidePointer = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !overlayRef.current?.contains(target)) {
        closeOverlay();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay(true);
      }
    };

    document.addEventListener("mousedown", handleOutsidePointer);
    document.addEventListener("touchstart", handleOutsidePointer, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateOverlayPosition);
    window.addEventListener("scroll", updateOverlayPosition, { capture: true, passive: true });

    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("touchstart", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateOverlayPosition);
      window.removeEventListener("scroll", updateOverlayPosition, { capture: true });
    };
  }, [closeOverlay, isOpen, updateOverlayPosition]);

  useEffect(() => () => clearCloseTimeout(), [clearCloseTimeout]);

  if (summary.status.toLowerCase() === "running") {
    return (
      <div className="relative inline-flex">
        <div
          role="status"
          aria-label={translate(sprintsMessages, "qaReviewRunning")}
          className={`inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/8 text-signal-600 shadow-[0_10px_24px_rgba(0,224,160,0.12)] motion-safe:animate-pulse motion-reduce:ring-1 motion-reduce:ring-signal-500/30 ${
            compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
          } font-bold uppercase tracking-[0.14em] dark:text-signal-300`}
        >
          <Loader2
            aria-hidden={true}
            className={`motion-safe:animate-spin motion-reduce:animate-none ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`}
            strokeWidth={2.5}
          />
          {(!compact || showCompactLabel) && <span>{compact ? translate(sprintsMessages, "qaCompact") : translate(sprintsMessages, "reviewing")}</span>}
        </div>
      </div>
    );
  }

  const handleFocusLeaving = (relatedTarget: EventTarget | null): void => {
    if (!(relatedTarget instanceof Node)) {
      scheduleClose();
      return;
    }
    if (!triggerRef.current?.contains(relatedTarget) && !overlayRef.current?.contains(relatedTarget)) {
      scheduleClose();
    }
  };

  return (
    <span
      className="relative inline-flex"
      data-qa-state={presentation.state}
      onMouseEnter={() => {
        pointerInsideRef.current = true;
        openOverlay();
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
        scheduleClose();
      }}
    >
      <span id={stateDescriptionId} className="sr-only">
        {badgeLabel}. {translate(sprintsMessages, isOpen ? "detailsOpen" : "activateReviewDetails")}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-label={translate(sprintsMessages, "qaReviewDetails")}
        aria-describedby={stateDescriptionId}
        aria-expanded={isOpen}
        aria-controls={overlayId}
        onClick={openOverlay}
        onFocus={() => {
          if (suppressFocusOpenRef.current) {
            suppressFocusOpenRef.current = false;
            return;
          }
          openOverlay();
        }}
        onBlur={(event) => handleFocusLeaving(event.relatedTarget)}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 ${presentation.tone} ${
          compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-[10px]"
        } font-bold uppercase tracking-[0.14em]`}
      >
        <StatusIcon
          aria-hidden={true}
          data-qa-icon={presentation.state}
          className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"} shrink-0 ${presentation.iconTone}`}
          strokeWidth={2.5}
        />
        {(!compact || showCompactLabel) && (
          <span className="min-w-0 truncate">{compact ? compactLabel : badgeLabel}</span>
        )}
      </button>

      {isOpen && createPortal(
        <div
          id={overlayId}
          ref={overlayRef}
          role="region"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="fixed z-[99999] max-h-[calc(100vh-1.5rem)] w-[min(41rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[1.5rem] border border-black/[0.08] bg-white shadow-[0_20px_48px_rgba(15,23,42,0.16),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800"
          style={{ top: coords.top, left: coords.left }}
          onMouseEnter={() => {
            pointerInsideRef.current = true;
            openOverlay();
          }}
          onMouseLeave={() => {
            pointerInsideRef.current = false;
            scheduleClose();
          }}
          onFocusCapture={openOverlay}
          onBlurCapture={(event) => handleFocusLeaving(event.relatedTarget)}
        >
          <div className={`relative grid gap-4 p-4 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-to-r ${presentation.accent} ${
            findings.length > 0 ? "grid-cols-1 sm:grid-cols-[minmax(0,20rem)_minmax(0,18rem)]" : "grid-cols-1"
          }`}>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={headingId} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] ${presentation.iconTone}`}>
                  <StatusIcon aria-hidden={true} className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                  {reviewHeading}
                </h2>
                {summary.outcome && (
                  <span className={`rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${presentation.tone}`}>
                    {translate(sprintsMessages, "outcome")}: {summary.outcome.replaceAll("_", " ")}
                  </span>
                )}
              </div>

              <section aria-label={translate(sprintsMessages, "reviewSummary")}>
                <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(sprintsMessages, "summary")}</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-300">
                  {summary.summary || translate(sprintsMessages, hasDetails ? "noReviewSummary" : "noReviewDetails")}
                </p>
              </section>

              {summary.fixInstructions && (
                <section aria-label={translate(sprintsMessages, "fixInstructions")}>
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(sprintsMessages, "fixInstructions")}</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {summary.fixInstructions}
                  </p>
                </section>
              )}

              {summary.targetTaskKey && (
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-bold uppercase tracking-[0.12em] text-slate-400">{translate(sprintsMessages, "targetTask")}</span>
                  <span className="break-all font-mono font-semibold text-slate-700 dark:text-slate-200">{summary.targetTaskKey}</span>
                </div>
              )}

              {(summary.reviewer || summary.finishedAt) && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-black/[0.08] pt-3 text-[11px] dark:border-white/[0.08]">
                  {summary.reviewer && (
                    <>
                      <dt className="font-bold uppercase tracking-[0.12em] text-slate-400">{translate(sprintsMessages, "reviewer")}</dt>
                      <dd className="break-words text-slate-600 dark:text-slate-300">{translate(sprintsMessages, "reviewedBy", { reviewer: summary.reviewer })}</dd>
                    </>
                  )}
                  {summary.finishedAt && (
                    <>
                      <dt className="font-bold uppercase tracking-[0.12em] text-slate-400">{translate(sprintsMessages, "reviewed")}</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{Number.isNaN(new Date(summary.finishedAt).getTime()) ? summary.finishedAt : formatDate(new Date(summary.finishedAt), { month: "short", day: "numeric", hour: "numeric", minute: "numeric" })}</dd>
                    </>
                  )}
                </dl>
              )}
            </div>

            {findings.length > 0 && (
              <section className="flex min-h-0 min-w-0 flex-col gap-2 border-t border-black/[0.08] pt-4 dark:border-white/[0.08] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0" aria-label={translate(sprintsMessages, "reviewFindings")}>
                <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                  <ListChecks aria-hidden={true} className={`h-3.5 w-3.5 ${presentation.iconTone}`} />
                  {translate(sprintsMessages, "findingsCount", { count: formatNumber(findings.length) })}
                </h3>
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-2 dropdown-scrollbar">
                  {findings.map((finding, index) => (
                    <li key={`${index}-${finding}`} className="flex items-start gap-1.5 rounded-lg p-1.5 even:bg-slate-50/50 dark:even:bg-void-700/30">
                      <ChevronRight aria-hidden={true} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${presentation.iconTone}`} strokeWidth={3} />
                      <span className="break-words text-xs leading-snug text-slate-600 dark:text-slate-400">{finding}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {summary.followUpTasks && summary.followUpTasks.length > 0 && (
              <section className="flex min-w-0 flex-col gap-2 border-t border-black/[0.08] pt-4 dark:border-white/[0.08] sm:col-span-2" aria-label={translate(sprintsMessages, "followUpTasks")}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                  {translate(sprintsMessages, "followUpTasksCount", { count: formatNumber(summary.followUpTasks.length) })}
                </h3>
                {summary.followUpTasks.map((task, index) => (
                  <FollowUpTaskDisclosure key={`${index}-${task.title}`} task={task} index={index} />
                ))}
              </section>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
};
