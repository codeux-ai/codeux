import type {
  ChatMessageRecord,
  ConversationRuntimeState,
  DashboardCreateAppQuickactionKind,
  ExecutionInvocationMessageRecord,
  Task,
} from "../types.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionSprintRunSummary,
} from "../../types.js";
import type { ExecutionStatus } from "../components/chat/widgets/ChatWidgetFrame.js";
import { formatChatTime } from "./chat-time.js";
import { buildLiveSessionTasks } from "./live-session-task-structure.js";
import {
  CREATE_APP_QUICKACTION_CATALOG,
  getCreateAppQuickactionSpec,
} from "../../../../src/domain/chat/create-app-quickaction-catalog.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateChatMessage, translateChatPlural } from "../i18n/messages/chat.js";

export type ChatWidgetType = "planning" | "app_creation_progress" | "external_reference" | "none";

/** Per-turn token usage carried on tool-call invocation messages (mirrors the
 *  backend ParsedConversationTurn.tokens shape). */
export interface ParsedTurnTokens {
  input?: number;
  cached?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

export interface ChatWidgetState {
  type: ChatWidgetType;
  status: ExecutionStatus;
  planName: string;
  targetWorker?: string;
  liveStatus?: LivePlanningWidgetState;
  appCreationProgress?: AppCreationProgressWidgetState;
  executionPlan?: PlanningExecutionPlanWidgetState;
  externalReference?: ExternalReferenceWidgetState;
  suppressBodyMarkdown?: boolean;
}

export type AppCreationKind = DashboardCreateAppQuickactionKind | "unknown";

export type AppCreationProgressStageStatus = "pending" | "running" | "completed" | "failed";

export interface AppCreationStackSummaryFieldState {
  key: string;
  label: string;
  value: string;
}

export interface AppCreationStackSummaryState {
  fields: AppCreationStackSummaryFieldState[];
  emptyLabel: string;
}

export interface AppCreationProgressStageState {
  id: string;
  label: string;
  status: AppCreationProgressStageStatus;
  statusLabel: string;
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
}

export interface AppCreationProgressWidgetState {
  status: ExecutionStatus;
  statusLabel: string;
  appKind: AppCreationKind;
  appKindLabel: string;
  sprintId: string | null;
  sprintLabel: string;
  stackSummary: AppCreationStackSummaryState;
  stages: AppCreationProgressStageState[];
  suggestionTags: string[];
  quickactionRequestId: string | null;
  clientRequestId: string | null;
}

export type ExternalReferenceProvider = "jira" | "github" | "gitlab";
export type ExternalReferenceKind = "issue" | "pull_request" | "merge_request";

export interface ExternalReferenceWidgetState {
  provider: ExternalReferenceProvider;
  providerLabel: string;
  kind: ExternalReferenceKind;
  kindLabel: string;
  title: string;
  key: string | null;
  number: number | null;
  identifierLabel: string | null;
  state: string | null;
  stateLabel: string | null;
  url: string | null;
  repositoryPath: string | null;
  projectPath: string | null;
  labels: string[];
  assignee: string | null;
  author: string | null;
  preview: string | null;
  ariaLabel: string;
}

export type LivePlanningTaskStatusKind =
  | "queued"
  | "running"
  | "review"
  | "completed"
  | "failed"
  | "blocked"
  | "quota"
  | "unknown";

export interface LivePlanningTaskState {
  id: string;
  title: string;
  statusKind: LivePlanningTaskStatusKind;
  statusLabel: string;
  detailLabel: string | null;
}

export interface LivePlanningMaterializationState {
  requestLabel: string;
  taskRecordsLabel: string;
  runLabel: string;
}

export interface LivePlanningWidgetState {
  sprintId: string;
  sprintKey: string;
  sprintName: string;
  runStatus: string | null;
  totalTasks: number;
  completedTasks: number;
  queuedTasks: number;
  percentComplete: number;
  progressLabel: string;
  materialization: LivePlanningMaterializationState;
  tasks: LivePlanningTaskState[];
}

export interface PlanningExecutionPlanTaskSummaryState {
  id: string;
  title: string;
  summary: string | null;
}

export interface PlanningExecutionPlanWidgetState {
  sprintId: string | null;
  sprintNumber: number | null;
  sprintKey: string | null;
  sprintName: string;
  goal: string | null;
  taskCount: number;
  createdTaskIds: string[];
  tasks: PlanningExecutionPlanTaskSummaryState[];
  taskSummaryLabel: string;
  ariaLabel: string;
}

export interface ChatWidgetLiveData {
  projectId: string | null;
  projectTasks?: Task[] | null;
  projectTasksLoading?: boolean;
  projectTasksLoaded?: boolean;
  execution?: ExecutionDashboardSnapshot | null;
  executionLoading?: boolean;
  executionLoaded?: boolean;
  sprintKeyPrefix?: string;
}

export interface WorkingBubbleState {
  isPlanning: boolean;
  planName?: string;
  providerLabel?: string;
  modelLabel?: string;
}

export interface ReasoningWidgetState {
  text: string;
  providerLabel: string | null;
  modelLabel: string | null;
  tokens: ParsedTurnTokens | null;
  createdAtLabel: string;
  ariaLabel: string;
}

export type SelfReflectionPurpose = "planning" | "qa" | "unknown";

export interface SelfReflectionCriterionState {
  id: string;
  label: string;
  score: number | null;
  scoreLabel: string;
  starRating: number | null;
  starLabel: string;
  threshold: number | null;
  thresholdLabel: string;
  passed: boolean | null;
  stateLabel: string;
  rationale: string | null;
  improvementInstructions: string | null;
}

export interface SelfReflectionWidgetState {
  event: string | null;
  purpose: SelfReflectionPurpose;
  purposeLabel: string;
  attempt: number | null;
  attemptLabel: string | null;
  criteria: SelfReflectionCriterionState[];
  passed: boolean | null;
  stateLabel: string;
  finalDecision: string | null;
  finalDecisionLabel: string | null;
  errorMessage: string | null;
  ariaLabel: string;
}

export type RichWidgetDescriptor =
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      toolName: string | null;
      status: string | null;
      args: string;
      output: string;
      tokens: ParsedTurnTokens | null;
      callId: string | null;
    }
  | { kind: "planning"; status: ExecutionStatus; planName: string; targetWorker?: string }
  | { kind: "none" };

const BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN =
  /^fatal:\s+your current branch 'code-ux-bootstrap-[^']+' does not have any commits yet\s*$/i;
const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat("en-US");
const ACTIVE_SPRINT_RUN_STATUSES = new Set(["queued", "running", "dispatching", "paused", "pausing", "resuming", "cancelling"]);
const TERMINAL_SPRINT_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "canceled"]);

export const sanitizeInvocationOutputText = (value: string): string => {
  if (!value) {
    return value;
  }
  return value
    .split("\n")
    .filter((line) => !BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN.test(line.trim()))
    .join("\n");
};

const readString = (value: unknown): string | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

const readRawString = (value: unknown): string => (
  typeof value === "string" ? value : ""
);

const readNumber = (value: unknown): number | null => (
  typeof value === "number" && Number.isFinite(value) ? value : null
);

const readBoolean = (value: unknown): boolean | null => (
  typeof value === "boolean" ? value : null
);

const readRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const readArray = (value: unknown): unknown[] => (
  Array.isArray(value) ? value : []
);

const readStringList = (value: unknown, limit = 8): string[] => {
  const seen = new Set<string>();
  const values = readArray(value)
    .map(readString)
    .filter((entry): entry is string => Boolean(entry));
  const result: string[] = [];
  for (const entry of values) {
    const key = entry.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
    if (result.length >= limit) {
      break;
    }
  }
  return result;
};

const readStringArray = (value: unknown): string[] => (
  readArray(value)
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry))
);

const readFirstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const stringValue = readString(value);
    if (stringValue) {
      return stringValue;
    }
  }
  return null;
};

const readFirstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const numberValue = readNumber(value);
    if (numberValue !== null) {
      return numberValue;
    }
    const stringValue = readString(value);
    if (stringValue && /^\d+$/.test(stringValue)) {
      return Number.parseInt(stringValue, 10);
    }
  }
  return null;
};

const readNestedRecord = (base: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown> | null => {
  let current: unknown = base;
  for (const key of keys) {
    const record = readRecord(current);
    if (!record) {
      return null;
    }
    current = record[key];
  }
  return readRecord(current);
};

const readNestedValue = (base: Record<string, unknown> | null | undefined, keys: string[]): unknown => {
  let current: unknown = base;
  for (const key of keys) {
    const record = readRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[key];
  }
  return current;
};

const getWidgetMetadata = (metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  const value = metadata?.widget_metadata;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
};

const readMetadataString = (
  metadata: Record<string, unknown> | null | undefined,
  widgetMetadata: Record<string, unknown> | null,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const widgetValue = readString(widgetMetadata?.[key]);
    if (widgetValue) {
      return widgetValue;
    }
    const metadataValue = readString(metadata?.[key]);
    if (metadataValue) {
      return metadataValue;
    }
  }
  return null;
};

const readMetadataNumber = (
  metadata: Record<string, unknown> | null | undefined,
  widgetMetadata: Record<string, unknown> | null,
  keys: string[],
): number | null => {
  for (const key of keys) {
    const widgetValue = readNumber(widgetMetadata?.[key]);
    if (widgetValue !== null) {
      return widgetValue;
    }
    const metadataValue = readNumber(metadata?.[key]);
    if (metadataValue !== null) {
      return metadataValue;
    }
  }
  return null;
};

const compareRunRecency = (left: ExecutionSprintRunSummary, right: ExecutionSprintRunSummary): number => {
  const leftRecency = left.startedAt || left.createdAt || "";
  const rightRecency = right.startedAt || right.createdAt || "";
  return leftRecency.localeCompare(rightRecency);
};

const isActiveSprintRun = (run: ExecutionSprintRunSummary): boolean => (
  ACTIVE_SPRINT_RUN_STATUSES.has(run.status.toLowerCase())
);

const findSprintRun = (
  metadata: Record<string, unknown> | null | undefined,
  widgetMetadata: Record<string, unknown> | null,
  execution: ExecutionDashboardSnapshot,
  tasks: Task[],
): ExecutionSprintRunSummary | null => {
  const sprintRunId = readMetadataString(metadata, widgetMetadata, ["sprintRunId", "sprint_run_id", "runId", "run_id"]);
  if (sprintRunId) {
    return execution.sprintRuns.find((run) => run.id === sprintRunId) ?? null;
  }

  const sprintId = readMetadataString(metadata, widgetMetadata, ["sprintId", "sprint_id"]);
  if (sprintId) {
    return [...execution.sprintRuns]
      .filter((run) => run.sprintId === sprintId)
      .sort(compareRunRecency)
      .at(-1) ?? null;
  }

  const taskSprintIds = new Set(tasks.map((task) => task.sprintId).filter(Boolean));
  const activeRuns = [...execution.sprintRuns]
    .filter((run) => isActiveSprintRun(run) && (taskSprintIds.size === 0 || taskSprintIds.has(run.sprintId)))
    .sort(compareRunRecency);
  if (activeRuns.length > 0) {
    return activeRuns.at(-1) ?? null;
  }

  return null;
};

const resolveSprintId = (
  metadata: Record<string, unknown> | null | undefined,
  widgetMetadata: Record<string, unknown> | null,
  execution: ExecutionDashboardSnapshot,
  tasks: Task[],
): string | null => {
  const metadataSprintId = readMetadataString(metadata, widgetMetadata, ["sprintId", "sprint_id"]);
  if (metadataSprintId) {
    return metadataSprintId;
  }
  return findSprintRun(metadata, widgetMetadata, execution, tasks)?.sprintId ?? null;
};

const mapSprintRunStatusToExecutionStatus = (
  runStatus: string | null,
  fallbackStatus: ExecutionStatus,
): ExecutionStatus => {
  const normalized = runStatus?.toLowerCase() ?? "";
  if (normalized === "completed") {
    return "completed";
  }
  if (normalized === "failed" || normalized === "cancelled" || normalized === "canceled") {
    return "failed";
  }
  if (normalized === "queued") {
    return "queued";
  }
  if (normalized && !TERMINAL_SPRINT_RUN_STATUSES.has(normalized)) {
    return "running";
  }
  return fallbackStatus;
};

const formatStatusLabel = (value: string | null | undefined): string => {
  const normalized = readString(value);
  if (!normalized) {
    return "Unknown";
  }
  return normalized
    .replace(/^PENDING_cap_.+$/i, "PENDING")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatLocalizedStatusLabel = (value: string | null | undefined, locale: DashboardLocale): string => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  const keys = {
    pending: "pending",
    queued: "queued",
    running: "running",
    in_progress: "inProgress",
    completed: "completed",
    failed: "failed",
    blocked: "blocked",
    cancelled: "cancelled",
    canceled: "cancelled",
    paused: "paused",
    idle: "idle",
  } as const;
  if (!normalized) {
    return translateChatMessage(locale, "unknown");
  }
  return normalized in keys
    ? translateChatMessage(locale, keys[normalized as keyof typeof keys])
    : formatStatusLabel(value);
};

const normalizeWidgetExecutionStatus = (value: unknown, fallback: ExecutionStatus): ExecutionStatus => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  switch (normalized) {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "active":
    case "in_progress":
    case "working":
      return "running";
    case "completed":
    case "complete":
    case "done":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "error":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return fallback;
  }
};

const normalizeAppCreationKind = (value: unknown): AppCreationKind => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  const catalogKind = CREATE_APP_QUICKACTION_CATALOG.find(({ kind }) => kind === normalized)?.kind;
  if (catalogKind) {
    return catalogKind;
  }
  if (normalized === "web") {
    return "web_app";
  }
  if (normalized === "desktop") {
    return "desktop_app";
  }
  if (normalized === "shop" || normalized === "online_store") {
    return "online_shop";
  }
  return "unknown";
};

const formatAppCreationKindLabel = (kind: AppCreationKind, locale: DashboardLocale): string => {
  if (kind === "unknown") return translateChatMessage(locale, "app");
  if (locale === "en") return getCreateAppQuickactionSpec(kind).appKindLabel;
  const keys = { web_app: "webApp", desktop_app: "desktopApp", online_shop: "onlineShop", portfolio: "portfolio", game: "game" } as const;
  return translateChatMessage(locale, keys[kind]);
};

const formatAppCreationStatusLabel = (status: ExecutionStatus, appKindLabel: string, locale: DashboardLocale): string => {
  switch (status) {
    case "queued":
      return translateChatMessage(locale, "appSprintQueued", { appKind: appKindLabel });
    case "completed":
      return translateChatMessage(locale, "appSprintReady", { appKind: appKindLabel });
    case "failed":
      return translateChatMessage(locale, "appSprintAttention", { appKind: appKindLabel });
    case "running":
    default:
      return translateChatMessage(locale, "appSprintPlanning", { appKind: appKindLabel });
  }
};

const normalizeAppCreationStageStatus = (
  value: unknown,
  fallback: AppCreationProgressStageStatus,
): AppCreationProgressStageStatus => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  switch (normalized) {
    case "queued":
    case "pending":
    case "todo":
    case "waiting":
      return "pending";
    case "running":
    case "active":
    case "in_progress":
    case "working":
      return "running";
    case "completed":
    case "complete":
    case "done":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "error":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return fallback;
  }
};

const canonicalAppCreationStageId = (value: string): string => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "planning" || normalized === "prepare" || normalized === "preparing") {
    return "planning";
  }
  if (normalized === "plan" || normalized === "planning_result" || normalized === "draft_plan") {
    return "plan";
  }
  if (
    normalized === "showing_tasks"
    || normalized === "showing_each_task"
    || normalized === "show_tasks"
    || normalized === "tasks"
    || normalized === "task_list"
  ) {
    return "showing_tasks";
  }
  if (normalized === "start" || normalized === "starting" || normalized === "start_sprint") {
    return "start";
  }
  if (normalized === "finish" || normalized === "finished" || normalized === "complete") {
    return "finish";
  }
  return normalized || "stage";
};

