import type { FunctionComponent } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Code2,
  Flag,
  GitMerge,
  GitPullRequest,
  ListChecks,
  Loader2,
  PencilLine,
  Sparkles,
  XCircle,
} from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import type { SprintReviewSummary } from "../../types.js";
import type { CiStatusPresentation, CiWorkflowState } from "../../lib/ci-status-presentation.js";
import {
  deriveWorkflowStatusPresentation,
  type WorkflowHumanInterventionEvidence,
  type WorkflowStage,
  type WorkflowStageId,
} from "../../lib/workflow-status-presentation.js";
import { calculatePosition, type Position } from "../../lib/positioning/index.js";
import "./workflow-status-badge.css";

export interface WorkflowStatusBadgeProps {
  scope: "task" | "sprint";
  status: string;
  review?: SprintReviewSummary | null;
  ciPresentation?: CiStatusPresentation | null;
  humanIntervention?: WorkflowHumanInterventionEvidence | null;
  compact?: boolean;
  align?: "left" | "right";
  className?: string;
}

const STAGE_ICONS: Record<WorkflowStageId, LucideIcon> = {
  coding: Code2,
  pull_request: GitPullRequest,
  qa: ListChecks,
  checks: CheckCircle2,
  merge: GitMerge,
  completion: Flag,
};

const STATE_TONES: Record<CiWorkflowState, { circle: string; icon: string; row: string }> = {
  pending: {
    circle: "border-slate-300 bg-white text-slate-300 dark:border-white/15 dark:bg-void-800 dark:text-slate-500",
    icon: "text-slate-400 dark:text-slate-500",
    row: "border-black/[0.05] bg-black/[0.018] dark:border-white/[0.05] dark:bg-white/[0.025]",
  },
  in_progress: {
    circle: "border-signal-500 bg-signal-500 text-white shadow-[0_0_0_4px_rgba(0,94,184,0.10),0_0_18px_rgba(0,224,160,0.22)]",
    icon: "text-signal-600 dark:text-signal-300",
    row: "border-signal-500/20 bg-signal-500/[0.08] shadow-[0_8px_24px_rgba(0,224,160,0.08)]",
  },
  successful: {
    circle: "border-status-green bg-status-green text-white shadow-[0_0_0_4px_rgba(0,171,132,0.09)]",
    icon: "text-status-green",
    row: "border-status-green/15 bg-status-green/[0.055]",
  },
  failed: {
    circle: "border-status-red bg-status-red text-white shadow-[0_0_0_4px_rgba(227,0,15,0.08)]",
    icon: "text-status-red",
    row: "border-status-red/20 bg-status-red/[0.06]",
  },
};

const BADGE_TONES = {
  pending: "border-slate-300/70 bg-white/90 text-slate-600 shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:border-white/12 dark:bg-white/[0.07] dark:text-slate-200",
  active: "border-signal-500/35 bg-signal-500/[0.13] text-signal-700 shadow-[0_9px_26px_rgba(0,224,160,0.16)] dark:text-signal-300",
  successful: "border-status-green/35 bg-status-green/[0.13] text-status-green shadow-[0_9px_26px_rgba(0,171,132,0.16)]",
  failed: "border-status-red/35 bg-status-red/[0.12] text-status-red shadow-[0_9px_26px_rgba(227,0,15,0.15)]",
  qa_changes: "border-blue-500/40 bg-blue-500/[0.13] text-blue-700 shadow-[0_9px_26px_rgba(59,130,246,0.18)] dark:text-blue-300",
} as const;

function reviewState(summary: SprintReviewSummary): "running" | "passed" | "changes_requested" | "failed" {
  const status = summary.status.toLowerCase();
  const outcome = summary.outcome?.toLowerCase() ?? "";
  if (status === "running" || status === "pending") return "running";
  if (outcome === "changes_requested") return "changes_requested";
  if (["failed", "errored", "cancelled"].includes(status) || ["failed", "rejected"].includes(outcome)) return "failed";
  return "passed";
}

