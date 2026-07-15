import type { ExecutionAttentionItemSummary } from "../../../types.js";
import type { Task, TaskStatus, TaskExecutorType } from "../../types.js";
import type { CiStatusPresentation } from "../ci-status-presentation.js";
import { type LiveTaskEnrichment } from "./live-task-enrichment.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateTask, translateTaskPlural } from "../../i18n/messages/tasks.js";

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
  presentationLocale?: DashboardLocale;
  humanizedCreatedAt: string;
  executorLabel: string;
  dependencyIndicators: DependencyIndicator[];
  dependencyActionLabel?: string;
  qaReviewLabel?: string;
  ciStatusPresentation?: CiStatusPresentation | null;
  humanIntervention?: ExecutionAttentionItemSummary | null;
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
  humanIntervention?: ExecutionAttentionItemSummary | null;
  ciStatusSourceSignature?: string;
  locale?: DashboardLocale;
}

const EXECUTOR_LABEL: Record<TaskExecutorType, string> = {
  auto: "Auto",
  docker_cli: "CLI",
  jules: "Jules",
  mcp_worker: "Worker",
};

export function formatTaskDuration(totalSeconds: number, locale: DashboardLocale = "en"): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const number = new Intl.NumberFormat(locale);
  if (locale === "en") {
    if (hours > 0) return `${number.format(hours)}h ${number.format(minutes)}m ${number.format(remainingSeconds)}s`;
    if (minutes > 0) return `${number.format(minutes)}m ${number.format(remainingSeconds)}s`;
    return `${number.format(remainingSeconds)}s`;
  }
  if (hours > 0) return `${number.format(hours)} Std. ${number.format(minutes)} Min. ${number.format(remainingSeconds)} Sek.`;
  if (minutes > 0) return `${number.format(minutes)} Min. ${number.format(remainingSeconds)} Sek.`;
  return `${number.format(remainingSeconds)} Sek.`;
}

export function formatTimeAgo(iso: string, now: number = Date.now(), locale: DashboardLocale = "en"): string {
  const timestamp = new Date(iso).getTime();
  if (isNaN(timestamp)) {
    return "--";
  }

  const mins = Math.floor((now - timestamp) / 60000);
  if (mins < 0) return translateTask(locale, "justNow");
  if (mins < 60) return translateTask(locale, "minutesAgo", { count: new Intl.NumberFormat(locale).format(mins) });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return translateTask(locale, "hoursAgo", { count: new Intl.NumberFormat(locale).format(hrs) });
  return translateTask(locale, "daysAgo", { count: new Intl.NumberFormat(locale).format(Math.floor(hrs / 24)) });
}

export function getExecutorLabel(executorType: TaskExecutorType): string {
  return EXECUTOR_LABEL[executorType] || "Unknown";
}

export function getDependencyPresentation(status: TaskStatus, isKnown = true, locale: DashboardLocale = "en"): Pick<DependencyIndicator, "stateLabel" | "stateDescription" | "isBlocking"> {
  if (!isKnown) {
    return {
      stateLabel: translateTask(locale, "unknown"),
      stateDescription: translateTask(locale, "dependencyMissing"),
      isBlocking: true,
    };
  }

  switch (status) {
    case "completed":
      return {
        stateLabel: translateTask(locale, "resolved"),
        stateDescription: translateTask(locale, "dependencyCompleted"),
        isBlocking: false,
      };
    case "coding_completed":
      return {
        stateLabel: translateTask(locale, "readyForQa"),
        stateDescription: translateTask(locale, "dependencyAwaitingQa"),
        isBlocking: true,
      };
    case "in_progress":
      return {
        stateLabel: translateTask(locale, "inProgressLower"),
        stateDescription: translateTask(locale, "dependencyRunning"),
        isBlocking: true,
      };
    case "QA_REVIEW_FAILED":
      return {
        stateLabel: translateTask(locale, "qaFailedLower"),
        stateDescription: translateTask(locale, "dependencyFailedQa"),
        isBlocking: true,
      };
    case "pending":
    default:
      return {
        stateLabel: translateTask(locale, "blocked"),
        stateDescription: translateTask(locale, "dependencyWaiting"),
        isBlocking: true,
      };
  }
}

function buildDependencyActionLabel(indicators: DependencyIndicator[], locale: DashboardLocale): string {
  if (indicators.length === 0) {
    return translateTask(locale, "dependenciesClear");
  }

  const blockerCount = indicators.filter((dep) => dep.isBlocking).length;
  if (blockerCount === 0) {
    return translateTask(locale, "dependenciesClearCount", { count: new Intl.NumberFormat(locale).format(indicators.length) });
  }

  return translateTaskPlural(locale, "dependencyBlockers", blockerCount, { count: new Intl.NumberFormat(locale).format(blockerCount) });
}

