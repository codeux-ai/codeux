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
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { SprintReviewBadge } from "./SprintReviewBadge.js";
import type { Sprint, SprintStatus } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import { formatSprintKey, STATUS_LABELS } from "../../lib/sprint-ledger-state.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { SprintControls } from "./SprintControls.js";
import { getSprintStatusPresentation } from "../../lib/sprint-status-presentation.js";

// Polished badge tones: increased contrast for backgrounds and borders where appropriate
const STATUS_BADGE_TONES: Record<SprintStatus, string> = {
  running: "border-status-green/25 bg-status-green/10 text-status-green",
  paused: "border-ember-500/25 bg-ember-500/10 text-ember-600 dark:text-ember-400",
  completed: "border-slate-300/35 bg-slate-900/[0.04] text-slate-600 dark:border-white/15 dark:bg-white/[0.07] dark:text-slate-300",
  failed: "border-status-red/25 bg-status-red/10 text-status-red",
  cancelled: "border-slate-300/35 bg-slate-100/80 text-slate-500 dark:border-white/15 dark:bg-white/[0.05] dark:text-slate-400",
  idle: "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-300",
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

const shortenId = (value: string): string => value.slice(0, 8);
const formatTableDate = (value: string): string => TABLE_DATE_FORMATTER.format(new Date(value));
const formatMetaDate = (value: string): string => TABLE_META_DATE_FORMATTER.format(new Date(value));

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
  onOpenRowMenu: (event: MouseEvent, sprintId: string) => void;
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

  return (
    <tr
      className={`group mb-3 block overflow-hidden rounded-[1.5rem] border shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)] focus-within:ring-2 focus-within:ring-signal-500/20 dark:shadow-[0_16px_40px_rgba(0,0,0,0.18)] lg:table-row lg:overflow-visible lg:rounded-none lg:border-0 lg:shadow-none lg:hover:translate-y-0 lg:hover:shadow-none ${rowTone} ${isCompleted ? "text-slate-500 dark:text-slate-400" : ""} ${isDeletePending ? "grayscale opacity-50" : ""} hover:bg-gradient-to-r hover:from-white/50 hover:to-transparent dark:hover:from-white/5`}
    >
      <td className={`block px-4 pb-0 pt-4 align-middle lg:table-cell lg:w-12 lg:rounded-l-[1.5rem] lg:border-y lg:border-l lg:px-4 lg:py-4 lg:pl-6 ${desktopCellTone}`}>
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
      </td>
      <td className={`block px-4 py-3 align-middle lg:table-cell lg:w-20 lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
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
      </td>
      <td className={`block px-4 py-3 align-middle lg:table-cell lg:min-w-[8rem] lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Sprint ID</span>
        <div className="font-mono text-sm font-bold text-slate-800 dark:text-white truncate">{formatSprintKey(sprint, sprintKeyPrefix)}</div>
        <div className="mt-1 text-[10px] font-bold text-slate-400 truncate">
          {shortenId(sprint.id)}
        </div>
      </td>
      <td className={`block min-w-0 max-w-full px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Sprint</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`font-display text-lg font-black leading-tight break-words ${isCompleted ? "text-slate-700 dark:text-slate-300" : "text-slate-900 dark:text-white"}`}>{sprint.name}</div>
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
            Created {formatTableDate(sprint.createdAt)}
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
              <span
                key={issue.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-black/[0.08] bg-black/[0.03] px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-slate-300"
                title={issue.title}
              >
                <Link2 className="h-3 w-3" strokeWidth={2.2} />
                {issue.issueKey}
              </span>
            ))}
          </div>
        )}
        {sprint.goal ? (
          <p className={`mt-3 max-w-2xl text-sm leading-relaxed ${isCompleted ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
            {sprint.goal}
          </p>
        ) : null}
      </td>
      <td className={`block px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-start">
          <span className="text-[10px] font-bold text-slate-400 lg:hidden">Status</span>
          <span className={`inline-flex rounded-full border px-3 py-1.5 text-[11px] font-bold ${STATUS_BADGE_TONES[sprint.status]}`}>
            {STATUS_LABELS[sprint.status]}
          </span>
          {showInterventionBadge && isSprintActionable(sprint.status) && (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-status-amber">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />
              Intervention
            </div>
          )}
        </div>
      </td>
      <td className={`block px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Tasks</span>
        <div className="flex items-center gap-3 lg:block">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/70 text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] lg:hidden">
            <ListChecks className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div>
            <div className="font-mono text-lg font-bold text-slate-800 dark:text-white">{sprint.tasksCount}</div>
            <div className="text-[11px] text-slate-400">planned tasks</div>
          </div>
        </div>
      </td>
      <td className={`block px-4 py-3 align-middle lg:table-cell lg:min-w-[12rem] lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Completion</span>
        <div className="flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/10 ring-1 ring-black/[0.03] dark:bg-white/[0.08] dark:ring-white/[0.04]">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${progressTone} transition-[width] duration-500 ease-out`}
              style={{ width: `${sprint.completion}%` }}
            />
          </div>
          <span className="font-mono text-sm font-bold text-slate-800 dark:text-white">{sprint.completion}%</span>
        </div>
      </td>
      <td className={`block px-4 py-3 align-middle lg:table-cell lg:border-y lg:px-4 lg:py-4 ${desktopCellTone}`}>
        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Created</span>
        <div className="font-medium text-slate-700 dark:text-slate-200">{formatTableDate(sprint.createdAt)}</div>
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
      </td>
      <td className={`block px-4 pb-4 pt-3 align-middle lg:table-cell lg:rounded-r-[1.5rem] lg:border-y lg:border-r lg:px-4 lg:py-4 lg:pr-6 ${desktopCellTone}`}>
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
          <button
            type="button"
            onClick={(event) => onOpenRowMenu(event, sprint.id)}
            disabled={isRowPending}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Open sprint actions"
          >
            {isRowPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-signal-500" strokeWidth={2.2} />
            ) : (
              <MoreVertical className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
};

export const SprintLedgerRow = memo(SprintLedgerRowComponent);
