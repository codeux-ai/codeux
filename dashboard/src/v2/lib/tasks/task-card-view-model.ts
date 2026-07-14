import type { Task, TaskStatus, TaskExecutorType } from "../../types.js";
import type { CiStatusPresentation } from "../ci-status-presentation.js";
import { type LiveTaskEnrichment } from "./live-task-enrichment.js";
import { formatDuration } from "../format-duration.js";

export interface DependencyIndicator {
  recordId: string;
  id: string;
  title: string;
  status: TaskStatus;
  isKnown?: boolean;
  stateLabel?: string;
  stateDescription?: string;
  isBlocking?: boolean;
}

export interface TaskCardViewModel {
  task: Task;
  humanizedCreatedAt: string;
  executorLabel: string;
  dependencyIndicators: DependencyIndicator[];
  dependencyActionLabel?: string;
  qaReviewLabel?: string;
  ciStatusPresentation?: CiStatusPresentation | null;
  ciStatusSourceSignature?: string;
  optimisticSavingLabel?: string | null;
  dragStateLabel?: string;
  actions?: TaskCardActionDescriptor[];
  selfReflectionRating?: Task["selfReflectionRating"];
  sessionId?: string;
  sessionState?: string;
  hasPullRequestMetadata?: boolean;
  prUrl?: string;
  liveRunningTime?: string;
  liveStartedAt?: string | null;
}

export type TaskCardActionKind = "rerun" | "preview" | "pull_request" | "live_runtime";

export interface TaskCardActionDescriptor {
  kind: TaskCardActionKind;
  label: string;
  ariaLabel: string;
  title: string;
  href?: string;
  external?: boolean;
  disabledReason?: string;
}

export interface TaskCardViewModelOptions {
  taskPullRequestsEnabled?: boolean;
  ciStatusPresentation?: CiStatusPresentation | null;
  ciStatusSourceSignature?: string;
}

const EXECUTOR_LABEL: Record<TaskExecutorType, string> = {
  auto: "Auto",
  docker_cli: "CLI",
  jules: "Jules",
  mcp_worker: "Worker",
};

export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (isNaN(timestamp)) {
    return "--";
  }

  const mins = Math.floor((now - timestamp) / 60000);
  if (mins < 0) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function getExecutorLabel(executorType: TaskExecutorType): string {
  return EXECUTOR_LABEL[executorType] || "Unknown";
}

export function getDependencyPresentation(status: TaskStatus, isKnown = true): Pick<DependencyIndicator, "stateLabel" | "stateDescription" | "isBlocking"> {
  if (!isKnown) {
    return {
      stateLabel: "Unknown",
      stateDescription: "Dependency record is missing",
      isBlocking: true,
    };
  }

  switch (status) {
    case "completed":
      return {
        stateLabel: "Resolved",
        stateDescription: "Dependency completed",
        isBlocking: false,
      };
    case "coding_completed":
      return {
        stateLabel: "Ready for QA",
        stateDescription: "Dependency coding is complete and awaiting QA",
        isBlocking: true,
      };
    case "in_progress":
      return {
        stateLabel: "In progress",
        stateDescription: "Dependency is currently running",
        isBlocking: true,
      };
    case "QA_REVIEW_FAILED":
      return {
        stateLabel: "QA failed",
        stateDescription: "Dependency failed QA review",
        isBlocking: true,
      };
    case "pending":
    default:
      return {
        stateLabel: "Blocked",
        stateDescription: "Dependency is waiting to start",
        isBlocking: true,
      };
  }
}

function buildDependencyActionLabel(indicators: DependencyIndicator[]): string {
  if (indicators.length === 0) {
    return "Dependencies clear";
  }

  const blockerCount = indicators.filter((dep) => dep.isBlocking).length;
  if (blockerCount === 0) {
    return `${indicators.length} dependencies clear`;
  }

  return `${blockerCount} dependency ${blockerCount === 1 ? "blocker" : "blockers"}`;
}

