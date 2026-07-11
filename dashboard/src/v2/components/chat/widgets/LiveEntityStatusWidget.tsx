import { type FunctionComponent } from "preact";
import { ExternalLink, GitMerge, ListChecks, Milestone, Route } from "lucide-preact";
import { ChatWidgetFrame, type ExecutionStatus } from "./ChatWidgetFrame.js";
import { StatusDot } from "../../ui/StatusDot.js";
import { EXECUTOR_LABEL, PRIORITY_CFG } from "../../../lib/tasks-constants.js";
import { getStatusConfig } from "../../../lib/status-labels.js";
import type { ChatLiveEntityWidget, ChatLiveSprintWidget, ChatLiveTaskWidget } from "../../../lib/chat-live-entities.js";
import type { SprintStatus, TaskStatus } from "../../../types.js";
import { clampSprintCompletion, formatSprintCompletion } from "../../../lib/sprint-progress-display.js";

export interface LiveEntityStatusWidgetProps {
  entities: readonly ChatLiveEntityWidget[];
}

const TASK_STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "coding_completed", "completed", "QA_REVIEW_FAILED"];
const SPRINT_STATUSES: readonly SprintStatus[] = ["running", "paused", "completed", "failed", "cancelled", "idle"];

const sprintStatusLabels: Record<SprintStatus, string> = {
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  idle: "Idle",
};

const taskStatusSet = new Set<string>(TASK_STATUSES);
const sprintStatusSet = new Set<string>(SPRINT_STATUSES);

const isTaskStatus = (status: string): status is TaskStatus => taskStatusSet.has(status);
const isSprintStatus = (status: string): status is SprintStatus => sprintStatusSet.has(status);

