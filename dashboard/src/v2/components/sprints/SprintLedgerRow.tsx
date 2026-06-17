import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
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
  Square,
} from "lucide-preact";
import { useState } from "preact/hooks";
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { SprintReviewBadge } from "./SprintReviewBadge.js";
import { SprintActionMenu } from "./SprintActionMenu.js";
import { DropdownMenu } from "../ui/DropdownMenu.js";
import { LinkedIssueTag } from "../sprint/LinkedIssueTag.js";
import type { Sprint, SprintStatus } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import { formatSprintKey, STATUS_LABELS } from "../../lib/sprint-ledger-state.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { SprintControls } from "./SprintControls.js";
import { TableRow, TableCell } from "../ui/Table.js";
import { getSprintStatusPresentation } from "../../lib/sprint-status-presentation.js";
import { computeSprintActionMenuPosition } from "../../lib/sprint-menu-positioning.js";

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
  pendingActionIds: Set<string>;
  isAnyBulkPending?: boolean;
  onToggleRow: (id: string) => void;
  onToggleShowcase: (sprint: Sprint) => void;
  onSprintToggle: (sprintId: string) => void;
  onSprintPauseResume: (sprintId: string) => void;
  onOpenRowMenu?: (event: MouseEvent, sprintId: string) => void;
  onEdit: () => void;
  onExport: () => void;
  onOverrides: () => void;
  onMarkCompleted: () => void;
  onDelete: () => void;
}