function buildTaskCardActions(
  task: Task,
  prUrl?: string,
  hasLiveRuntime = false,
  taskPullRequestsEnabled = true,
): TaskCardActionDescriptor[] {
  const target = `task ${task.id}: ${task.title}`;
  const actions: TaskCardActionDescriptor[] = [
    {
      kind: "rerun",
      label: "Rerun",
      ariaLabel: `Rerun ${target}`,
      title: "Rerun is available from the Live task detail workflow.",
      disabledReason: `Open Live to rerun task ${task.id}.`,
    },
    {
      kind: "preview",
      label: "Preview",
      ariaLabel: `Open sprint preview for ${target}`,
      title: task.sprintId ? "Open the sprint preview workspace." : "Select a sprint before opening preview.",
      href: task.sprintId ? `/browser?sprintId=${encodeURIComponent(task.sprintId)}` : undefined,
      disabledReason: task.sprintId ? undefined : `Task ${task.id} has no sprint preview.`,
    },
  ];

  if (taskPullRequestsEnabled || prUrl) {
    actions.push({
      kind: "pull_request",
      label: prUrl ? "PR" : "PR pending",
      ariaLabel: `Open pull request for ${target}`,
      title: prUrl ? "Open pull request in a new tab." : "No pull request is available yet.",
      href: prUrl,
      external: true,
      disabledReason: prUrl ? undefined : `No pull request is available for task ${task.id} yet.`,
    });
  }

  actions.push(
    {
      kind: "live_runtime",
      label: hasLiveRuntime ? "Live" : "Live idle",
      ariaLabel: `Open live runtime for ${target}`,
      title: hasLiveRuntime ? "Open the live runtime page." : "Runtime has not started for this task.",
      href: hasLiveRuntime ? "/live" : undefined,
      disabledReason: hasLiveRuntime ? undefined : `Live runtime has not started for task ${task.id}.`,
    },
  );

  return actions;
}

export function buildTaskCardViewModel(
  task: Task,
  taskLookup: Map<string, Task>,
  liveEnrichment?: LiveTaskEnrichment,
  options: TaskCardViewModelOptions = {},
): TaskCardViewModel {
  const dependencyIndicators: DependencyIndicator[] = (task.dependsOnTaskIds || []).map(depId => {
    const depTask = taskLookup.get(depId);
    if (!depTask) {
      const presentation = getDependencyPresentation("pending", false);
      return {
        recordId: depId,
        id: depId,
        title: `Unknown Task (${depId})`,
        status: "pending", // default fallback
        isKnown: false,
        ...presentation,
      };
    }
    const presentation = getDependencyPresentation(depTask.status);
    return {
      recordId: depTask.recordId,
      id: depTask.id,
      title: depTask.title,
      status: depTask.status,
      isKnown: true,
      ...presentation,
    };
  });
  const liveRunningTime = liveEnrichment?.liveTotalSeconds && liveEnrichment.liveTotalSeconds > 0
    ? formatDuration(liveEnrichment.liveTotalSeconds)
    : undefined;
  const hasLiveRuntime = Boolean(liveEnrichment?.sessionId || liveEnrichment?.sessionState || liveRunningTime);
  const prUrl = liveEnrichment?.prUrl || undefined;
  const taskPullRequestsEnabled = options.taskPullRequestsEnabled ?? true;
  const hasPullRequestMetadata = Boolean(prUrl || taskPullRequestsEnabled);

  return {
    task,
    humanizedCreatedAt: formatTimeAgo(task.createdAt),
    executorLabel: getExecutorLabel(task.executorType),
    dependencyIndicators,
    dependencyActionLabel: buildDependencyActionLabel(dependencyIndicators),
    qaReviewLabel: task.latestReview ? undefined : "QA no review",
    ciStatusPresentation: options.ciStatusPresentation ?? null,
    ciStatusSourceSignature: options.ciStatusSourceSignature ?? "",
    optimisticSavingLabel: task.isOptimistic ? "Saving task changes" : null,
    dragStateLabel: task.isOptimistic
      ? "Pointer drag disabled while task changes are saving; keyboard reordering is not supported"
      : "Pointer drag only; keyboard reordering is not supported",
    actions: buildTaskCardActions(task, prUrl, hasLiveRuntime, taskPullRequestsEnabled),
    selfReflectionRating: task.selfReflectionRating,
    sessionId: liveEnrichment?.sessionId,
    sessionState: liveEnrichment?.sessionState,
    hasPullRequestMetadata,
    prUrl,
    liveRunningTime,
    liveStartedAt: liveEnrichment?.liveStartedAt,
  };
}