const formatUnknownStatus = (status: string): string => {
  const trimmed = status.trim();
  if (!trimmed) {
    return "Unknown";
  }
  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const getTaskStatusLabel = (status: string): string => getStatusConfig(status).label;

const getSprintStatusLabel = (status: string): string => (
  isSprintStatus(status) ? sprintStatusLabels[status] : formatUnknownStatus(status)
);

const getDotStatus = (entity: ChatLiveEntityWidget): TaskStatus | SprintStatus => {
  if (entity.kind === "task" && isTaskStatus(entity.status)) {
    return entity.status;
  }
  if (entity.kind === "sprint" && isSprintStatus(entity.status)) {
    return entity.status;
  }
  return "idle";
};

const getFrameStatus = (entities: readonly ChatLiveEntityWidget[]): ExecutionStatus => {
  if (entities.some((entity) => ["failed", "QA_REVIEW_FAILED", "cancelled"].includes(entity.status))) {
    return "failed";
  }
  if (entities.some((entity) => ["running", "in_progress", "coding_completed"].includes(entity.status))) {
    return "running";
  }
  if (entities.every((entity) => entity.status === "completed")) {
    return "completed";
  }
  return "queued";
};

const getSprintHref = (entity: ChatLiveSprintWidget): string => {
  if (entity.sprintNumber !== null && entity.displayKey) {
    return `/sprints?sprintKey=${encodeURIComponent(entity.displayKey)}`;
  }
  return entity.href;
};

const formatTaskCount = (count: number): string => `${count} task${count === 1 ? "" : "s"}`;

const EntityMetaChip: FunctionComponent<{ label: string; value: string }> = ({ label, value }) => (
  <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-black/[0.06] bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
    <span className="shrink-0 text-slate-400">{label}</span>
    <span className="min-w-0 break-words font-semibold text-slate-800 dark:text-slate-100">{value}</span>
  </span>
);

const SprintEntityCard: FunctionComponent<{ entity: ChatLiveSprintWidget }> = ({ entity }) => {
  const completion = clampSprintCompletion(entity.completion);
  const completionLabel = formatSprintCompletion(completion);
  const statusLabel = getSprintStatusLabel(entity.status);
  const taskCountLabel = formatTaskCount(entity.tasksCount);
  const ariaLabel = `Open sprint ${entity.displayKey}: ${entity.name}. Live status: ${statusLabel}.`;

  return (
    <a
      href={getSprintHref(entity)}
      className="group block min-w-0 rounded-xl border border-black/[0.06] bg-white/65 p-3 text-left transition hover:border-signal-500/30 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-signal-500/35 dark:hover:bg-white/[0.05]"
      aria-label={ariaLabel}
      data-testid={`live-entity-sprint-${entity.recordId}`}
    >
      <article className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal-500/10 text-signal-700 dark:text-signal-300">
            <Milestone className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="max-w-full rounded-md bg-slate-900 px-2 py-1 font-mono text-[11px] font-bold text-white break-words dark:bg-white dark:text-slate-950">
                {entity.displayKey}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <StatusDot status={getDotStatus(entity)} className="h-2 w-2" />
                <span>{statusLabel}</span>
              </span>
            </div>
            <h3
              className="m-0 mt-1 text-[14px] font-semibold leading-5 text-slate-950 break-words whitespace-normal dark:text-white"
              data-testid={`live-entity-title-${entity.recordId}`}
            >
              {entity.name}
            </h3>
          </div>
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:text-signal-600 dark:group-hover:text-signal-300" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{completionLabel} complete</span>
            <span>{entity.completedTasks}/{entity.tasksCount} complete</span>
          </div>
          <div
            role="progressbar"
            aria-label={`Sprint completion for ${entity.displayKey}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completion}
            className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]"
          >
            <div className="h-full rounded-full bg-signal-500 transition-[width] duration-300" style={{ width: `${completion}%` }} />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap gap-1.5">
          <EntityMetaChip label="Tasks" value={taskCountLabel} />
          <EntityMetaChip label="Done" value={String(entity.completedTasks)} />
        </div>
        <span className="sr-only">Sprint {entity.displayKey}, {entity.name}, status {statusLabel}.</span>
      </article>
    </a>
  );
};

const TaskEntityCard: FunctionComponent<{ entity: ChatLiveTaskWidget }> = ({ entity }) => {
  const statusLabel = getTaskStatusLabel(entity.status);
  const priorityLabel = PRIORITY_CFG[entity.priority]?.label ?? formatUnknownStatus(entity.priority);
  const executorLabel = EXECUTOR_LABEL[entity.executorType] ?? formatUnknownStatus(entity.executorType);
  const mergeLabel = entity.mergeIndicator ?? (entity.isMerged ? "Merged" : null);
  const ariaLabel = `Open task ${entity.displayKey}: ${entity.name}. Live status: ${statusLabel}.`;

  return (
    <a
      href={entity.href}
      className="group block min-w-0 rounded-xl border border-black/[0.06] bg-white/65 p-3 text-left transition hover:border-signal-500/30 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:border-signal-500/35 dark:hover:bg-white/[0.05]"
      aria-label={ariaLabel}
      data-testid={`live-entity-task-${entity.recordId}`}
    >
      <article className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="max-w-full rounded-md bg-slate-900 px-2 py-1 font-mono text-[11px] font-bold text-white break-words dark:bg-white dark:text-slate-950">
                {entity.displayKey}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <StatusDot status={getDotStatus(entity)} className="h-2 w-2" />
                <span>{statusLabel}</span>
              </span>
            </div>
            <h3
              className="m-0 mt-1 text-[14px] font-semibold leading-5 text-slate-950 break-words whitespace-normal dark:text-white"
              data-testid={`live-entity-title-${entity.recordId}`}
            >
              {entity.name}
            </h3>
            {entity.sprintKey || entity.sprintName ? (
              <div className="mt-1 inline-flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <Route className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{entity.sprintKey ?? entity.sprintName}</span>
              </div>
            ) : null}
          </div>
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:text-signal-600 dark:group-hover:text-signal-300" aria-hidden="true" />
        </div>

        <div className="flex min-w-0 flex-wrap gap-1.5">
          <EntityMetaChip label="Priority" value={priorityLabel} />
          <EntityMetaChip label="Executor" value={executorLabel} />
          {mergeLabel ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <GitMerge className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{mergeLabel}</span>
            </span>
          ) : null}
        </div>
        <span className="sr-only">Task {entity.displayKey}, {entity.name}, status {statusLabel}.</span>
      </article>
    </a>
  );
};

export const LiveEntityStatusWidget: FunctionComponent<LiveEntityStatusWidgetProps> = ({ entities }) => {
  if (entities.length === 0) {
    return null;
  }

  return (
    <ChatWidgetFrame
      status={getFrameStatus(entities)}
      header={
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Live sprint context</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{entities.length} linked entit{entities.length === 1 ? "y" : "ies"}</div>
          </div>
        </div>
      }
    >
      <div className="grid min-w-0 gap-2" aria-label="Live sprint and task status">
        {entities.map((entity) => (
          entity.kind === "sprint"
            ? <SprintEntityCard key={`${entity.kind}:${entity.recordId}`} entity={entity} />
            : <TaskEntityCard key={`${entity.kind}:${entity.recordId}`} entity={entity} />
        ))}
      </div>
    </ChatWidgetFrame>
  );
};
