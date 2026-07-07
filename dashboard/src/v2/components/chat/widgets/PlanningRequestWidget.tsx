import { type FunctionComponent } from "preact";
import { AlertTriangle, CheckCircle2, Circle, Clock3, Loader2, PauseCircle, XCircle } from "lucide-preact";
import { ChatWidgetFrame, type ExecutionStatus } from "./ChatWidgetFrame.js";
import { ContainerShip } from "../../ui/PlanningShip.js";
import { ChatRuntimeBadge } from "../ChatRuntimeBadge.js";
import type {
  LivePlanningTaskState,
  LivePlanningWidgetState,
  PlanningExecutionPlanWidgetState,
} from "../../../lib/chat-widget-view-models.js";

export interface PlanningRequestWidgetProps {
  status: ExecutionStatus;
  planName: string;
  isDark?: boolean;
  liveStatus?: LivePlanningWidgetState;
  executionPlan?: PlanningExecutionPlanWidgetState;
}

const statusTone: Record<LivePlanningTaskState["statusKind"], string> = {
  queued: "border-slate-300/60 bg-slate-200/45 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300",
  running: "border-signal-500/30 bg-signal-500/10 text-signal-700 dark:text-signal-300",
  review: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-status-red/30 bg-status-red/10 text-status-red",
  blocked: "border-status-amber/35 bg-status-amber/10 text-status-amber",
  quota: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  unknown: "border-slate-300/60 bg-slate-200/45 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300",
};

const TaskStatusIcon: FunctionComponent<{ statusKind: LivePlanningTaskState["statusKind"] }> = ({ statusKind }) => {
  switch (statusKind) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5" aria-hidden="true" />;
    case "blocked":
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    case "quota":
      return <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />;
    case "review":
      return <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />;
    case "queued":
    case "unknown":
    default:
      return <Circle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
};

const LivePlanningStatusCard: FunctionComponent<{ liveStatus: LivePlanningWidgetState }> = ({ liveStatus }) => {
  const visibleTasks = liveStatus.tasks.slice(0, 10);
  const hiddenTaskCount = Math.max(0, liveStatus.tasks.length - visibleTasks.length);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
            {liveStatus.sprintKey}
          </div>
          <div className="mt-0.5 truncate text-[14px] font-semibold text-slate-900 dark:text-white">
            {liveStatus.sprintName}
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-1 text-right font-mono text-[12px] font-bold tabular-nums text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100">
          {liveStatus.progressLabel}
        </div>
      </div>

      <div>
        <div
          role="progressbar"
          aria-label={`Sprint progress for ${liveStatus.sprintName}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={liveStatus.percentComplete}
          className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]"
        >
          <div
            className="h-full rounded-full bg-signal-500 transition-[width] duration-300"
            style={{ width: `${liveStatus.percentComplete}%` }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{liveStatus.completedTasks} completed</span>
          <span>{liveStatus.queuedTasks} queued</span>
          <span>{liveStatus.totalTasks} total</span>
        </div>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-3">
        <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Request</div>
          <div className="mt-0.5 truncate text-[12px] font-semibold">{liveStatus.materialization.requestLabel}</div>
        </div>
        <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Tasks</div>
          <div className="mt-0.5 truncate text-[12px] font-semibold">{liveStatus.materialization.taskRecordsLabel}</div>
        </div>
        <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Run</div>
          <div className="mt-0.5 truncate text-[12px] font-semibold">{liveStatus.materialization.runLabel}</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {visibleTasks.map((task) => (
          <div
            key={task.id}
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-black/[0.04] bg-white/60 px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-semibold text-slate-400">{task.id}</div>
              <div className="truncate text-[12px] font-medium text-slate-800 dark:text-slate-200">{task.title}</div>
            </div>
            <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold ${statusTone[task.statusKind]}`}>
              <TaskStatusIcon statusKind={task.statusKind} />
              <span>{task.statusLabel}</span>
              {task.detailLabel ? <span className="font-medium opacity-80">({task.detailLabel})</span> : null}
            </span>
          </div>
        ))}
        {hiddenTaskCount > 0 && (
          <div className="rounded-lg border border-dashed border-black/[0.08] px-2.5 py-2 text-[12px] font-medium text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
            {hiddenTaskCount} more task{hiddenTaskCount === 1 ? "" : "s"} in this sprint
          </div>
        )}
      </div>
    </div>
  );
};