const APP_CREATION_STAGE_LABEL_KEYS = {
  planning: "purposePlanning",
  plan: "plan",
  showing_tasks: "showingEachTask",
  start: "start",
  finish: "finish",
} as const;

type CanonicalAppCreationStageId = keyof typeof APP_CREATION_STAGE_LABEL_KEYS;

const DEFAULT_APP_CREATION_STAGE_DEFS = Object.entries(APP_CREATION_STAGE_LABEL_KEYS).map(([id, labelKey]) => ({
  id: id as CanonicalAppCreationStageId,
  labelKey,
}));

const formatAppCreationStageLabel = (
  id: string,
  rawId: string,
  explicitLabel: string | null,
  locale: DashboardLocale,
): string => {
  if (explicitLabel) {
    return explicitLabel;
  }
  if (Object.prototype.hasOwnProperty.call(APP_CREATION_STAGE_LABEL_KEYS, id)) {
    return translateChatMessage(locale, APP_CREATION_STAGE_LABEL_KEYS[id as CanonicalAppCreationStageId]);
  }
  return rawId;
};

const defaultAppCreationStageStatus = (
  stageId: string,
  widgetStatus: ExecutionStatus,
): AppCreationProgressStageStatus => {
  if (widgetStatus === "completed") {
    return "completed";
  }
  if (widgetStatus === "failed") {
    return stageId === "planning" ? "failed" : "pending";
  }
  if (widgetStatus === "queued") {
    return "pending";
  }
  return stageId === "planning" ? "running" : "pending";
};

const buildAppCreationStageState = (
  id: string,
  label: string,
  status: AppCreationProgressStageStatus,
  locale: DashboardLocale,
): AppCreationProgressStageState => ({
  id,
  label,
  status,
  statusLabel: formatLocalizedStatusLabel(status, locale),
  isActive: status === "running",
  isCompleted: status === "completed",
  isFailed: status === "failed",
});

const normalizeAppCreationStages = (
  widgetMetadata: Record<string, unknown>,
  widgetStatus: ExecutionStatus,
  locale: DashboardLocale,
): AppCreationProgressStageState[] => {
  const suppliedStages = readArray(widgetMetadata.planningStages ?? widgetMetadata.stages ?? widgetMetadata.stageList)
    .map(readRecord)
    .filter((stage): stage is Record<string, unknown> => Boolean(stage))
    .map((stage) => {
      const explicitLabel = readString(stage.label);
      const rawId = readString(stage.id) || readString(stage.key) || explicitLabel || "stage";
      const id = canonicalAppCreationStageId(rawId);
      const label = formatAppCreationStageLabel(id, rawId, explicitLabel, locale);
      const status = normalizeAppCreationStageStatus(stage.status ?? stage.state, defaultAppCreationStageStatus(id, widgetStatus));
      return buildAppCreationStageState(id, label, status, locale);
    });

  const suppliedById = new Map(suppliedStages.map((stage) => [stage.id, stage]));
  const defaultStages = DEFAULT_APP_CREATION_STAGE_DEFS.map((stage) => (
    suppliedById.get(stage.id)
    ?? buildAppCreationStageState(stage.id, translateChatMessage(locale, stage.labelKey), defaultAppCreationStageStatus(stage.id, widgetStatus), locale)
  ));
  const defaultIds = new Set(defaultStages.map((stage) => stage.id));
  const customStages = suppliedStages.filter((stage) => !defaultIds.has(stage.id));
  const finishIndex = defaultStages.findIndex((stage) => stage.id === "finish");

  if (customStages.length === 0 || finishIndex < 0) {
    return defaultStages;
  }

  return [
    ...defaultStages.slice(0, finishIndex),
    ...customStages,
    ...defaultStages.slice(finishIndex),
  ];
};