const REVIEW_META = {
  running: {
    icon: Loader2,
    label: "QA review in progress",
    tone: "border-signal-500/25 bg-signal-500/[0.07] text-signal-700 dark:text-signal-300",
    iconTone: "text-signal-500",
    accent: "from-signal-500 via-signal-300 to-signal-500",
    regionLabel: "QA Review In Progress",
  },
  passed: {
    icon: CheckCircle2,
    label: "QA review passed",
    tone: "border-status-green/25 bg-status-green/[0.07] text-status-green",
    iconTone: "text-status-green",
    accent: "from-status-green via-signal-300 to-status-green",
    regionLabel: "QA Review Complete",
  },
  changes_requested: {
    icon: PencilLine,
    label: "QA edits requested",
    tone: "border-blue-500/30 bg-blue-500/[0.08] text-blue-700 dark:text-blue-300",
    iconTone: "text-blue-500",
    accent: "from-blue-600 via-blue-300 to-blue-600",
    regionLabel: "QA Changes Requested",
  },
  failed: {
    icon: XCircle,
    label: "QA review failed",
    tone: "border-status-red/30 bg-status-red/[0.07] text-status-red",
    iconTone: "text-status-red",
    accent: "from-status-red via-ember-400 to-status-red",
    regionLabel: "QA Provider Review Failed",
  },
} as const;

function formatReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date);
}

