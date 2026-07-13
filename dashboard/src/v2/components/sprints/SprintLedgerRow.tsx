import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import gsap from "gsap";
import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import type { JSX } from "preact";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Heart,
  Link2,
  Loader2,
  ListChecks,
  Maximize2,
  MoreVertical,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { CiStatusBadge } from "../ui/CiStatusBadge.js";
import type { CiStatusPresentation } from "../../lib/ci-status-presentation.js";
import { SprintReviewBadge } from "./SprintReviewBadge.js";
import { SprintActionMenu } from "./SprintActionMenu.js";
import {
  resolveSprintAttentionIndicatorState,
  SprintAttentionIndicator,
} from "./SprintAttentionIndicator.js";
import { DropdownMenu } from "../ui/DropdownMenu.js";
import { LinkedIssueTag } from "../sprint/LinkedIssueTag.js";
import type { Sprint, SprintStatus } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import { formatSprintKey, STATUS_LABELS } from "../../lib/sprint-ledger-state.js";
import { SprintControls } from "./SprintControls.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { TableRow, TableCell } from "../ui/Table.js";
import { getSprintStatusPresentation } from "../../lib/sprint-status-presentation.js";
import { computeSprintActionMenuPosition } from "../../lib/sprint-menu-positioning.js";
import { clampSprintCompletion, formatSprintCompletion } from "../../lib/sprint-progress-display.js";

// Polished badge tones: increased contrast for backgrounds and borders where appropriate
const STATUS_BADGE_TONES: Record<SprintStatus, string> = {
  running: "border-status-green/25 bg-status-green/10 text-status-green",
  paused: "border-ember-500/25 bg-ember-500/10 text-ember-600 dark:text-ember-400",
  completed: "border-slate-300/35 bg-slate-900/[0.04] text-slate-600 dark:border-white/15 dark:bg-white/[0.07] dark:text-slate-300",
  failed: "border-status-red/25 bg-status-red/10 text-status-red",
  cancelled: "border-slate-300/35 bg-slate-100/80 text-slate-500 dark:border-white/15 dark:bg-white/[0.05] dark:text-slate-400",
  idle: "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-300",
};

const ATTENTION_BADGE_OVERRIDES: Partial<Record<string, { tone: string; label: string }>> = {
  merge_required: {
    tone: "border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-300",
    label: "Merge",
  },
  merge_conflict: {
    tone: "border-status-red/25 bg-status-red/10 text-status-red",
    label: "Conflict",
  },
  ci_fix_required: {
    tone: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
    label: "CI",
  },
};

const PROGRESS_TONES: Record<SprintStatus, string> = {
  running: "from-status-green to-signal-500",
  paused: "from-ember-500 to-ember-400",
  completed: "from-slate-500 to-slate-400",
  failed: "from-status-red to-status-red",
  cancelled: "from-slate-400 to-slate-300",
  idle: "from-signal-500 to-signal-300",
};

const TABLE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TABLE_META_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const TABLE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const shortenId = (value: string): string => value.slice(0, 8);
const formatTableDate = (value: string): string => TABLE_DATE_FORMATTER.format(new Date(value));
const formatMetaDate = (value: string): string => TABLE_META_DATE_FORMATTER.format(new Date(value));
const formatTableTime = (value: string): string => TABLE_TIME_FORMATTER.format(new Date(value));

const isSprintActionable = (status: SprintStatus): boolean => status === "running" || status === "paused";
export interface SprintLedgerRowProps {
  sprint: Sprint;
  isSelected: boolean;
  isEven: boolean;
  activeRun: { id: string; status: string } | undefined;
  pauseResumeRun: { id: string; status: string } | undefined;
  humanIntervention: ExecutionHumanInterventionSummary | null;
  ciStatus?: CiStatusPresentation | null;
  sprintKeyPrefix?: string;
  pendingActionIds: Set<string>;
  isAnyBulkPending?: boolean;
  transitionStyle?: JSX.CSSProperties;
  controlTransitionStyle?: JSX.CSSProperties;
  selectionTransitionStyle?: JSX.CSSProperties;
  onToggleRow: (id: string) => void;
  onToggleShowcase: (sprint: Sprint) => void;
  onSprintToggle: (sprintId: string) => void;
  onSprintPauseResume: (sprintId: string) => void;
  onOpenRowMenu?: (event: MouseEvent, sprintId: string) => void;
  onEdit: () => void;
  onExport: () => void;
  onOverrides: () => void;
  onMarkCompleted: () => void;
  onMarkQaPassed?: () => void;
  onRollback?: () => void;
  onDelete: () => void;
}