const PersistedExecutionPlanCard: FunctionComponent<{ executionPlan: PlanningExecutionPlanWidgetState }> = ({ executionPlan }) => {
  const visibleTasks = executionPlan.tasks.slice(0, 5);
  const hiddenTaskCount = Math.max(0, executionPlan.tasks.length - visibleTasks.length);
  const visibleCreatedTaskIds = visibleTasks.length === 0 ? executionPlan.createdTaskIds.slice(0, 5) : [];
  const hiddenCreatedTaskCount = visibleTasks.length === 0
    ? Math.max(0, executionPlan.createdTaskIds.length - visibleCreatedTaskIds.length)
    : 0;

  return (
    <div className="min-w-0 space-y-3">
      <span className="sr-only">{executionPlan.ariaLabel}</span>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {executionPlan.sprintKey ? (
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
              {executionPlan.sprintKey}
            </div>
          ) : null}
          <div className="mt-0.5 truncate text-[14px] font-semibold text-slate-900 dark:text-white">
            {executionPlan.sprintName}
          </div>
        </div>
        <div className="shrink-0 rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-1 text-right font-mono text-[12px] font-bold tabular-nums text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100">
          {executionPlan.taskSummaryLabel}
        </div>
      </div>

      {executionPlan.goal ? (
        <p className="line-clamp-2 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
          {executionPlan.goal}
        </p>
      ) : null}

      {visibleTasks.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Planned task summaries">
          {visibleTasks.map((task) => (
            <li
              key={task.id}
              className="flex min-w-0 flex-col gap-1 rounded-lg border border-black/[0.04] bg-white/60 px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono text-[10px] font-semibold text-slate-400">{task.id}</span>
                <span className="truncate text-[12px] font-medium text-slate-800 dark:text-slate-200">{task.title}</span>
              </div>
              {task.summary ? (
                <div className="line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{task.summary}</div>
              ) : null}
            </li>
          ))}
          {hiddenTaskCount > 0 ? (
            <li className="rounded-lg border border-dashed border-black/[0.08] px-2.5 py-2 text-[12px] font-medium text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
              {hiddenTaskCount} more task{hiddenTaskCount === 1 ? "" : "s"} in this execution plan
            </li>
          ) : null}
        </ul>
      ) : visibleCreatedTaskIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Created task ids">
          {visibleCreatedTaskIds.map((taskId) => (
            <span
              key={taskId}
              className="rounded-md border border-black/[0.06] bg-white/60 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300"
            >
              {taskId}
            </span>
          ))}
          {hiddenCreatedTaskCount > 0 ? (
            <span className="rounded-md border border-dashed border-black/[0.08] px-2 py-1 text-[11px] font-medium text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
              +{hiddenCreatedTaskCount} more
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const PlanningRequestWidget: FunctionComponent<PlanningRequestWidgetProps> = ({
  status,
  planName,
  isDark = true,
  liveStatus,
  executionPlan,
}) => {
  return (
    <ChatWidgetFrame
      status={status}
      header={
        <div class="flex items-center gap-2">
          <ChatRuntimeBadge status={status} label={`Planning: ${planName}`} />
          <span>{planName}</span>
        </div>
      }
    >
      {liveStatus ? (
        <LivePlanningStatusCard liveStatus={liveStatus} />
      ) : executionPlan ? (
        <PersistedExecutionPlanCard executionPlan={executionPlan} />
      ) : (
      <div class="flex flex-col items-center justify-center p-4 min-h-[120px]">
        {status === 'running' || status === 'queued' ? (
          <div class="relative w-full max-w-[200px] h-20 mb-4 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
             <div class="ocean-wave w-full h-full flex items-center justify-center">
               <svg viewBox="-60 -40 120 80" class="w-full h-full transform translate-y-2 ship-bob" aria-hidden="true">
                 {/* @ts-ignore */}
                 <ContainerShip accentColor="#00E0A0" isMoving={status === 'running'} isDark={isDark} />
               </svg>
             </div>
          </div>
        ) : null}

        <div class="text-center text-sm">
          {status === 'queued' && <span class="text-slate-500">Preparing to plan...</span>}
          {status === 'running' && <span class="text-signal-600 dark:text-signal-400 font-medium animate-pulse">Navigating solutions...</span>}
          {status === 'completed' && <span class="text-slate-600 dark:text-slate-400">Plan formulated successfully.</span>}
          {status === 'failed' && <span class="text-red-600 dark:text-red-400 font-medium">Failed to create a plan.</span>}
        </div>
      </div>
      )}
    </ChatWidgetFrame>
  );
};