const SprintLedgerRowComponent: FunctionComponent<SprintLedgerRowProps> = ({
  sprint,
  isSelected,
  isEven,
  activeRun,
  pauseResumeRun,
  humanIntervention,
  pendingActionIds,
  isAnyBulkPending,
  onToggleRow,
  onToggleShowcase,
  onSprintToggle,
  onSprintPauseResume,
  onOpenRowMenu,
}) => {
  const settings = useProjectEffectiveSettings(sprint.projectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const sprintKeyPrefix = settings.data?.settings?.git?.sprintKeyPrefix || "SPR";

  const pendingToggleActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
  const pendingPauseResumeActionId = sprint.status === "paused"
    ? (pauseResumeRun ? `sprint-resume:${pauseResumeRun.id}` : "")
    : (pauseResumeRun ? `sprint-pause:${pauseResumeRun.id}` : "");
  const pinActionId = `sprint-showcase:${sprint.id}`;
  const deleteActionId = `sprint-delete:${sprint.id}`;
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

  const isTogglePending = pendingActionIds.has(pendingToggleActionId);
  const isPauseResumePending = pendingPauseResumeActionId.length > 0 && pendingActionIds.has(pendingPauseResumeActionId);
  const isPinPending = pendingActionIds.has(pinActionId);
  const isDeletePending = pendingActionIds.has(deleteActionId);
  const isRowPending = isTogglePending || isPauseResumePending || isPinPending || isDeletePending;

  const rowTone = isSelected
    ? "border-signal-500/35 bg-signal-500/[0.08] shadow-[0_18px_44px_rgba(0,224,160,0.12)]"
    : isEven
      ? "border-black/[0.06] bg-white/80 dark:border-white/[0.07] dark:bg-white/[0.045]"
      : "border-black/[0.06] bg-slate-50/80 dark:border-white/[0.07] dark:bg-white/[0.03]";
  const desktopCellTone = isSelected
    ? "lg:border-signal-500/25 lg:bg-signal-500/[0.08]"
    : isEven
      ? "lg:border-black/[0.06] lg:bg-white/80 dark:lg:border-white/[0.07] dark:lg:bg-white/[0.045]"
      : "lg:border-black/[0.06] lg:bg-slate-50/80 dark:lg:border-white/[0.07] dark:lg:bg-white/[0.03]";
  const progressTone = PROGRESS_TONES[sprint.status];

  const attentionOverride = humanIntervention?.attentionType
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

  return (
    <TableRow
      className={`group transition-all duration-300 hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-signal-500/20 ${rowTone} ${isCompleted ? "text-slate-500 dark:text-slate-400" : ""} ${isDeletePending ? "grayscale opacity-50" : ""} hover:bg-[var(--bg-hover-subtle)]`}
    >
      <TableCell isFirst className={`lg:w-[80px] lg:min-w-[80px] ${desktopCellTone}`}>
        <button
          type="button"
          onClick={() => onToggleRow(sprint.id)}
          disabled={isRowPending || isAnyBulkPending}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-black/[0.06] bg-white/72 text-slate-400 transition-colors hover:border-signal-500/25 hover:text-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.07] dark:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          title={isSelected ? "Deselect sprint" : "Select sprint"}
        >
          {isSelected
            ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
            : <Square className="h-4 w-4" strokeWidth={2.2} />}
        </button>
      </TableCell>
      <TableCell className={`lg:w-[80px] lg:min-w-[80px] ${desktopCellTone}`}>
        <button
          type="button"
          onClick={() => onToggleShowcase(sprint)}
          disabled={isPinPending}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition-all focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
            sprint.showcasePinned
              ? "border-status-red/20 bg-status-red/10 text-status-red shadow-[0_8px_20px_rgba(239,68,68,0.10)]"
              : "border-black/[0.06] bg-white/70 text-slate-400 hover:border-status-red/20 hover:text-status-red dark:border-white/[0.07] dark:bg-white/[0.04]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title={sprint.showcasePinned ? "Remove from showcase" : "Pin to showcase"}
        >
          {isPinPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} />
          ) : (
            <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
          )}
        </button>
      </TableCell>
      <TableCell className={`lg:w-[120px] lg:min-w-[120px] ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Sprint ID</span>
        <div className="font-mono text-sm font-bold text-[var(--text-primary)] truncate">{formatSprintKey(sprint, sprintKeyPrefix)}</div>
        <div className="mt-1 text-[10px] font-bold text-slate-400 truncate">
          {shortenId(sprint.id)}
        </div>
      </TableCell>
      <TableCell className={`min-w-0 max-w-full lg:w-[220px] lg:min-w-[220px] ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Sprint</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`font-display text-lg font-black leading-tight break-words ${isCompleted ? "text-slate-700 dark:text-slate-300" : "text-[var(--text-primary)]"}`}>{sprint.name}</div>
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
      <TableCell className={`lg:w-[120px] lg:min-w-[120px] ${desktopCellTone}`}>
        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-start">
          <span className="text-[10px] font-bold text-slate-400 lg:hidden">Status</span>
          <span className={`inline-flex rounded-full border px-4 py-1.5 text-[11px] font-bold ${badgeTone}`}>
            {badgeLabel}
          </span>
        </div>
      </TableCell>
      <TableCell align="right" className={`lg:w-[100px] lg:min-w-[100px] ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Tasks</span>
        <div className="flex items-center gap-3 justify-end lg:block">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/70 text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] lg:hidden">
            <ListChecks className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <div className="font-mono text-lg font-bold text-[var(--text-primary)]">{sprint.tasksCount}</div>
            <div className="text-[11px] text-slate-400">planned tasks</div>
          </div>
        </div>
      </TableCell>
      <TableCell align="right" className={`min-w-[12rem] lg:w-[140px] lg:min-w-[140px] ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Completion</span>
        <div className="flex items-center justify-end gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/10 ring-1 ring-black/[0.03] dark:bg-white/[0.08] dark:ring-white/[0.04]">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${progressTone} transition-[width] duration-500 ease-out`}
              style={{ width: `${sprint.completion}%` }}
            />
          </div>
          <span className="font-mono text-sm font-bold text-[var(--text-primary)]">{sprint.completion}%</span>
        </div>
      </TableCell>
      <TableCell className={`lg:w-[120px] lg:min-w-[120px] ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Created</span>
        <div className="font-medium text-[var(--text-primary)]">
          {formatTableDate(sprint.createdAt)}
          <span className="ml-1.5 font-mono text-[10px] text-slate-400">{formatTableTime(sprint.createdAt)}</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">created</div>
        <div className="mt-1.5 inline-flex items-center gap-1">
          {sprint.latestReview?.status === 'running' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 text-signal-500 animate-spin" strokeWidth={2.2} />
              <span className="text-[11px] font-bold text-signal-500 animate-pulse">Reviewing</span>
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
      <TableCell align="right" isLast className={`lg:w-[140px] lg:min-w-[140px] ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Controls</span>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:whitespace-nowrap">
          <SprintControls
            isActive={Boolean(activeRun)}
            isPaused={sprint.status === "paused"}
            isStartStopPending={isTogglePending}
            isPauseResumePending={isPauseResumePending}
            onStartStop={() => onSprintToggle(sprint.id)}
            onPauseResume={() => onSprintPauseResume(sprint.id)}
          />
          <a
            href={`/tasks?sprint=${encodeURIComponent(sprint.id)}`}
            className="inline-flex h-10 min-w-[5rem] flex-1 items-center justify-center gap-2 rounded-xl border border-black/[0.06] bg-white/80 px-4 text-xs font-bold text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white sm:flex-none"
          >
            Open
            <Maximize2 className="h-3.5 w-3.5" />
          </a>
          {onOpenRowMenu ? (
            <button
              type="button"
              disabled={isRowPending}
              onClick={(e) => onOpenRowMenu(e, sprint.id)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              title="Open sprint actions"
            >
              {isRowPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-signal-500" strokeWidth={2.2} />
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
                  markCompletedDisabled={false}
                  deleteBusy={isDeletePending}
                  onToggleShowcase={() => onToggleShowcase(sprint)}
                  onClose={() => setMenuOpen(false)}
                  markCompletedIcon="square"
                  role="menuitem"
                  buttonClassName="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus:outline-none"
                />
              }
            >
              <button
                type="button"
                disabled={isRowPending}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                title="Open sprint actions"
              >
                {isRowPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-signal-500" strokeWidth={2.2} />
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