const readStackFieldValue = (stackSummary: Record<string, unknown> | null, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = readString(stackSummary?.[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatExecutionPlanName = (executionPlan: PlanningExecutionPlanWidgetState): string => {
  if (!executionPlan.sprintKey) {
    return executionPlan.sprintName;
  }
  const prefixPattern = new RegExp(`^${escapeRegExp(executionPlan.sprintKey)}\\s*[:\\-]?\\s*`, "i");
  const normalizedName = executionPlan.sprintName.replace(prefixPattern, "").trim();
  if (!normalizedName || normalizedName === executionPlan.sprintKey) {
    return executionPlan.sprintKey;
  }
  return `${executionPlan.sprintKey}: ${normalizedName}`;
};

const readExecutionPlanTaskSummaries = (
  executionPlan: Record<string, unknown>,
  createdTaskIds: string[],
): PlanningExecutionPlanTaskSummaryState[] => {
  const candidates = [
    executionPlan.taskSummaries,
    executionPlan.task_summaries,
    executionPlan.tasks,
    executionPlan.createdTasks,
    executionPlan.created_tasks,
  ] as const;
  const rawTasks = candidates.find((candidate) => readArray(candidate).length > 0);
  return readArray(rawTasks)
    .map((entry, index): PlanningExecutionPlanTaskSummaryState | null => {
      const record = readRecord(entry);
      if (!record) {
        const title = readString(entry);
        return title ? { id: createdTaskIds[index] ?? `task-${index + 1}`, title, summary: null } : null;
      }

      const id = readFirstString(
        record.id,
        record.taskId,
        record.task_id,
        record.key,
        record.taskKey,
        record.task_key,
        createdTaskIds[index],
      ) ?? `task-${index + 1}`;
      const title = readFirstString(record.title, record.name, record.summary, record.description, id);
      if (!title) {
        return null;
      }

      const summary = readFirstString(
        record.summary,
        record.description,
        record.promptSummary,
        record.prompt_summary,
      );
      return {
        id,
        title,
        summary: summary && summary !== title ? summary : null,
      };
    })
    .filter((entry): entry is PlanningExecutionPlanTaskSummaryState => Boolean(entry));
};

const formatExecutionPlanTaskSummaryLabel = (
  taskCount: number,
  createdTaskIds: string[],
  tasks: PlanningExecutionPlanTaskSummaryState[],
  locale: DashboardLocale,
): string => {
  const effectiveTaskCount = taskCount || tasks.length || createdTaskIds.length;
  const number = new Intl.NumberFormat(locale).format(effectiveTaskCount);
  const plannedLabel = translateChatPlural(locale, "plannedTasks", effectiveTaskCount, { count: number });
  if (createdTaskIds.length > 0 && createdTaskIds.length !== effectiveTaskCount) {
    return `${plannedLabel}, ${translateChatMessage(locale, "createdCount", { count: new Intl.NumberFormat(locale).format(createdTaskIds.length) })}`;
  }
  return plannedLabel;
};

const readExecutionPlanState = (
  metadata: Record<string, unknown> | null | undefined,
  widgetMetadata: Record<string, unknown> | null,
  locale: DashboardLocale,
): PlanningExecutionPlanWidgetState | null => {
  const executionPlan = readRecord(metadata?.executionPlan)
    ?? readRecord(metadata?.execution_plan)
    ?? readRecord(widgetMetadata?.executionPlan)
    ?? readRecord(widgetMetadata?.execution_plan);
  if (!executionPlan) {
    return null;
  }

  const sprintId = readFirstString(executionPlan.sprintId, executionPlan.sprint_id);
  const sprintNumber = readFirstNumber(executionPlan.sprintNumber, executionPlan.sprint_number);
  const sprintKey = readFirstString(executionPlan.sprintKey, executionPlan.sprint_key)
    ?? (sprintNumber !== null ? `SPR-${sprintNumber}` : sprintId);
  const goal = readFirstString(executionPlan.goal);
  const createdTaskIds = [
    ...new Set([
      ...readStringArray(executionPlan.createdTaskIds),
      ...readStringArray(executionPlan.created_task_ids),
    ]),
  ];
  const tasks = readExecutionPlanTaskSummaries(executionPlan, createdTaskIds);
  const rawTaskCount = readFirstNumber(executionPlan.taskCount, executionPlan.task_count);
  const taskCount = rawTaskCount !== null && rawTaskCount >= 0
    ? Math.trunc(rawTaskCount)
    : tasks.length || createdTaskIds.length;
  const sprintName = readFirstString(executionPlan.sprintName, executionPlan.sprint_name)
    ?? sprintKey
    ?? translateChatMessage(locale, "executionPlan");

  const hasPlanDetails = Boolean(
    sprintId
    || sprintNumber !== null
    || sprintKey
    || goal
    || taskCount > 0
    || createdTaskIds.length > 0
    || tasks.length > 0
    || readString(executionPlan.sprintName)
    || readString(executionPlan.sprint_name),
  );
  if (!hasPlanDetails) {
    return null;
  }

  const taskSummaryLabel = formatExecutionPlanTaskSummaryLabel(taskCount, createdTaskIds, tasks, locale);
  const ariaParts = [translateChatMessage(locale, "planningExecutionPlan"), formatExecutionPlanName({
    sprintId,
    sprintNumber,
    sprintKey,
    sprintName,
    goal,
    taskCount,
    createdTaskIds,
    tasks,
    taskSummaryLabel,
    ariaLabel: "",
  })];
  if (goal) {
    ariaParts.push(translateChatMessage(locale, "goalLabel", { goal }));
  }
  ariaParts.push(taskSummaryLabel);

  return {
    sprintId,
    sprintNumber,
    sprintKey,
    sprintName,
    goal,
    taskCount,
    createdTaskIds,
    tasks,
    taskSummaryLabel,
    ariaLabel: ariaParts.join(". "),
  };
};

const normalizeExternalProviderValue = (value: unknown): ExternalReferenceProvider | null => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (normalized.includes("jira") || normalized.includes("atlassian")) {
    return "jira";
  }
  if (normalized.includes("github")) {
    return "github";
  }
  if (normalized.includes("gitlab")) {
    return "gitlab";
  }
  return null;
};

const isHostnameOrSubdomain = (host: string, domain: string): boolean => (
  host === domain || host.endsWith(`.${domain}`)
);

const inferExternalProviderFromUrl = (value: unknown): ExternalReferenceProvider | null => {
  const url = readString(value);
  if (!url) {
    return null;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (isHostnameOrSubdomain(host, "atlassian.net")) {
      return "jira";
    }
    if (host === "github.com" || host.endsWith(".github.com")) {
      return "github";
    }
    if (host === "gitlab.com" || host.endsWith(".gitlab.com") || host.includes("gitlab.")) {
      return "gitlab";
    }
  } catch {
    return null;
  }
  return null;
};

const formatExternalProviderLabel = (provider: ExternalReferenceProvider): string => {
  switch (provider) {
    case "jira":
      return "Jira";
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
  }
};

const normalizeExternalReferenceKind = (
  value: unknown,
  provider: ExternalReferenceProvider,
  source: Record<string, unknown>,
): ExternalReferenceKind => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (
    normalized === "pull_request"
    || normalized === "pullrequest"
    || normalized === "pr"
    || normalized === "github_pr"
    || normalized === "github_pull_request"
    || readRecord(source.pull_request)
    || readRecord(source.pullRequest)
  ) {
    return "pull_request";
  }
  if (
    normalized === "merge_request"
    || normalized === "mergerequest"
    || normalized === "mr"
    || normalized === "gitlab_mr"
    || normalized === "gitlab_merge_request"
    || readRecord(source.merge_request)
    || readRecord(source.mergeRequest)
  ) {
    return "merge_request";
  }
  if (provider === "gitlab" && normalized.includes("merge")) {
    return "merge_request";
  }
  return "issue";
};

const formatExternalKindLabel = (kind: ExternalReferenceKind, locale: DashboardLocale): string => {
  switch (kind) {
    case "pull_request":
      return translateChatMessage(locale, "pullRequest");
    case "merge_request":
      return translateChatMessage(locale, "mergeRequest");
    case "issue":
      return translateChatMessage(locale, "issue");
  }
};

const normalizeExternalStatus = (value: string | null): ExecutionStatus => {
  const normalized = value?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (["closed", "done", "resolved", "merged", "complete", "completed"].includes(normalized)) {
    return "completed";
  }
  if (["blocked", "failed", "declined"].includes(normalized)) {
    return "failed";
  }
  if (["inprogress", "review", "reviewing", "reopened"].includes(normalized)) {
    return "running";
  }
  return "queued";
};

const readDisplayName = (value: unknown): string | null => {
  const stringValue = readString(value);
  if (stringValue) {
    return stringValue;
  }
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return readFirstString(record.displayName, record.display_name, record.name, record.login, record.username, record.emailAddress);
};

const readFirstDisplayName = (...values: unknown[]): string | null => {
  for (const value of values) {
    const array = readArray(value);
    if (array.length > 0) {
      const displayName = readDisplayName(array[0]);
      if (displayName) {
        return displayName;
      }
    }
    const displayName = readDisplayName(value);
    if (displayName) {
      return displayName;
    }
  }
  return null;
};

const normalizeAppCreationStackSummary = (value: unknown, locale: DashboardLocale): AppCreationStackSummaryState => {
  const stackSummary = readRecord(value);
  const fieldDefs = [
    { key: "techstackName", labelKey: "stack", keys: ["techstackName", "techstack_name", "stackName", "stack_name"] },
    { key: "framework", labelKey: "framework", keys: ["framework"] },
    { key: "language", labelKey: "language", keys: ["language"] },
    { key: "runtime", labelKey: "runtime", keys: ["runtime"] },
    { key: "packageManager", labelKey: "package", keys: ["packageManager", "package_manager"] },
    { key: "styling", labelKey: "styling", keys: ["styling"] },
    { key: "testFramework", labelKey: "tests", keys: ["testFramework", "test_framework"] },
    { key: "techstackId", labelKey: "stackId", keys: ["techstackId", "techstack_id"] },
  ] as const;

  const fields = fieldDefs.flatMap((field): AppCreationStackSummaryFieldState[] => {
    const fieldValue = readStackFieldValue(stackSummary, field.keys);
    return fieldValue ? [{ key: field.key, label: translateChatMessage(locale, field.labelKey), value: fieldValue }] : [];
  });

  return {
    fields,
    emptyLabel: translateChatMessage(locale, "projectStackDefaults"),
  };
};

const buildAppCreationProgressWidgetState = (
  metadata: Record<string, unknown> | null | undefined,
  widgetMetadata: Record<string, unknown>,
  locale: DashboardLocale,
): ChatWidgetState => {
  const status = normalizeWidgetExecutionStatus(widgetMetadata.status ?? metadata?.status, "running");
  const appKind = normalizeAppCreationKind(widgetMetadata.appKind ?? widgetMetadata.app_kind ?? widgetMetadata.kind ?? metadata?.appKind);
  const appKindLabel = formatAppCreationKindLabel(appKind, locale);
  const sprintLabel = readMetadataString(metadata, widgetMetadata, ["sprintName", "sprint_name", "sprintLabel", "sprint_label", "title"])
    || translateChatMessage(locale, "appCreationSprint");
  const progress: AppCreationProgressWidgetState = {
    status,
    statusLabel: formatAppCreationStatusLabel(status, appKindLabel, locale),
    appKind,
    appKindLabel,
    sprintId: readMetadataString(metadata, widgetMetadata, ["sprintId", "sprint_id"]),
    sprintLabel,
    stackSummary: normalizeAppCreationStackSummary(widgetMetadata.stackSummary ?? widgetMetadata.stack_summary ?? metadata?.stackSummary, locale),
    stages: normalizeAppCreationStages(widgetMetadata, status, locale),
    suggestionTags: readStringList(widgetMetadata.suggestionTags ?? widgetMetadata.suggestion_tags ?? metadata?.suggestionTags, 6),
    quickactionRequestId: readMetadataString(metadata, widgetMetadata, ["quickactionRequestId", "quickaction_request_id", "requestId", "request_id"]),
    clientRequestId: readMetadataString(metadata, widgetMetadata, ["clientRequestId", "client_request_id"]),
  };

  return {
    type: "app_creation_progress",
    status,
    planName: sprintLabel,
    appCreationProgress: progress,
  };
};

const readLabels = (...values: unknown[]): string[] => {
  const labels: string[] = [];
  const addLabel = (value: unknown): void => {
    const direct = readString(value);
    if (direct) {
      direct.split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => labels.push(part));
      return;
    }
    const record = readRecord(value);
    const label = readFirstString(record?.name, record?.title, record?.label);
    if (label) {
      labels.push(label);
    }
  };

  values.forEach((value) => {
    const array = readArray(value);
    if (array.length > 0) {
      array.forEach(addLabel);
    } else {
      addLabel(value);
    }
  });

  return [...new Set(labels)].slice(0, 8);
};