function buildTaskCardActions(
  task: Task,
  prUrl?: string,
  hasLiveRuntime = false,
  taskPullRequestsEnabled = true,
  locale: DashboardLocale = "en",
): TaskCardActionDescriptor[] {
  const actions: TaskCardActionDescriptor[] = [
    {
      kind: "rerun",
      label: translateTask(locale, "rerun"),
      ariaLabel: translateTask(locale, "rerunTarget", { id: task.id, title: task.title }),
      title: translateTask(locale, "rerunLiveTitle"),
      disabledReason: translateTask(locale, "rerunLiveReason", { id: task.id }),
    },
    {
      kind: "preview",
      label: translateTask(locale, "preview"),
      ariaLabel: translateTask(locale, "previewTarget", { id: task.id, title: task.title }),
      title: translateTask(locale, task.sprintId ? "previewOpen" : "previewSelectSprint"),
      href: task.sprintId ? `/browser?sprintId=${encodeURIComponent(task.sprintId)}` : undefined,
      disabledReason: task.sprintId ? undefined : translateTask(locale, "previewUnavailable", { id: task.id }),
    },
  ];

  if (taskPullRequestsEnabled || prUrl) {
    actions.push({
      kind: "pull_request",
      label: prUrl ? "PR" : translateTask(locale, "prPending"),
      ariaLabel: translateTask(locale, "prTarget", { id: task.id, title: task.title }),
      title: translateTask(locale, prUrl ? "prOpenNewTab" : "prNoAvailable"),
      href: prUrl,
      external: true,
      disabledReason: prUrl ? undefined : translateTask(locale, "prNoAvailableTask", { id: task.id }),
    });
  }

  actions.push(
    {
      kind: "live_runtime",
      label: translateTask(locale, hasLiveRuntime ? "live" : "liveIdle"),
      ariaLabel: translateTask(locale, "liveTarget", { id: task.id, title: task.title }),
      title: translateTask(locale, hasLiveRuntime ? "liveOpen" : "liveNotStartedTask"),
      href: hasLiveRuntime ? "/live" : undefined,
      disabledReason: hasLiveRuntime ? undefined : translateTask(locale, "liveNotStartedTaskId", { id: task.id }),
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
  const locale = options.locale ?? "en";
  const dependencyIndicators: DependencyIndicator[] = (task.dependsOnTaskIds || []).map(depId => {
    const depTask = taskLookup.get(depId);
    if (!depTask) {
      const presentation = getDependencyPresentation("pending", false, locale);
      return {
        recordId: depId,
        id: depId,
        title: translateTask(locale, "unknownTask", { id: depId }),
        status: "pending", // default fallback
        isKnown: false,
        ...presentation,
      };
    }
    const presentation = getDependencyPresentation(depTask.status, true, locale);
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
    ? formatTaskDuration(liveEnrichment.liveTotalSeconds, locale)
    : undefined;
  const hasLiveRuntime = Boolean(liveEnrichment?.sessionId || liveEnrichment?.sessionState || liveRunningTime);
  const prUrl = liveEnrichment?.prUrl || undefined;
  const taskPullRequestsEnabled = options.taskPullRequestsEnabled ?? true;
  const hasPullRequestMetadata = Boolean(prUrl || taskPullRequestsEnabled);

  return {
    task,
    presentationLocale: locale,
    humanizedCreatedAt: formatTimeAgo(task.createdAt, Date.now(), locale),
    executorLabel: getExecutorLabel(task.executorType),
    dependencyIndicators,
    dependencyActionLabel: buildDependencyActionLabel(dependencyIndicators, locale),
    qaReviewLabel: task.latestReview ? undefined : translateTask(locale, "qaNoReview"),
    ciStatusPresentation: options.ciStatusPresentation ?? null,
    humanIntervention: options.humanIntervention ?? null,
    ciStatusSourceSignature: options.ciStatusSourceSignature ?? "",
    optimisticSavingLabel: task.isOptimistic ? translateTask(locale, "savingTaskChanges") : null,
    dragStateLabel: task.isOptimistic
      ? translateTask(locale, "optimisticDragState")
      : translateTask(locale, "dragPointerOnly"),
    actions: buildTaskCardActions(task, prUrl, hasLiveRuntime, taskPullRequestsEnabled, locale),
    selfReflectionRating: task.selfReflectionRating,
    sessionId: liveEnrichment?.sessionId,
    sessionState: liveEnrichment?.sessionState,
    hasPullRequestMetadata,
    prUrl,
    liveRunningTime,
    liveStartedAt: liveEnrichment?.liveStartedAt,
  };
}