const WorkflowStageRow: FunctionComponent<{ stage: WorkflowStage; isLast: boolean }> = ({ stage, isLast }) => {
  const tone = stage.id === "qa" && stage.statusLabel === "Changes requested"
    ? {
      ...STATE_TONES.failed,
      circle: "border-blue-500 bg-blue-500 text-white shadow-[0_0_0_4px_rgba(59,130,246,0.10)]",
      icon: "text-blue-500",
      row: "border-blue-500/20 bg-blue-500/[0.07]",
    }
    : STATE_TONES[stage.state];
  const StageIcon = STAGE_ICONS[stage.id];
  const StateIcon = stage.state === "successful" ? Check : stage.state === "failed" ? XCircle : stage.state === "in_progress" ? Loader2 : Circle;
  return (
    <li
      className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5"
      data-workflow-stage={stage.id}
      data-workflow-stage-state={stage.state}
      data-ci-step={["pull_request", "checks", "merge"].includes(stage.id) ? stage.id : undefined}
      data-ci-step-state={["pull_request", "checks", "merge"].includes(stage.id) ? stage.state : undefined}
    >
      <span className="relative flex min-h-12 items-start justify-center pt-2" aria-hidden={true}>
        <span className={`relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${tone.circle}`}>
          <StateIcon className={`h-2.5 w-2.5 ${stage.state === "in_progress" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.8} />
        </span>
        {!isLast && (
          <span className={`workflow-status__connector absolute -bottom-2 left-1/2 top-7 w-1 -translate-x-1/2 ${stage.state === "failed" ? stage.id === "qa" && stage.statusLabel === "Changes requested" ? "text-blue-400" : "text-status-red/55" : stage.state === "successful" ? "text-status-green/55" : stage.state === "in_progress" ? "text-signal-500/70" : "text-slate-300 dark:text-slate-600"}`} />
        )}
      </span>
      <span className={`mb-1.5 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 py-2 ${tone.row}`}>
        <StageIcon className={`h-3.5 w-3.5 ${tone.icon}`} strokeWidth={2.15} aria-hidden={true} />
        <span className="min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{stage.label}</span>
          <span className={`block truncate text-[11px] font-semibold ${stage.state === "failed" ? tone.icon : "text-slate-700 dark:text-slate-200"}`}>{stage.statusLabel}</span>
        </span>
      </span>
    </li>
  );
};

const FollowUpTaskDisclosure: FunctionComponent<{
  task: NonNullable<SprintReviewSummary["followUpTasks"]>[number];
  index: number;
}> = ({ task, index }) => {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <article className="rounded-lg border border-black/[0.06] dark:border-white/[0.07]">
      <button
        type="button"
        aria-label={`Follow-up task ${index + 1}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left outline-none transition-colors hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:hover:bg-white/[0.025]"
      >
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Follow-up task {index + 1}: {task.title}</span>
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-blue-500 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`} aria-hidden={true} />
      </button>
      {expanded && (
        <dl id={contentId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 border-t border-black/[0.06] p-2 text-[11px] dark:border-white/[0.07]">
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">Title</dt>
          <dd className="break-words font-semibold text-slate-700 dark:text-slate-200">{task.title}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">Description</dt>
          <dd className="break-words text-slate-600 dark:text-slate-300">{task.description || "Not provided"}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">Priority</dt>
          <dd className="capitalize text-slate-600 dark:text-slate-300">{task.priority}</dd>
          <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">Dependencies</dt>
          <dd className="break-words text-slate-600 dark:text-slate-300">{task.dependsOnTaskKeys.length > 0 ? task.dependsOnTaskKeys.join(", ") : "None"}</dd>
          <dt className="col-span-2 font-bold uppercase tracking-[0.1em] text-slate-400">Prompt</dt>
          <dd className="col-span-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.025] p-2 font-mono text-[10px] leading-relaxed text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">{task.promptMarkdown}</dd>
        </dl>
      )}
    </article>
  );
};

const QaReviewCard: FunctionComponent<{ summary: SprintReviewSummary; headingId: string }> = ({ summary, headingId }) => {
  const state = reviewState(summary);
  const meta = REVIEW_META[state];
  const cardTone = state === "changes_requested"
    ? "border-blue-500/30 text-blue-700 dark:text-blue-300"
    : state === "failed"
      ? "border-status-red/30 text-status-red"
      : state === "passed"
        ? "border-status-green/25 text-status-green"
        : "border-signal-500/25 text-signal-700 dark:text-signal-300";
  const ReviewIcon = meta.icon;
  const findings = summary.findings ?? [];
  const followUps = summary.followUpTasks ?? [];
  return (
    <article className={`relative min-w-0 overflow-hidden rounded-[1.4rem] border bg-white shadow-[0_18px_46px_rgba(15,23,42,0.13)] dark:bg-void-800 ${cardTone}`}>
      <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${meta.accent}`} aria-hidden={true} />
      <div className="grid max-h-[min(34rem,calc(100vh-3rem))] gap-4 overflow-y-auto p-4 dropdown-scrollbar">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={headingId} className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] ${meta.iconTone}`}>
            <ReviewIcon className={`h-4 w-4 ${state === "running" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.4} aria-hidden={true} />
            {meta.regionLabel}
          </h3>
          {summary.outcome && (
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${meta.tone}`}>
              {summary.outcome.replaceAll("_", " ")}
            </span>
          )}
        </header>
        <section aria-label="Review summary">
          <h4 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Review summary</h4>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-300">
            {summary.summary || (state === "running" ? "The QA reviewer is inspecting this workflow." : "No additional review summary was provided.")}
          </p>
        </section>
        {summary.fixInstructions && (
          <section className="rounded-xl border border-blue-500/15 bg-blue-500/[0.045] p-3" aria-label="Fix instructions">
            <h4 className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-300">
              <PencilLine className="h-3 w-3" aria-hidden={true} /> Fix instructions
            </h4>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">{summary.fixInstructions}</p>
          </section>
        )}
        {findings.length > 0 && (
          <section aria-label="Review findings">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Findings · {findings.length}</h4>
            <ul className="mt-2 grid gap-1.5">
              {findings.map((finding, index) => (
                <li key={`${index}-${finding}`} className="flex items-start gap-2 rounded-lg bg-black/[0.025] p-2 text-xs leading-snug text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">
                  <ChevronRight className={`mt-0.5 h-3 w-3 shrink-0 ${meta.iconTone}`} strokeWidth={2.5} aria-hidden={true} />
                  <span className="break-words">{finding}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {followUps.length > 0 && (
          <section aria-label="Follow-up tasks">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Follow-up tasks · {followUps.length}</h4>
            <div className="mt-2 grid gap-1.5">
              {followUps.map((task, index) => (
                <FollowUpTaskDisclosure key={`${index}-${task.title}`} task={task} index={index} />
              ))}
            </div>
          </section>
        )}
        {(summary.reviewer || summary.finishedAt || summary.targetTaskKey) && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-black/[0.07] pt-3 text-[10px] dark:border-white/[0.07]">
            {summary.reviewer && <><dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Reviewer</dt><dd className="break-words text-slate-600 dark:text-slate-300">Reviewed by {summary.reviewer}</dd></>}
            {summary.finishedAt && <><dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Reviewed</dt><dd className="text-slate-600 dark:text-slate-300">{formatReviewDate(summary.finishedAt)}</dd></>}
            {summary.targetTaskKey && <><dt className="font-bold uppercase tracking-[0.12em] text-slate-400">Target</dt><dd className="break-all font-mono text-slate-600 dark:text-slate-300">{summary.targetTaskKey}</dd></>}
          </dl>
        )}
      </div>
    </article>
  );
};

export const WorkflowStatusBadge: FunctionComponent<WorkflowStatusBadgeProps> = ({
  scope,
  status,
  review = null,
  ciPresentation = null,
  humanIntervention = null,
  compact = false,
  align = "left",
  className = "",
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const suppressFocusOpenRef = useRef<HTMLButtonElement | null>(null);
  const overlayId = useId();
  const reviewHeadingId = useId();
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const normalizedStatus = status.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const effectiveCiPresentation = scope === "sprint" && normalizedStatus === "running"
    ? null
    : ciPresentation;
  const presentation = useMemo(() => deriveWorkflowStatusPresentation({
    scope,
    status,
    review,
    ciPresentation: effectiveCiPresentation,
    humanIntervention,
  }), [effectiveCiPresentation, humanIntervention, review, scope, status]);
  const MainIcon = presentation.tone === "qa_changes"
    ? PencilLine
    : presentation.state === "failed"
      ? XCircle
      : presentation.state === "in_progress"
        ? Loader2
        : presentation.state === "successful"
          ? Sparkles
          : Circle;
  const currentReviewState = review ? reviewState(review) : null;
  const CurrentReviewIcon = currentReviewState ? REVIEW_META[currentReviewState].icon : null;
  const reviewTriggerTone = currentReviewState === "changes_requested"
    ? "qa_changes"
    : currentReviewState === "failed"
      ? "failed"
      : currentReviewState === "running"
        ? "active"
        : "successful";
  const reviewDescriptionId = useId();
  const preferredPosition: Position = align === "right" ? "left" : "right";

  const clearCloseTimeout = useCallback((): void => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);
  const openOverlay = useCallback((): void => {
    clearCloseTimeout();
    setOpen(true);
  }, [clearCloseTimeout]);
  const openFromTrigger = useCallback((trigger: HTMLButtonElement | null): void => {
    if (trigger && suppressFocusOpenRef.current === trigger) {
      suppressFocusOpenRef.current = null;
      return;
    }
    activeTriggerRef.current = trigger;
    openOverlay();
  }, [openOverlay]);
  const closeOverlay = useCallback((restoreFocus = false): void => {
    clearCloseTimeout();
    setOpen(false);
    if (restoreFocus) {
      const focusTarget = activeTriggerRef.current ?? triggerRef.current;
      suppressFocusOpenRef.current = focusTarget;
      focusTarget?.focus({ preventScroll: true });
    }
  }, [clearCloseTimeout]);
  const scheduleClose = useCallback((): void => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      const active = document.activeElement;
      const focusedInside = Boolean(active && (triggerRef.current?.contains(active) || overlayRef.current?.contains(active)));
      if (!pointerInsideRef.current && !focusedInside) setOpen(false);
      closeTimeoutRef.current = null;
    }, 120);
  }, [clearCloseTimeout]);
  const updatePosition = useCallback((): void => {
    if (!triggerRef.current || !overlayRef.current) return;
    setCoords(calculatePosition({
      triggerRect: triggerRef.current.getBoundingClientRect(),
      contentRect: overlayRef.current.getBoundingClientRect(),
      position: preferredPosition,
      align: "center",
      gap: 12,
      padding: 12,
    }));
  }, [preferredPosition]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsidePointer = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !overlayRef.current?.contains(target)) closeOverlay();
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
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("touchstart", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, { capture: true });
    };
  }, [closeOverlay, open, updatePosition]);

  useEffect(() => () => clearCloseTimeout(), [clearCloseTimeout]);

  const handleBlur = (relatedTarget: EventTarget | null): void => {
    if (!(relatedTarget instanceof Node) || (!triggerRef.current?.contains(relatedTarget) && !overlayRef.current?.contains(relatedTarget))) scheduleClose();
  };
  const triggerStatusLabel = presentation.requiresHuman
    ? presentation.label
    : effectiveCiPresentation?.label ?? presentation.label;
  return (
    <span
      className={`relative inline-flex max-w-full items-center ${className}`}
      data-workflow-state={presentation.state}
      data-workflow-tone={presentation.tone}
      data-ci-state={effectiveCiPresentation?.state ?? presentation.state}
      data-qa-state={currentReviewState ?? undefined}
      data-human-needed={presentation.requiresHuman ? "true" : undefined}
      onMouseEnter={() => {
        pointerInsideRef.current = true;
        openOverlay();
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
        scheduleClose();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={overlayId}
        aria-label={`CI status: ${triggerStatusLabel}. ${presentation.accessibleLabel} ${effectiveCiPresentation ? `CI evidence: ${effectiveCiPresentation.accessibleLabel} ` : ""}${open ? "Hide" : "Show"} workflow details`}
        onClick={() => openFromTrigger(triggerRef.current)}
        onFocus={() => openFromTrigger(triggerRef.current)}
        onBlur={(event) => handleBlur(event.relatedTarget)}
        className={`inline-flex max-w-full items-center rounded-full border font-bold uppercase tracking-[0.12em] outline-none transition-[transform,box-shadow,background-color] hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none dark:focus-visible:ring-offset-void-800 ${BADGE_TONES[presentation.tone]} ${review ? "rounded-r-xl" : ""} ${compact ? "gap-1.5 px-2.5 py-1 text-[9px] sm:text-[10px]" : "gap-2 px-3 py-1.5 text-[10px] sm:text-xs"}`}
      >
        <MainIcon className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5"} shrink-0 ${presentation.state === "in_progress" && presentation.tone !== "qa_changes" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.4} aria-hidden={true} />
        <span className="min-w-0 truncate">{presentation.tone === "qa_changes" ? "QA edits" : presentation.label}</span>
        {effectiveCiPresentation && effectiveCiPresentation.label !== presentation.label && <span className="sr-only">{effectiveCiPresentation.label}</span>}
        {!review && <span className="sr-only">QA no review</span>}
        {effectiveCiPresentation && (
          effectiveCiPresentation.state === "failed"
            ? <XCircle data-ci-icon="failure" className="sr-only text-status-red" aria-hidden={true} />
            : effectiveCiPresentation.state === "in_progress"
              ? <Loader2 data-ci-icon="in_progress" className="sr-only text-signal-500" aria-hidden={true} />
              : <CheckCircle2 data-ci-icon={effectiveCiPresentation.state} className="sr-only text-status-green" aria-hidden={true} />
        )}
      </button>
      {review && (
        <>
          {currentReviewState === "running" && <span role="status" aria-label="QA review running" className="sr-only">QA review running</span>}
          <span id={reviewDescriptionId} className="sr-only">
            {currentReviewState === "changes_requested" ? "QA changes requested" : REVIEW_META[currentReviewState!].label}. {open ? "Details are open." : "Activate to show review details."}
          </span>
          <button
            ref={reviewTriggerRef}
            type="button"
            aria-label="QA review details"
            aria-describedby={reviewDescriptionId}
            aria-expanded={open}
            aria-controls={overlayId}
            onClick={() => openFromTrigger(reviewTriggerRef.current)}
            onFocus={() => openFromTrigger(reviewTriggerRef.current)}
            onBlur={(event) => handleBlur(event.relatedTarget)}
            className={`-ml-px inline-flex self-stretch items-center gap-0.5 rounded-r-full border border-l-0 px-1.5 outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none ${BADGE_TONES[reviewTriggerTone]}`}
          >
            {CurrentReviewIcon && <CurrentReviewIcon data-qa-icon={currentReviewState} className={`h-3 w-3 ${currentReviewState ? REVIEW_META[currentReviewState].iconTone : ""} ${currentReviewState === "running" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.5} aria-hidden={true} />}
            <ChevronRight className="workflow-status__chevron h-3.5 w-3.5" strokeWidth={2.8} aria-hidden={true} />
            <span className="sr-only">QA</span>
          </button>
        </>
      )}

      {open && createPortal(
        <div
          id={overlayId}
          ref={overlayRef}
          role="region"
          aria-label="CI workflow details"
          aria-describedby={review ? reviewHeadingId : undefined}
          tabIndex={-1}
          className={`fixed z-[99999] grid max-h-[calc(100vh-1.5rem)] w-[min(52rem,calc(100vw-1.5rem))] gap-3 overflow-y-auto motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 ${review ? "md:grid-cols-[minmax(0,19rem)_2rem_minmax(0,1fr)] md:items-center" : "max-w-[20rem]"}`}
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
          onBlurCapture={(event) => handleBlur(event.relatedTarget)}
        >
          <section className="min-w-0 rounded-[1.4rem] border border-black/[0.07] bg-white p-3.5 shadow-[0_16px_42px_rgba(15,23,42,0.11)] dark:border-white/[0.07] dark:bg-void-800" aria-label="Workflow status card">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <span>
                <span className="block text-[9px] font-bold uppercase tracking-[0.17em] text-slate-400">Delivery flow</span>
                <span className="mt-0.5 block text-sm font-bold text-slate-800 dark:text-white">{presentation.label}</span>
              </span>
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl border ${BADGE_TONES[presentation.tone]}`} aria-hidden={true}>
                <MainIcon className={`h-4 w-4 ${presentation.state === "in_progress" && presentation.tone !== "qa_changes" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.3} />
              </span>
            </div>
            {presentation.requiresHuman && humanIntervention?.title && (
              <p className="mb-3 rounded-xl border border-status-red/20 bg-status-red/[0.06] px-3 py-2 text-[11px] font-semibold leading-snug text-status-red">
                {humanIntervention.title}
              </p>
            )}
            <ol className="grid">
              {presentation.stages.map((stage, index) => <WorkflowStageRow key={stage.id} stage={stage} isLast={index === presentation.stages.length - 1} />)}
            </ol>
          </section>
          {review && (
            <>
              <span className="flex items-center justify-center text-blue-500" aria-hidden={true}>
                <ChevronRight className="workflow-status__chevron hidden h-6 w-6 md:block" strokeWidth={2.5} />
                <ChevronRight className="workflow-status__chevron h-6 w-6 rotate-90 md:hidden" strokeWidth={2.5} />
              </span>
              <div role="region" aria-label={REVIEW_META[currentReviewState!].regionLabel} tabIndex={-1} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800">
                <QaReviewCard summary={review} headingId={reviewHeadingId} />
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
};