const SprintLedgerRowComponent: FunctionComponent<SprintLedgerRowProps> = ({
  sprint,
  isSelected,
  isEven,
  activeRun,
  pauseResumeRun,
  humanIntervention,
  ciStatus = null,
  sprintKeyPrefix = "SPR",
  pendingActionIds,
  isAnyBulkPending,
  transitionStyle,
  controlTransitionStyle,
  selectionTransitionStyle,
  onToggleRow,
  onToggleShowcase,
  onSprintToggle,
  onSprintPauseResume,
  onOpenRowMenu,
  onEdit,
  onExport,
  onOverrides,
  onMarkCompleted,
  onMarkQaPassed,
  onRollback,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const checkIconRef = useRef<HTMLSpanElement>(null);
  const isReducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const prevSelected = useRef(isSelected);

  useEffect(() => {
    if (isReducedMotion || !checkIconRef.current) {
      prevSelected.current = isSelected;
      return;
    }

    if (isSelected && !prevSelected.current) {
      // Transitioned from false to true
      gsap.fromTo(
        checkIconRef.current,
        { scale: 0 },
        { scale: 1, duration: gsapTokens.selectionMovement.duration, ease: gsapTokens.selectionMovement.ease }
      );
    }
    prevSelected.current = isSelected;
  }, [isSelected, isReducedMotion, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

  const pendingToggleActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
  const pendingPauseResumeActionId = sprint.status === "paused"
    ? (pauseResumeRun ? `sprint-resume:${pauseResumeRun.id}` : "")
    : (pauseResumeRun ? `sprint-pause:${pauseResumeRun.id}` : "");
  const pinActionId = `sprint-showcase:${sprint.id}`;
  const deleteActionId = `sprint-delete:${sprint.id}`;
  const markCompletedActionId = `sprint-mark-completed:${sprint.id}`;
  const markQaPassedActionId = `sprint-mark-qa-passed:${sprint.id}`;
  const isCompleted = sprint.status === "completed";
  const statusPresentation = getSprintStatusPresentation({
    state: sprint.status,
    humanInterventionTitle: humanIntervention?.title ?? null,
    humanInterventionReason: humanIntervention?.reason ?? null,
    humanInterventionInstructions: humanIntervention?.instructions ?? null,
    humanInterventionOwnerType: humanIntervention?.ownerType ?? null,
    attentionType: humanIntervention?.attentionType ?? null,
    completion: sprint.completion,
    latestReviewStatus: sprint.latestReview?.status ?? null,
  });
  const showInterventionBadge = Boolean(humanIntervention) && statusPresentation.showHumanInterventionBadge;
  const attentionIndicatorState = resolveSprintAttentionIndicatorState({
    sprintStatus: sprint.status,
    statusPresentation,
    humanIntervention,
  });

  const isTogglePending = pendingActionIds.has(pendingToggleActionId);
  const isPauseResumePending = pendingPauseResumeActionId.length > 0 && pendingActionIds.has(pendingPauseResumeActionId);
  const isPinPending = pendingActionIds.has(pinActionId);
  const isDeletePending = pendingActionIds.has(deleteActionId);
  const isMarkCompletedPending = pendingActionIds.has(markCompletedActionId);
  const isMarkQaPassedPending = pendingActionIds.has(markQaPassedActionId);
  // The menu icon only needs to show a loader if deleting/pinning. toggle and pause are shown in their own controls.
  const isRowPending = isPinPending || isDeletePending || isMarkCompletedPending || isMarkQaPassedPending;

  const rowTone = attentionIndicatorState
    ? "border-status-red/55 bg-status-red/[0.055] shadow-[0_14px_36px_rgba(227,0,15,0.14)]"
    : sprint.kind === "rollback"
    ? "border-orange-500/30 bg-orange-500/[0.07] shadow-[0_14px_36px_rgba(249,115,22,0.1)]"
    : isSelected
    ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_18px_44px_rgba(0,224,160,0.12)]"
    : isEven
      ? "border-black/[0.06] bg-white/80 dark:border-white/[0.07] dark:bg-white/[0.045]"
      : "border-black/[0.06] bg-slate-50/80 dark:border-white/[0.07] dark:bg-white/[0.03]";
  const desktopCellTone = attentionIndicatorState
    ? "lg:border-status-red/45 lg:bg-status-red/[0.045] dark:lg:border-status-red/45 dark:lg:bg-status-red/[0.06]"
    : sprint.kind === "rollback"
    ? "lg:border-orange-500/25 lg:bg-orange-500/[0.065] dark:lg:border-orange-400/20 dark:lg:bg-orange-500/[0.08]"
    : isSelected
    ? "lg:border-signal-500/25 lg:bg-signal-500/[0.08]"
    : isEven
      ? "lg:border-black/[0.06] lg:bg-white/80 dark:lg:border-white/[0.07] dark:lg:bg-white/[0.045]"
      : "lg:border-black/[0.06] lg:bg-slate-50/80 dark:lg:border-white/[0.07] dark:lg:bg-white/[0.03]";
  const progressTone = PROGRESS_TONES[sprint.status];
  const completion = clampSprintCompletion(sprint.completion);
  const completionLabel = formatSprintCompletion(completion);
  const routeSearch = { projectId: sprint.projectId, sprintId: sprint.id } as any;

  const attentionOverride = humanIntervention?.attentionType
    && !(ciStatus && humanIntervention.attentionType === "ci_fix_required")
    ? ATTENTION_BADGE_OVERRIDES[humanIntervention.attentionType]
    : undefined;

  let badgeLabel = statusPresentation.statusLabel;
  let badgeTone = STATUS_BADGE_TONES[sprint.status] || "border-slate-300/35 bg-slate-900/[0.04] text-slate-600 dark:border-white/15 dark:bg-white/[0.07] dark:text-slate-300";

  if (badgeLabel === "QA") {
    badgeTone = "border-status-amber/25 bg-status-amber/10 text-status-amber";
  } else if (badgeLabel === "Merge") {
    badgeTone = "border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-300";
  } else if (badgeLabel === "Merge Conflict") {
    badgeTone = "border-status-red/25 bg-status-red/10 text-status-red";
  } else if (attentionOverride) {
    badgeLabel = attentionOverride.label;
    badgeTone = attentionOverride.tone;
  }

  const pendingRowClass = isDeletePending
    ? "bg-status-red/5 ring-2 ring-inset ring-status-red/20"
    : isPinPending || isTogglePending || isPauseResumePending || isMarkCompletedPending
      ? "bg-signal-500/5 ring-2 ring-inset ring-signal-500/20"
      : isAnyBulkPending
        ? "border-slate-400/25 bg-slate-900/[0.03] ring-2 ring-inset ring-slate-400/20 dark:bg-white/[0.03]"
        : "";
  const rowBusy = isRowPending || isTogglePending || isPauseResumePending || Boolean(isAnyBulkPending);
  const pendingLabel = isDeletePending
    ? "Delete pending"
    : isPinPending
      ? "Pin update pending"
      : isMarkCompletedPending
        ? "Completion pending"
      : isTogglePending
        ? activeRun ? "Stop pending" : "Start pending"
        : isPauseResumePending
          ? sprint.status === "paused" ? "Resume pending" : "Pause pending"
          : isAnyBulkPending
            ? "Bulk action pending"
            : null;
  const selectionDisabledTitle = isDeletePending
    ? "Selection is disabled while this sprint is deleting"
    : isAnyBulkPending
      ? "Selection is disabled while a bulk action is in progress"
      : isSelected
        ? "Deselect sprint"
        : "Select sprint";
  const rowDisabledReason = isDeletePending
    ? `Controls for sprint ${sprint.name} are disabled while deletion is pending.`
    : isAnyBulkPending
      ? `Controls for sprint ${sprint.name} are disabled while a bulk action is in progress.`
      : isPinPending
        ? `Pin controls for sprint ${sprint.name} are disabled while the pin update is pending.`
        : isMarkCompletedPending
          ? `Completion controls for sprint ${sprint.name} are disabled while completion is pending.`
          : isTogglePending
            ? `Start and stop controls for sprint ${sprint.name} are busy.`
            : isPauseResumePending
              ? `Pause and resume controls for sprint ${sprint.name} are busy.`
              : null;
  const rowDisabledReasonId = `sprint-ledger-row-${sprint.id}-disabled-reason`;
  const disabledDescriptionId = rowDisabledReason ? rowDisabledReasonId : undefined;
  const pinDisabledTitle = isDeletePending
    ? "Pinning is disabled while this sprint is deleting"
    : isAnyBulkPending
      ? "Pinning is disabled while a bulk action is in progress"
    : isPinPending
      ? "Pin update in progress"
      : sprint.showcasePinned
        ? "Remove from showcase"
        : "Pin to showcase";

  return (
    <TableRow
      selected={isSelected}
      aria-busy={rowBusy}
      className={`group ${attentionIndicatorState ? `sprint-attention-${attentionIndicatorState.kind}` : ""} transition-all focus-within:ring-2 focus-within:ring-signal-500/20 ${rowTone} ${isCompleted ? "text-slate-500 dark:text-slate-400" : ""} ${pendingRowClass} hover:bg-[var(--bg-hover-subtle)] transition-[box-shadow,transform] [@media(hover:hover)]:hover:shadow-[0_4px_12px_rgba(0,0,0,0.12)] [@media(hover:hover)]:hover:-translate-y-px motion-reduce:transition-none motion-reduce:hover:transform-none`}
      style={transitionStyle}
    >
      <TableCell isFirst className={`lg:w-[80px] lg:min-w-[80px] ${desktopCellTone}`} mobileLabel="Select">
        {rowDisabledReason ? (
          <span id={rowDisabledReasonId} className="sr-only">{rowDisabledReason}</span>
        ) : null}
        <button
          type="button"
          onClick={() => onToggleRow(sprint.id)}
          disabled={isDeletePending || isAnyBulkPending}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border text-slate-400 transition-colors hover:border-signal-500/25 hover:text-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.07] dark:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50 ${
            isSelected ? "border-signal-500/35 bg-signal-500/10 ring-2 ring-inset ring-signal-500/20" : "border-black/[0.06] bg-white/72"
          }`}
          style={selectionTransitionStyle}
          title={selectionDisabledTitle}
          aria-label={isDeletePending ? `Cannot select sprint ${sprint.name} while deleting` : isAnyBulkPending ? `Cannot select sprint ${sprint.name} while a bulk action is in progress` : isSelected ? `Deselect sprint ${sprint.name}` : `Select sprint ${sprint.name}`}
          aria-pressed={isSelected}
          aria-disabled={isDeletePending || isAnyBulkPending}
          aria-busy={isDeletePending || isAnyBulkPending ? "true" : undefined}
          aria-describedby={isDeletePending || isAnyBulkPending ? disabledDescriptionId : undefined}
        >
          {isSelected
            ? <span ref={checkIconRef} className="flex"><CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} /></span>
            : <Square className="h-4 w-4" strokeWidth={2.2} />}
        </button>
      </TableCell>
      <TableCell className={`lg:w-[80px] lg:min-w-[80px] ${desktopCellTone}`} mobileLabel="Pin">
        <button
          type="button"
          onClick={() => onToggleShowcase(sprint)}
          disabled={isPinPending || isDeletePending || isAnyBulkPending}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition-all focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
            sprint.showcasePinned
              ? "border-status-red/20 bg-status-red/10 text-status-red shadow-[0_8px_20px_rgba(239,68,68,0.10)]"
              : "border-black/[0.06] bg-white/70 text-slate-400 hover:border-status-red/20 hover:text-status-red dark:border-white/[0.07] dark:bg-white/[0.04]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          style={controlTransitionStyle}
          title={pinDisabledTitle}
          aria-label={isAnyBulkPending ? `Cannot change showcase pin for sprint ${sprint.name} while a bulk action is in progress` : sprint.showcasePinned ? `Remove sprint ${sprint.name} from showcase` : `Pin sprint ${sprint.name} to showcase`}
          aria-busy={isPinPending}
          aria-disabled={isPinPending || isDeletePending || isAnyBulkPending}
          aria-describedby={isPinPending || isDeletePending || isAnyBulkPending ? disabledDescriptionId : undefined}
        >
          {isPinPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
          ) : (
            <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
          )}
        </button>
      </TableCell>
      <TableCell className={`lg:w-[120px] lg:min-w-[120px] ${desktopCellTone}`} mobileLabel="Sprint ID">
        <div className="font-mono text-sm font-bold text-[var(--text-primary)] break-all">{formatSprintKey(sprint, sprintKeyPrefix)}</div>
        <div className="mt-1 text-[10px] font-bold text-slate-400 break-all">
          {shortenId(sprint.id)}
        </div>
      </TableCell>
      <TableCell className={`min-w-0 max-w-full lg:w-[220px] lg:min-w-[220px] ${desktopCellTone}`} mobileLabel="Sprint">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`font-display text-base font-semibold leading-tight break-words ${isCompleted ? "text-slate-700 dark:text-slate-300" : "text-[var(--text-primary)]"}`}>{sprint.name}</div>
            {sprint.kind === "rollback" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/25 bg-orange-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.13em] text-orange-700 dark:text-orange-300">
                <RotateCcw className="h-2.5 w-2.5" /> Rollback
              </span>
            )}
          </div>
          {attentionIndicatorState && (
            <SprintAttentionIndicator state={attentionIndicatorState} compact />
          )}
          {isSelected ? (
            <span className="inline-flex items-center rounded-full border border-signal-500/25 bg-signal-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-signal-700 dark:text-signal-300">
              Selected
            </span>
          ) : null}
          {pendingLabel ? (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${
              isDeletePending
                ? "border-status-red/25 bg-status-red/10 text-status-red"
                : "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-300"
            }`}>
              {pendingLabel}
            </span>
          ) : null}
          {sprint.latestReview && (
            <SprintReviewBadge summary={sprint.latestReview} compact align="left" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.05] bg-black/[0.025] px-2 py-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <Calendar className="h-3 w-3" strokeWidth={2.1} />
            Updated {formatMetaDate(sprint.updatedAt)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.05] bg-black/[0.025] px-2 py-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
            Created {formatTableDate(sprint.createdAt)} <span className="ml-1 font-mono text-[10px] text-slate-400">{formatTableTime(sprint.createdAt)}</span>
          </span>
        </div>
        {showInterventionBadge && isSprintActionable(sprint.status) && humanIntervention && (
          <div className="mt-3">
            <HumanInterventionBadge summary={humanIntervention} label="Needs you" compact align="left" />
          </div>
        )}
        {sprint.linkedIssues && sprint.linkedIssues.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sprint.linkedIssues.map((issue) => (
              <LinkedIssueTag key={issue.id} issue={issue} />
            ))}
          </div>
        )}
        {sprint.goal ? (
          <p className={`mt-3 max-w-2xl text-sm leading-relaxed ${isCompleted ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
            {sprint.goal}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={`lg:w-[120px] lg:min-w-[120px] ${desktopCellTone}`} mobileLabel="Status">
        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-start">
          <span className={`inline-flex rounded-full border px-4 py-1.5 text-[11px] font-bold ${badgeTone}`}>
            {badgeLabel}
          </span>
          <CiStatusBadge presentation={ciStatus} compact />
          {isDeletePending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-status-red/25 bg-status-red/10 px-3 py-1.5 text-[11px] font-bold text-status-red">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.2} /> Deleting
            </span>
          ) : isPinPending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-[11px] font-bold text-signal-700 dark:text-signal-300">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.2} /> Pinning
            </span>
          ) : isTogglePending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-[11px] font-bold text-signal-700 dark:text-signal-300">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.2} /> {activeRun ? "Stopping" : "Starting"}
            </span>
          ) : isPauseResumePending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-[11px] font-bold text-signal-700 dark:text-signal-300">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.2} /> {sprint.status === "paused" ? "Resuming" : "Pausing"}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell align="right" className={`lg:w-[100px] lg:min-w-[100px] ${desktopCellTone}`} mobileLabel="Tasks">
        <div className="flex items-center gap-3 justify-end lg:block">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/70 text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] lg:hidden">
            <ListChecks className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <div className="font-mono text-base font-semibold text-[var(--text-primary)]">{sprint.tasksCount}</div>
            <div className="text-[11px] text-slate-400">planned tasks</div>
          </div>
        </div>
      </TableCell>
      <TableCell align="right" className={`min-w-[12rem] lg:w-[140px] lg:min-w-[140px] ${desktopCellTone}`} mobileLabel="Completion">
        <div className="flex items-center justify-end gap-3">
          <div
            className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/10 ring-1 ring-black/[0.03] dark:bg-white/[0.08] dark:ring-white/[0.04]"
            role="progressbar"
            aria-label={`${sprint.name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion}
          >
            <div
              className={`h-full rounded-full bg-gradient-to-r ${progressTone} transition-[width]`}
              style={{ ...controlTransitionStyle, width: `${completion}%` }}
            />
          </div>
          <span className="font-mono text-sm font-bold text-[var(--text-primary)]">{completionLabel}</span>
        </div>
      </TableCell>
      <TableCell className={`lg:w-[120px] lg:min-w-[120px] ${desktopCellTone}`} mobileLabel="Created">
        <div className="font-medium text-[var(--text-primary)]">
          {formatTableDate(sprint.createdAt)}
          <span className="ml-1.5 font-mono text-[10px] text-slate-400">{formatTableTime(sprint.createdAt)}</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">created</div>
        <div className="mt-1.5 inline-flex items-center gap-1">
          {sprint.latestReview?.status === 'running' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 text-signal-500 animate-spin motion-reduce:animate-none" strokeWidth={2.2} />
              <span className="text-[11px] font-bold text-signal-500 animate-pulse motion-reduce:animate-none">Reviewing</span>
            </>
          ) : sprint.latestReview?.status === 'completed' || sprint.latestReview?.status === 'reviewed' ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
              <span className="text-[11px] font-bold text-signal-500">Reviewed</span>
            </>
          ) : (
            <span className="text-[11px] font-bold text-slate-400">Not reviewed</span>
          )}
        </div>
      </TableCell>
      <TableCell align="right" isLast className={`lg:w-[140px] lg:min-w-[140px] ${desktopCellTone}`} mobileLabel="Controls">
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {isAnyBulkPending ? (
            <>
              <button
                type="button"
                disabled
                title="Pause and resume are disabled while a bulk action is in progress"
                aria-label={`Cannot ${sprint.status === "paused" ? "resume" : "pause"} ${sprint.name} while a bulk action is in progress`}
                aria-busy="true"
                aria-disabled="true"
                aria-describedby={disabledDescriptionId}
                className="inline-flex min-h-8 min-w-[6.75rem] flex-1 flex-nowrap items-center justify-center gap-2 rounded-lg border border-slate-300/40 bg-slate-100/70 px-3 py-1.5 text-xs font-bold leading-tight text-slate-500 transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 sm:flex-none"
                style={controlTransitionStyle}
              >
                {sprint.status === "paused" ? <Play className="h-3.5 w-3.5" fill="currentColor" /> : <Pause className="h-3.5 w-3.5" fill="currentColor" />}
                {sprint.status === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                disabled
                title="Start and stop are disabled while a bulk action is in progress"
                aria-label={`Cannot ${activeRun ? "stop" : "start"} ${sprint.name} while a bulk action is in progress`}
                aria-busy="true"
                aria-disabled="true"
                aria-describedby={disabledDescriptionId}
                className="inline-flex min-h-8 min-w-[6.75rem] flex-1 flex-nowrap items-center justify-center gap-2 rounded-lg border border-slate-300/40 bg-slate-100/70 px-3 py-1.5 text-xs font-bold leading-tight text-slate-500 transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 disabled:cursor-not-allowed dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 sm:flex-none"
                style={controlTransitionStyle}
              >
                {activeRun ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
                {activeRun ? "Stop" : "Start"}
              </button>
            </>
          ) : (
            <SprintControls
              isActive={Boolean(activeRun)}
              isPaused={sprint.status === "paused"}
              isStartStopPending={isTogglePending}
              isPauseResumePending={isPauseResumePending}
              onStartStop={() => onSprintToggle(sprint.id)}
              onPauseResume={() => onSprintPauseResume(sprint.id)}
              sprintName={sprint.name}
            />
          )}
          <Link
            to="/tasks"
            search={routeSearch}
            aria-label={`Open tasks for sprint ${sprint.name}`}
            className="inline-flex min-h-10 min-w-[4.5rem] flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs font-bold leading-tight text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white sm:flex-none"
            style={controlTransitionStyle}
          >
            Tasks
            <Maximize2 className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/live"
            search={routeSearch}
            aria-label={`Open live session for sprint ${sprint.name}`}
            className="inline-flex min-h-10 min-w-[4.5rem] flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1.5 text-xs font-bold leading-tight text-signal-700 transition-colors hover:bg-signal-500/[0.12] hover:text-signal-800 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-signal-500/20 dark:bg-signal-500/[0.10] dark:text-signal-300 dark:hover:bg-signal-500/[0.16] dark:hover:text-signal-200 sm:flex-none"
            style={controlTransitionStyle}
          >
            Live
            <Maximize2 className="h-3.5 w-3.5" />
          </Link>
          {onOpenRowMenu ? (
            <button
              type="button"
              disabled={isDeletePending || isAnyBulkPending}
              onClick={(e) => onOpenRowMenu(e, sprint.id)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={controlTransitionStyle}
              title={isDeletePending ? "Actions are disabled while this sprint is deleting" : isAnyBulkPending ? "Actions are disabled while a bulk action is in progress" : "Open sprint actions"}
              aria-label={isAnyBulkPending ? `Cannot open actions menu for sprint ${sprint.name} while a bulk action is in progress` : `Open actions menu for sprint ${sprint.name}`}
              aria-disabled={isDeletePending || isAnyBulkPending}
              aria-busy={isDeletePending ? "true" : undefined}
              aria-describedby={isDeletePending || isAnyBulkPending ? disabledDescriptionId : undefined}
            >
              {isDeletePending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-signal-500 motion-reduce:animate-none" strokeWidth={2.2} />
              ) : (
                <MoreVertical className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <DropdownMenu
              isOpen={menuOpen}
              onOpenChange={setMenuOpen}
              position="bottom"
              align="end"
              className="min-w-[11.5rem]"
              computePosition={({ triggerRect, menuRect, viewport }) => computeSprintActionMenuPosition(
                triggerRect,
                viewport,
                { width: menuRect.width, height: menuRect.height },
              )}
              content={
                <SprintActionMenu
                  sprint={sprint}
                  isCompleted={isCompleted}
                  showcaseBusy={isPinPending}
                  markCompletedDisabled={isMarkCompletedPending || isDeletePending || isAnyBulkPending}
                  markQaPassedDisabled={isMarkQaPassedPending || sprint.latestReview?.status === "running" || isDeletePending || isAnyBulkPending}
                  deleteBusy={isDeletePending}
                  onEdit={onEdit}
                  onExport={onExport}
                  onToggleShowcase={() => onToggleShowcase(sprint)}
                  onOverrides={onOverrides}
                  onMarkCompleted={onMarkCompleted}
                  onMarkQaPassed={onMarkQaPassed}
                  onRollback={onRollback}
                  onDelete={onDelete}
                  onClose={() => setMenuOpen(false)}
                  markCompletedIcon="square"
                  role="menuitem"
                  buttonClassName="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus:outline-none"
                />
              }
            >
              <button
                type="button"
                disabled={isDeletePending || isAnyBulkPending}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={controlTransitionStyle}
                title={isDeletePending ? "Actions are disabled while this sprint is deleting" : isAnyBulkPending ? "Actions are disabled while a bulk action is in progress" : "Open sprint actions"}
                aria-label={isAnyBulkPending ? `Cannot open actions menu for sprint ${sprint.name} while a bulk action is in progress` : `Open actions menu for sprint ${sprint.name}`}
                aria-disabled={isDeletePending || isAnyBulkPending}
                aria-busy={isDeletePending ? "true" : undefined}
                aria-describedby={isDeletePending || isAnyBulkPending ? disabledDescriptionId : undefined}
              >
                {isDeletePending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-signal-500 motion-reduce:animate-none" strokeWidth={2.2} />
                ) : (
                  <MoreVertical className="h-3.5 w-3.5" />
                )}
              </button>
            </DropdownMenu>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

export const SprintLedgerRow = memo(SprintLedgerRowComponent);