const normalizeExternalPreview = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const flattened = value.replace(/\s+/g, " ").trim();
  if (flattened.length <= 280) {
    return flattened;
  }
  return `${flattened.slice(0, 277).trimEnd()}...`;
};

const parseJsonLookingRecord = (bodyMarkdown: string | undefined): Record<string, unknown> | null => {
  const trimmed = readString(bodyMarkdown);
  if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    return readRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
};

const collectExternalReferenceCandidates = (
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] => {
  if (!metadata) {
    return [];
  }

  const widgetMetadata = getWidgetMetadata(metadata);
  const candidates: Record<string, unknown>[] = [];
  if (widgetMetadata) {
    candidates.push(widgetMetadata);
    const widgetExternalReference = readRecord(widgetMetadata.externalReference);
    if (widgetExternalReference) {
      candidates.push(widgetExternalReference);
    }
    const widgetLinkedIssue = readRecord(widgetMetadata.linkedIssue) ?? readRecord(widgetMetadata.linked_issue);
    if (widgetLinkedIssue) {
      candidates.push(widgetLinkedIssue);
    }
  }

  const externalReference = readRecord(metadata.externalReference);
  if (externalReference) {
    candidates.push(externalReference);
  }
  const linkedIssue = readRecord(metadata.linkedIssue) ?? readRecord(metadata.linked_issue);
  if (linkedIssue) {
    candidates.push(linkedIssue);
  }
  candidates.push(metadata);

  return candidates;
};

const buildExternalReferenceState = (
  source: Record<string, unknown>,
  locale: DashboardLocale = "en",
): { status: ExecutionStatus; reference: ExternalReferenceWidgetState } | null => {
  const fields = readRecord(source.fields);
  const url = readFirstString(
    source.webUrl,
    source.web_url,
    source.htmlUrl,
    source.html_url,
    source.issueUrl,
    source.issue_url,
    source.pullRequestUrl,
    source.pull_request_url,
    source.mergeRequestUrl,
    source.merge_request_url,
    source.browseUrl,
    source.browse_url,
    source.url,
    source.self,
  );
  const provider = normalizeExternalProviderValue(source.provider)
    ?? normalizeExternalProviderValue(source.source)
    ?? normalizeExternalProviderValue(source.system)
    ?? normalizeExternalProviderValue(source.kind)
    ?? inferExternalProviderFromUrl(url);
  if (!provider) {
    return null;
  }

  const kind = normalizeExternalReferenceKind(source.kind ?? source.type ?? source.referenceType ?? source.reference_type, provider, source);
  const title = readFirstString(source.title, source.summary, fields?.summary, source.name);
  const key = readFirstString(source.key, source.issueKey, source.issue_key, source.ticketKey, source.ticket_key);
  const number = readFirstNumber(source.number, source.issueNumber, source.issue_number, source.pullRequestNumber, source.pull_request_number, source.mergeRequestNumber, source.merge_request_number, source.iid);
  const identifierLabel = key ?? (number !== null ? `#${number}` : null);
  if (!title || (!identifierLabel && !url)) {
    return null;
  }

  const state = readFirstString(source.state, source.status, readNestedValue(fields, ["status", "name"]));
  const stateLabel = state ? formatStatusLabel(state) : null;
  const path = readFirstString(
    source.repositoryPath,
    source.repository_path,
    source.repo,
    source.repoFullName,
    source.repo_full_name,
    source.projectPath,
    source.project_path,
    source.namespacePath,
    source.namespace_path,
    readNestedValue(readNestedRecord(source, ["repository"]), ["full_name"]),
    readNestedValue(readNestedRecord(source, ["repository"]), ["nameWithOwner"]),
    readNestedValue(readNestedRecord(source, ["repository"]), ["path_with_namespace"]),
    readNestedValue(readNestedRecord(source, ["project"]), ["path_with_namespace"]),
  );
  const labels = readLabels(source.labels, fields?.labels);
  const assignee = readFirstDisplayName(source.assignee, source.assignees, fields?.assignee);
  const author = readFirstDisplayName(source.author, source.user, source.createdBy, source.created_by);
  const preview = normalizeExternalPreview(readFirstString(
    source.bodyPreview,
    source.body_preview,
    source.preview,
    source.body,
    source.description,
    fields?.description,
    source.summary,
  ));
  const providerLabel = formatExternalProviderLabel(provider);
  const kindLabel = formatExternalKindLabel(kind, locale);
  const pathParts = provider === "github"
    ? { repositoryPath: path, projectPath: null }
    : { repositoryPath: null, projectPath: path };
  const ariaParts = [providerLabel, kindLabel, title];
  if (identifierLabel) {
    ariaParts.push(identifierLabel);
  }
  if (stateLabel) {
    ariaParts.push(stateLabel);
  }

  return {
    status: normalizeExternalStatus(state),
    reference: {
      provider,
      providerLabel,
      kind,
      kindLabel,
      title,
      key,
      number,
      identifierLabel,
      state,
      stateLabel,
      url,
      ...pathParts,
      labels,
      assignee,
      author,
      preview,
      ariaLabel: ariaParts.join(". "),
    },
  };
};

const extractExternalReferenceWidgetState = (
  metadata: Record<string, unknown> | null | undefined,
  bodyMarkdown?: string,
  locale: DashboardLocale = "en",
): { status: ExecutionStatus; reference: ExternalReferenceWidgetState; fromJsonBody: boolean } | null => {
  for (const candidate of collectExternalReferenceCandidates(metadata)) {
    const result = buildExternalReferenceState(candidate, locale);
    if (result) {
      return { ...result, fromJsonBody: false };
    }
  }

  const bodyRecord = parseJsonLookingRecord(bodyMarkdown);
  if (!bodyRecord) {
    return null;
  }
  for (const candidate of collectExternalReferenceCandidates(bodyRecord)) {
    const result = buildExternalReferenceState(candidate, locale);
    if (result) {
      return { ...result, fromJsonBody: true };
    }
  }
  return null;
};

const hasExternalReferenceJsonBody = (bodyMarkdown?: string): boolean => {
  const bodyRecord = parseJsonLookingRecord(bodyMarkdown);
  if (!bodyRecord) {
    return false;
  }
  return collectExternalReferenceCandidates(bodyRecord).some((candidate) => Boolean(buildExternalReferenceState(candidate)));
};

const normalizeReflectionPurpose = (value: unknown): SelfReflectionPurpose => {
  const normalized = readString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (normalized === "planning" || normalized === "plan") {
    return "planning";
  }
  if (
    normalized === "qa"
    || normalized === "quality_assurance"
    || normalized === "qualityassurance"
    || normalized === "qa_review"
    || normalized === "review"
  ) {
    return "qa";
  }
  return "unknown";
};

const formatReflectionPurposeLabel = (purpose: SelfReflectionPurpose, locale: DashboardLocale): string => {
  switch (purpose) {
    case "planning":
      return translateChatMessage(locale, "planningReflection");
    case "qa":
      return translateChatMessage(locale, "qaReflection");
    case "unknown":
    default:
      return translateChatMessage(locale, "selfReflection");
  }
};

const formatReflectionDecisionLabel = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  return formatStatusLabel(value)
    .replace(/\bQa\b/g, "QA")
    .replace(/\bJson\b/g, "JSON");
};

const normalizeReflectionThreshold = (value: unknown): number | null => {
  const numeric = readNumber(value);
  if (numeric === null) {
    return null;
  }
  if (numeric <= 1) {
    return Math.max(0, Math.min(10, numeric * 10));
  }
  return Math.max(0, Math.min(10, numeric));
};

const normalizeReflectionScore = (value: unknown): number | null => {
  const numeric = readNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.max(0, Math.min(10, numeric));
};

const formatScoreLabel = (score: number | null, locale: DashboardLocale): string => (
  score === null
    ? translateChatMessage(locale, "noScore")
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(score)}/10`
);

const formatThresholdLabel = (threshold: number | null, locale: DashboardLocale): string => (
  threshold === null
    ? translateChatMessage(locale, "thresholdNotSet")
    : translateChatMessage(locale, "threshold", { score: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(threshold) })
);

const buildReflectionCriterionKey = (entry: Record<string, unknown>, index: number): string => (
  readString(entry.id) || readString(entry.key) || readString(entry.label) || `criterion-${index + 1}`
);

const buildReflectionCriterionState = (
  base: Record<string, unknown>,
  scoreEntry: Record<string, unknown> | null,
  index: number,
  locale: DashboardLocale,
): SelfReflectionCriterionState => {
  const id = buildReflectionCriterionKey(scoreEntry ?? base, index);
  const label = readString(scoreEntry?.label) || readString(base.label) || readString(base.name) || formatStatusLabel(id);
  const score = normalizeReflectionScore(scoreEntry?.score ?? base.score ?? scoreEntry?.rating ?? base.rating);
  const threshold = normalizeReflectionThreshold(scoreEntry?.threshold ?? base.threshold);
  const explicitPassed = readBoolean(scoreEntry?.passed ?? base.passed);
  const passed = explicitPassed ?? (score !== null && threshold !== null ? score >= threshold : null);
  const starRating = score === null ? null : Math.max(0, Math.min(5, Math.round(score / 2)));
  const scoreLabel = formatScoreLabel(score, locale);

  return {
    id,
    label,
    score,
    scoreLabel,
    starRating,
    starLabel: starRating === null
      ? translateChatMessage(locale, "ratingUnavailable", { label })
      : translateChatMessage(locale, "ratingStars", { rating: starRating, label, score: scoreLabel }),
    threshold,
    thresholdLabel: formatThresholdLabel(threshold, locale),
    passed,
    stateLabel: translateChatMessage(locale, passed === null ? "notEvaluated" : passed ? "passed" : "needsImprovement"),
    rationale: readString(scoreEntry?.rationale) || readString(base.rationale),
    improvementInstructions: readString(scoreEntry?.improvementInstructions)
      || readString(scoreEntry?.improvement_instructions)
      || readString(base.improvementInstructions)
      || readString(base.improvement_instructions),
  };
};

const mergeReflectionCriteria = (
  criteria: unknown[],
  scores: unknown[],
  locale: DashboardLocale,
): SelfReflectionCriterionState[] => {
  const baseEntries = criteria
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const scoreEntries = scores
    .map(readRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const effectiveScores = scoreEntries.length > 0
    ? scoreEntries
    : baseEntries.filter((entry) => readNumber(entry.score) !== null || readNumber(entry.rating) !== null);
  const baseById = new Map(baseEntries.map((entry, index) => [buildReflectionCriterionKey(entry, index), entry]));
  const seen = new Set<string>();
  const result: SelfReflectionCriterionState[] = [];

  effectiveScores.forEach((scoreEntry, index) => {
    const key = buildReflectionCriterionKey(scoreEntry, index);
    seen.add(key);
    result.push(buildReflectionCriterionState(baseById.get(key) ?? {}, scoreEntry, index, locale));
  });

  baseEntries.forEach((base, index) => {
    const key = buildReflectionCriterionKey(base, index);
    if (!seen.has(key)) {
      result.push(buildReflectionCriterionState(base, null, result.length, locale));
    }
  });

  return result;
};

const resolveTaskStatus = (
  phase: string | undefined,
  locale: DashboardLocale,
): Pick<LivePlanningTaskState, "statusKind" | "statusLabel" | "detailLabel"> => {
  if (!phase) {
    return { statusKind: "unknown", statusLabel: translateChatMessage(locale, "unknown"), detailLabel: null };
  }
  if (phase.startsWith("PENDING_cap_")) {
    const [, , currentCount, limit] = phase.split("_");
    const detailLabel = currentCount && limit
      ? translateChatMessage(locale, "providerCapCount", { current: new Intl.NumberFormat(locale).format(Number(currentCount)), limit: new Intl.NumberFormat(locale).format(Number(limit)) })
      : translateChatMessage(locale, "providerCap");
    return { statusKind: "queued", statusLabel: translateChatMessage(locale, "queuedLabel"), detailLabel };
  }

  switch (phase) {
    case "PENDING":
      return { statusKind: "queued", statusLabel: translateChatMessage(locale, "queuedLabel"), detailLabel: null };
    case "RUNNING":
      return { statusKind: "running", statusLabel: translateChatMessage(locale, "running"), detailLabel: null };
    case "CODING_COMPLETED":
      return { statusKind: "review", statusLabel: translateChatMessage(locale, "review"), detailLabel: translateChatMessage(locale, "codeComplete") };
    case "COMPLETED":
      return { statusKind: "completed", statusLabel: translateChatMessage(locale, "completed"), detailLabel: null };
    case "FAILED":
      return { statusKind: "failed", statusLabel: translateChatMessage(locale, "failed"), detailLabel: null };
    case "BLOCKED":
      return { statusKind: "blocked", statusLabel: translateChatMessage(locale, "blocked"), detailLabel: null };
    case "QUOTA":
      return { statusKind: "quota", statusLabel: translateChatMessage(locale, "quotaWait"), detailLabel: null };
    default:
      return { statusKind: "unknown", statusLabel: formatStatusLabel(phase), detailLabel: null };
  }
};

const buildLivePlanningWidgetState = (
  metadata: Record<string, unknown> | null | undefined,
  fallbackStatus: ExecutionStatus,
  fallbackPlanName: string,
  liveData?: ChatWidgetLiveData,
  locale: DashboardLocale = "en",
): LivePlanningWidgetState | null => {
  if (
    !liveData?.execution
    || !Array.isArray(liveData.projectTasks)
    || liveData.executionLoading
    || liveData.projectTasksLoading
    || liveData.executionLoaded !== true
    || liveData.projectTasksLoaded !== true
  ) {
    return null;
  }

  const widgetMetadata = getWidgetMetadata(metadata);
  const sprintId = resolveSprintId(metadata, widgetMetadata, liveData.execution, liveData.projectTasks);
  if (!sprintId) {
    return null;
  }

  const sprintRun = findSprintRun(metadata, widgetMetadata, liveData.execution, liveData.projectTasks);
  const sprintTasks = liveData.projectTasks.filter((task) => task.sprintId === sprintId);
  const sprintDispatches = liveData.execution.taskDispatches.filter((dispatch) => dispatch.sprintId === sprintId);
  const sprintEvents = liveData.execution.recentEvents.filter((event) => event.sprintId === sprintId);
  const liveTasks = buildLiveSessionTasks(sprintTasks, [], liveData.projectId, sprintDispatches, sprintEvents);
  const taskStates = liveTasks.map((task): LivePlanningTaskState => ({
    id: task.id,
    title: task.title,
    ...resolveTaskStatus(task.status, locale),
  }));
  const completedTasks = taskStates.filter((task) => task.statusKind === "completed").length;
  const queuedTasks = taskStates.filter((task) => task.statusKind === "queued").length;
  const totalTasks = taskStates.length;
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const sprintNumber = readMetadataNumber(metadata, widgetMetadata, ["sprintNumber", "sprint_number"]) ?? sprintRun?.sprintNumber ?? null;
  const sprintKey = readMetadataString(metadata, widgetMetadata, ["sprintKey", "sprint_key"]) ||
    (sprintNumber !== null ? `${liveData.sprintKeyPrefix || "SPR"}-${sprintNumber}` : sprintId);
  const sprintName = readMetadataString(metadata, widgetMetadata, ["sprintName", "sprint_name"]) ||
    sprintRun?.sprintName ||
    sprintTasks[0]?.sprint ||
    fallbackPlanName;
  const runStatus = sprintRun?.status ?? null;
  const requestLabel = formatLocalizedStatusLabel(fallbackStatus, locale);
  const runLabel = sprintRun ? formatLocalizedStatusLabel(sprintRun.status, locale) : translateChatMessage(locale, "awaitingRun");

  return {
    sprintId,
    sprintKey,
    sprintName,
    runStatus,
    totalTasks,
    completedTasks,
    queuedTasks,
    percentComplete,
    progressLabel: `${new Intl.NumberFormat(locale).format(completedTasks)}/${new Intl.NumberFormat(locale).format(totalTasks)} · ${new Intl.NumberFormat(locale).format(percentComplete)}%`,
    materialization: {
      requestLabel,
      taskRecordsLabel: totalTasks > 0
        ? translateChatPlural(locale, "materializedTasks", totalTasks, { count: new Intl.NumberFormat(locale).format(totalTasks) })
        : translateChatMessage(locale, "awaitingTaskRecords"),
      runLabel,
    },
    tasks: taskStates,
  };
};

const extractWidgetStateFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  bodyMarkdown?: string,
  liveData?: ChatWidgetLiveData,
  locale: DashboardLocale = "en",
): ChatWidgetState => {
  const widgetMetadata = getWidgetMetadata(metadata);
  const executionPlan = readExecutionPlanState(metadata, widgetMetadata, locale);

  if (widgetMetadata && readString(widgetMetadata.type) === "app_progress") {
    return buildAppCreationProgressWidgetState(metadata, widgetMetadata, locale);
  }

  if (widgetMetadata && widgetMetadata.type === "planning_request") {
    const status = (widgetMetadata.status as ExecutionStatus) || (metadata?.status as ExecutionStatus) || "completed";
    const planName = executionPlan
      ? formatExecutionPlanName(executionPlan)
      : (widgetMetadata.route_path as string) || (metadata?.planName as string) || (metadata?.title as string) || translateChatMessage(locale, "executionPlan");
    const targetWorker = widgetMetadata.target_worker as string | undefined;
    const liveStatus = executionPlan ? null : buildLivePlanningWidgetState(metadata, status, planName, liveData, locale);
    return {
      type: "planning",
      status: liveStatus ? mapSprintRunStatusToExecutionStatus(liveStatus.runStatus, status) : status,
      planName,
      targetWorker,
      ...(executionPlan ? { executionPlan } : {}),
      ...(liveStatus ? { liveStatus } : {}),
    };
  }

  const externalReference = extractExternalReferenceWidgetState(metadata, bodyMarkdown, locale);
  if (externalReference) {
    const hasJsonBody = externalReference.fromJsonBody || hasExternalReferenceJsonBody(bodyMarkdown);
    return {
      type: "external_reference",
      status: externalReference.status,
      planName: "",
      externalReference: externalReference.reference,
      ...(hasJsonBody ? { suppressBodyMarkdown: true } : {}),
    };
  }

  if (!metadata) {
    return { type: "none", status: "completed", planName: "" };
  }

  const isPlanning = metadata.type === "planning" || metadata.routeKind === "planning" ||
    (typeof bodyMarkdown === "string" && bodyMarkdown.toLowerCase().includes("planning"));

  if (isPlanning || metadata.routeKind === "virtual" || metadata.routeKind === "worker") {
    const status = (metadata.status as ExecutionStatus) || "completed";
    const planName = executionPlan
      ? formatExecutionPlanName(executionPlan)
      : (metadata.planName as string) || (metadata.title as string) || translateChatMessage(locale, "executionPlan");
    const liveStatus = executionPlan ? null : buildLivePlanningWidgetState(metadata, status, planName, liveData, locale);
    return {
      type: "planning",
      status: liveStatus ? mapSprintRunStatusToExecutionStatus(liveStatus.runStatus, status) : status,
      planName,
      ...(executionPlan ? { executionPlan } : {}),
      ...(liveStatus ? { liveStatus } : {}),
    };
  }

  return { type: "none", status: "completed", planName: "" };
};

const readParsedTurnTokens = (value: unknown): ParsedTurnTokens | null => {
  const record = readRecord(value);
  return record ? record as ParsedTurnTokens : null;
};

export const resolveRichWidget = (input: {
  metadata?: Record<string, unknown> | null;
  content?: string;
  toolCallsJson?: Record<string, unknown> | null;
  locale?: DashboardLocale;
}): RichWidgetDescriptor => {
  const metadata = input.metadata ?? null;
  const kind = readString(metadata?.kind);

  if (kind === "reasoning") {
    return {
      kind: "reasoning",
      text: input.content ?? "",
    };
  }

  if (kind === "tool_call" || kind === "tool_result") {
    const toolCallsJson = input.toolCallsJson ?? null;
    return {
      kind: "tool",
      toolName: readString(metadata?.toolName),
      status: readString(metadata?.toolStatus) ?? readString(toolCallsJson?.resultStatus),
      args: sanitizeInvocationOutputText(readRawString(toolCallsJson?.arguments)),
      output: sanitizeInvocationOutputText(readRawString(toolCallsJson?.output)),
      tokens: readParsedTurnTokens(metadata?.tokens),
      callId: readString(metadata?.toolCallId),
    };
  }

  const widgetState = extractWidgetStateFromMetadata(metadata, input.content, undefined, input.locale ?? "en");
  if (widgetState.type === "planning") {
    return {
      kind: "planning",
      status: widgetState.status,
      planName: widgetState.planName,
      ...(widgetState.targetWorker ? { targetWorker: widgetState.targetWorker } : {}),
    };
  }

  return { kind: "none" };
};

export const getChatWidgetData = (
  message: ChatMessageRecord,
  liveData?: ChatWidgetLiveData,
  locale: DashboardLocale = "en",
): ChatWidgetState => {
  return extractWidgetStateFromMetadata(message.metadata, message.bodyMarkdown, liveData, locale);
};

export const getInvocationWidgetData = (
  message: ExecutionInvocationMessageRecord,
  liveData?: ChatWidgetLiveData,
  locale: DashboardLocale = "en",
): ChatWidgetState => {
  return extractWidgetStateFromMetadata(message.metadata, message.contentMarkdown, liveData, locale);
};

const metaKind = (message: { metadata?: Record<string, unknown> | null }): string | undefined =>
  typeof message.metadata?.kind === "string" ? message.metadata.kind : undefined;

const metaCallId = (message: { metadata?: Record<string, unknown> | null }): string | undefined =>
  typeof message.metadata?.toolCallId === "string" ? message.metadata.toolCallId : undefined;

const reasoningTokenCount = (tokens: ParsedTurnTokens | null): number | null => {
  if (!tokens) {
    return null;
  }

  if (typeof tokens.reasoning === "number") {
    return tokens.reasoning;
  }

  if (typeof tokens.total === "number") {
    return tokens.total;
  }

  const total = (tokens.input ?? 0) + (tokens.cached ?? 0) + (tokens.output ?? 0);
  return total > 0 ? total : null;
};

const buildReasoningAriaLabel = (
  providerLabel: string | null,
  modelLabel: string | null,
  tokens: ParsedTurnTokens | null,
  createdAtLabel: string,
  locale: DashboardLocale,
): string => {
  const parts = [translateChatMessage(locale, "reasoningTurn")];

  if (providerLabel) {
    parts.push(providerLabel);
  }

  if (modelLabel) {
    parts.push(modelLabel);
  }

  const tokenCount = reasoningTokenCount(tokens);
  if (tokenCount !== null) {
    parts.push(translateChatMessage(locale, "tokens", { count: new Intl.NumberFormat(locale).format(tokenCount) }));
  }

  if (createdAtLabel) {
    parts.push(createdAtLabel);
  }

  return parts.join(" · ");
};

export const getReasoningWidgetData = (
  message: ExecutionInvocationMessageRecord,
  locale: DashboardLocale = "en",
): ReasoningWidgetState => {
  const metadata = message.metadata ?? null;
  const providerLabel = typeof metadata?.provider === "string" ? metadata.provider : null;
  const modelLabel = typeof metadata?.model === "string" ? metadata.model : null;
  const tokens = metadata && typeof metadata.tokens === "object" && metadata.tokens !== null
    ? (metadata.tokens as ParsedTurnTokens)
    : null;
  const createdAtLabel = formatChatTime(message.createdAt, locale);

  return {
    text: sanitizeInvocationOutputText(message.contentMarkdown || ""),
    providerLabel,
    modelLabel,
    tokens,
    createdAtLabel,
    ariaLabel: buildReasoningAriaLabel(providerLabel, modelLabel, tokens, createdAtLabel, locale),
  };
};

export const getSelfReflectionWidgetData = (
  message: ExecutionInvocationMessageRecord,
  locale: DashboardLocale = "en",
): SelfReflectionWidgetState | null => {
  const reflection = readRecord(message.metadata?.reflection);
  if (!reflection) {
    return null;
  }

  const purpose = normalizeReflectionPurpose(reflection.purpose);
  const purposeLabel = formatReflectionPurposeLabel(purpose, locale);
  const attempt = readNumber(reflection.attempt);
  const criteria = mergeReflectionCriteria(
    readArray(reflection.criteria),
    readArray(reflection.scores),
    locale,
  );
  const explicitPassed = readBoolean(reflection.passed);
  const passed = explicitPassed ?? (criteria.length > 0 && criteria.every((criterion) => criterion.passed === true)
    ? true
    : criteria.some((criterion) => criterion.passed === false)
      ? false
      : null);
  const errorMessage = readString(reflection.errorMessage) || readString(reflection.error_message);
  const stateLabel = errorMessage
    ? translateChatMessage(locale, "reflectionError")
    : passed === null
      ? translateChatMessage(locale, "notEvaluated")
      : passed
        ? translateChatMessage(locale, "passed")
        : translateChatMessage(locale, "needsImprovement");
  const finalDecision = readString(reflection.finalDecision) || readString(reflection.final_decision);
  const finalDecisionLabel = formatReflectionDecisionLabel(finalDecision);
  const attemptLabel = attempt === null ? null : translateChatMessage(locale, "attempt", { count: attempt + 1 });
  const ariaParts = [purposeLabel, stateLabel];
  if (finalDecisionLabel) {
    ariaParts.push(translateChatMessage(locale, "decision", { decision: finalDecisionLabel }));
  }
  if (attemptLabel) {
    ariaParts.push(attemptLabel);
  }

  return {
    event: readString(reflection.event),
    purpose,
    purposeLabel,
    attempt,
    attemptLabel,
    criteria,
    passed,
    stateLabel,
    finalDecision,
    finalDecisionLabel,
    errorMessage,
    ariaLabel: ariaParts.join(". "),
  };
};

/**
 * Collapses chat-thread `tool_call` and matching later `tool_result` messages
 * into one message. Chat messages do not have a top-level `toolCallsJson`
 * column, so the merged tool payload is carried in `metadata.toolCallsJson`.
 */
export const mergeChatToolMessages = (
  messages: ChatMessageRecord[],
): ChatMessageRecord[] => {
  const consumed = new Set<string>();
  const merged: ChatMessageRecord[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (consumed.has(message.id)) {
      continue;
    }
    const callId = metaCallId(message);
    if (metaKind(message) === "tool_call" && callId) {
      const result = messages.slice(i + 1).find(
        (candidate) => metaKind(candidate) === "tool_result" && metaCallId(candidate) === callId,
      );
      if (result) {
        consumed.add(result.id);
        const callTool = readRecord(message.metadata?.toolCallsJson) ?? {};
        const resultTool = readRecord(result.metadata?.toolCallsJson) ?? {};
        merged.push({
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            toolCallsJson: {
              ...callTool,
              output: resultTool.output ?? null,
              resultStatus: typeof result.metadata?.toolStatus === "string" ? result.metadata.toolStatus : null,
            },
          } as NonNullable<ChatMessageRecord["metadata"]>,
        });
        continue;
      }
    }
    merged.push(message);
  }

  return merged;
};

/**
 * Collapses a `tool_call` message and its matching `tool_result` (correlated by
 * `metadata.toolCallId`) into a single message so the chat renders one rich
 * tool card carrying both the invocation arguments and its output. The result
 * message is dropped once merged; unmatched messages pass through unchanged.
 */
export const mergeInvocationToolMessages = (
  messages: ExecutionInvocationMessageRecord[],
): ExecutionInvocationMessageRecord[] => {
  const consumed = new Set<string>();
  const merged: ExecutionInvocationMessageRecord[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (consumed.has(message.id)) {
      continue;
    }
    const callId = metaCallId(message);
    if (metaKind(message) === "tool_call" && callId) {
      const result = messages.slice(i + 1).find(
        (candidate) => metaKind(candidate) === "tool_result" && metaCallId(candidate) === callId,
      );
      if (result) {
        consumed.add(result.id);
        const callTool = (message.toolCallsJson ?? {}) as Record<string, unknown>;
        const resultTool = (result.toolCallsJson ?? {}) as Record<string, unknown>;
        merged.push({
          ...message,
          toolCallsJson: {
            ...callTool,
            output: resultTool.output ?? null,
            resultStatus: typeof result.metadata?.toolStatus === "string" ? result.metadata.toolStatus : null,
          },
        });
        continue;
      }
    }
    merged.push(message);
  }

  return merged;
};

export const getWorkingBubbleData = (
  runtimeState: ConversationRuntimeState | null | undefined,
  locale: DashboardLocale = "en",
): WorkingBubbleState => {
  if (!runtimeState) {
    return { isPlanning: false };
  }

  const isPlanning = runtimeState.routeKind === "virtual" || runtimeState.routeKind === "worker" ||
                     runtimeState.continuationStatus === "planning";

  const planName = runtimeState.providerLabel
    ? translateChatMessage(locale, "taskViaProvider", { provider: runtimeState.providerLabel })
    : translateChatMessage(locale, "executionPlan");

  return {
    isPlanning,
    planName,
    providerLabel: runtimeState.providerLabel,
    modelLabel: runtimeState.modelLabel,
  };
};

export interface ProviderStatusMetadata {
  provider?: string | null;
  model?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Formats provider instance label, e.g., 'antigravity primary'
 */
export function formatProviderInstanceLabel(
  provider: string | null | undefined,
  model: string | null | undefined
): string {
  if (!provider) return "";
  if (model) {
    return `${provider} ${model}`;
  }
  return provider;
}

/**
 * Formats status context, e.g., 'antigravity default running'
 */
export function formatStatusContext(
  provider: string | null | undefined,
  model: string | null | undefined,
  status: string | null | undefined
): string {
  const parts: string[] = [];
  if (provider) parts.push(provider);
  if (model) parts.push(model);
  if (status) parts.push(status);
  return parts.join(" ");
}

/**
 * Formats token counts, e.g., producing clean numbers or values.
 */
export function formatTokenCount(tokens: number | null | undefined, locale: DashboardLocale = "en"): string {
  if (tokens === undefined || tokens === null) return "0";
  return new Intl.NumberFormat(locale).format(tokens);
}

/**
 * Shortens UUIDs or identifiers to be compact but unambiguous
 */
export function shortenIdentifier(id: string | null | undefined): string {
  if (!id) return "";
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}
