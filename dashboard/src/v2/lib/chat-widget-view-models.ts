import type { ChatMessageRecord, ConversationRuntimeState, ExecutionInvocationMessageRecord, Task } from "../types.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionSprintRunSummary,
} from "../../types.js";
import type { ExecutionStatus } from "../components/chat/widgets/ChatWidgetFrame.js";
import { formatChatTime } from "./chat-time.js";
import { buildLiveSessionTasks } from "./live-session-task-structure.js";

export type ChatWidgetType = "planning" | "none";

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

const formatReflectionPurposeLabel = (purpose: SelfReflectionPurpose): string => {
  switch (purpose) {
    case "planning":
      return "Planning self-reflection";
    case "qa":
      return "QA self-reflection";
    case "unknown":
    default:
      return "Self-reflection";
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

const formatScoreLabel = (score: number | null): string => (
  score === null ? "No score" : `${score.toFixed(score % 1 === 0 ? 0 : 1)}/10`
);

const formatThresholdLabel = (threshold: number | null): string => (
  threshold === null ? "Threshold not set" : `Threshold ${threshold.toFixed(threshold % 1 === 0 ? 0 : 1)}/10`
);

const buildReflectionCriterionKey = (entry: Record<string, unknown>, index: number): string => (
  readString(entry.id) || readString(entry.key) || readString(entry.label) || `criterion-${index + 1}`
);

const buildReflectionCriterionState = (
  base: Record<string, unknown>,
  scoreEntry: Record<string, unknown> | null,
  index: number,
): SelfReflectionCriterionState => {
  const id = buildReflectionCriterionKey(scoreEntry ?? base, index);
  const label = readString(scoreEntry?.label) || readString(base.label) || readString(base.name) || formatStatusLabel(id);
  const score = normalizeReflectionScore(scoreEntry?.score ?? base.score ?? scoreEntry?.rating ?? base.rating);
  const threshold = normalizeReflectionThreshold(scoreEntry?.threshold ?? base.threshold);
  const explicitPassed = readBoolean(scoreEntry?.passed ?? base.passed);
  const passed = explicitPassed ?? (score !== null && threshold !== null ? score >= threshold : null);
  const starRating = score === null ? null : Math.max(0, Math.min(5, Math.round(score / 2)));
  const scoreLabel = formatScoreLabel(score);

  return {
    id,
    label,
    score,
    scoreLabel,
    starRating,
    starLabel: starRating === null ? `Rating unavailable for ${label}` : `Rating ${starRating} of 5 stars for ${label}; score ${scoreLabel}`,
    threshold,
    thresholdLabel: formatThresholdLabel(threshold),
    passed,
    stateLabel: passed === null ? "Not evaluated" : passed ? "Passed" : "Needs improvement",
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
    result.push(buildReflectionCriterionState(baseById.get(key) ?? {}, scoreEntry, index));
  });

  baseEntries.forEach((base, index) => {
    const key = buildReflectionCriterionKey(base, index);
    if (!seen.has(key)) {
      result.push(buildReflectionCriterionState(base, null, result.length));
    }
  });

  return result;
};

const resolveTaskStatus = (phase: string | undefined): Pick<LivePlanningTaskState, "statusKind" | "statusLabel" | "detailLabel"> => {
  if (!phase) {
    return { statusKind: "unknown", statusLabel: "Unknown", detailLabel: null };
  }
  if (phase.startsWith("PENDING_cap_")) {
    const [, , currentCount, limit] = phase.split("_");
    const detailLabel = currentCount && limit ? `Provider cap ${currentCount}/${limit}` : "Provider cap";
    return { statusKind: "queued", statusLabel: "Queued", detailLabel };
  }

  switch (phase) {
    case "PENDING":
      return { statusKind: "queued", statusLabel: "Queued", detailLabel: null };
    case "RUNNING":
      return { statusKind: "running", statusLabel: "Running", detailLabel: null };
    case "CODING_COMPLETED":
      return { statusKind: "review", statusLabel: "Review", detailLabel: "Code complete" };
    case "COMPLETED":
      return { statusKind: "completed", statusLabel: "Completed", detailLabel: null };
    case "FAILED":
      return { statusKind: "failed", statusLabel: "Failed", detailLabel: null };
    case "BLOCKED":
      return { statusKind: "blocked", statusLabel: "Blocked", detailLabel: null };
    case "QUOTA":
      return { statusKind: "quota", statusLabel: "Quota wait", detailLabel: null };
    default:
      return { statusKind: "unknown", statusLabel: formatStatusLabel(phase), detailLabel: null };
  }
};

const buildLivePlanningWidgetState = (
  metadata: Record<string, unknown> | null | undefined,
  fallbackStatus: ExecutionStatus,
  fallbackPlanName: string,
  liveData?: ChatWidgetLiveData,
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
    ...resolveTaskStatus(task.status),
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
  const requestLabel = formatStatusLabel(fallbackStatus);
  const runLabel = sprintRun ? formatStatusLabel(sprintRun.status) : "Awaiting run";

  return {
    sprintId,
    sprintKey,
    sprintName,
    runStatus,
    totalTasks,
    completedTasks,
    queuedTasks,
    percentComplete,
    progressLabel: `${completedTasks}/${totalTasks} · ${percentComplete}%`,
    materialization: {
      requestLabel,
      taskRecordsLabel: totalTasks > 0 ? `${totalTasks} task${totalTasks === 1 ? "" : "s"} materialized` : "Awaiting task records",
      runLabel,
    },
    tasks: taskStates,
  };
};

const extractWidgetStateFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  bodyMarkdown?: string,
  liveData?: ChatWidgetLiveData,
): ChatWidgetState => {
  if (!metadata) {
    return { type: "none", status: "completed", planName: "" };
  }

  const widgetMetadata = getWidgetMetadata(metadata);

  if (widgetMetadata && widgetMetadata.type === "planning_request") {
    const status = (widgetMetadata.status as ExecutionStatus) || (metadata.status as ExecutionStatus) || "completed";
    const planName = (widgetMetadata.route_path as string) || (metadata.planName as string) || (metadata.title as string) || "Execution Plan";
    const targetWorker = widgetMetadata.target_worker as string | undefined;
    const liveStatus = buildLivePlanningWidgetState(metadata, status, planName, liveData);
    return {
      type: "planning",
      status: liveStatus ? mapSprintRunStatusToExecutionStatus(liveStatus.runStatus, status) : status,
      planName,
      targetWorker,
      ...(liveStatus ? { liveStatus } : {}),
    };
  }

  const isPlanning = metadata.type === "planning" || metadata.routeKind === "planning" ||
    (typeof bodyMarkdown === "string" && bodyMarkdown.toLowerCase().includes("planning"));

  if (isPlanning || metadata.routeKind === "virtual" || metadata.routeKind === "worker") {
    const status = (metadata.status as ExecutionStatus) || "completed";
    const planName = (metadata.planName as string) || (metadata.title as string) || "Execution Plan";
    const liveStatus = buildLivePlanningWidgetState(metadata, status, planName, liveData);
    return {
      type: "planning",
      status: liveStatus ? mapSprintRunStatusToExecutionStatus(liveStatus.runStatus, status) : status,
      planName,
      ...(liveStatus ? { liveStatus } : {}),
    };
  }

  return { type: "none", status: "completed", planName: "" };
};

export const getChatWidgetData = (message: ChatMessageRecord, liveData?: ChatWidgetLiveData): ChatWidgetState => {
  return extractWidgetStateFromMetadata(message.metadata, message.bodyMarkdown, liveData);
};

export const getInvocationWidgetData = (message: ExecutionInvocationMessageRecord, liveData?: ChatWidgetLiveData): ChatWidgetState => {
  return extractWidgetStateFromMetadata(message.metadata, message.contentMarkdown, liveData);
};

const metaKind = (message: ExecutionInvocationMessageRecord): string | undefined =>
  typeof message.metadata?.kind === "string" ? message.metadata.kind : undefined;

const metaCallId = (message: ExecutionInvocationMessageRecord): string | undefined =>
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
): string => {
  const parts = ["Reasoning turn"];

  if (providerLabel) {
    parts.push(providerLabel);
  }

  if (modelLabel) {
    parts.push(modelLabel);
  }

  const tokenCount = reasoningTokenCount(tokens);
  if (tokenCount !== null) {
    parts.push(`${TOKEN_COUNT_FORMATTER.format(tokenCount)} tokens`);
  }

  if (createdAtLabel) {
    parts.push(createdAtLabel);
  }

  return parts.join(" · ");
};

export const getReasoningWidgetData = (message: ExecutionInvocationMessageRecord): ReasoningWidgetState => {
  const metadata = message.metadata ?? null;
  const providerLabel = typeof metadata?.provider === "string" ? metadata.provider : null;
  const modelLabel = typeof metadata?.model === "string" ? metadata.model : null;
  const tokens = metadata && typeof metadata.tokens === "object" && metadata.tokens !== null
    ? (metadata.tokens as ParsedTurnTokens)
    : null;
  const createdAtLabel = formatChatTime(message.createdAt);

  return {
    text: sanitizeInvocationOutputText(message.contentMarkdown || ""),
    providerLabel,
    modelLabel,
    tokens,
    createdAtLabel,
    ariaLabel: buildReasoningAriaLabel(providerLabel, modelLabel, tokens, createdAtLabel),
  };
};

export const getSelfReflectionWidgetData = (
  message: ExecutionInvocationMessageRecord,
): SelfReflectionWidgetState | null => {
  const reflection = readRecord(message.metadata?.reflection);
  if (!reflection) {
    return null;
  }

  const purpose = normalizeReflectionPurpose(reflection.purpose);
  const purposeLabel = formatReflectionPurposeLabel(purpose);
  const attempt = readNumber(reflection.attempt);
  const criteria = mergeReflectionCriteria(
    readArray(reflection.criteria),
    readArray(reflection.scores),
  );
  const explicitPassed = readBoolean(reflection.passed);
  const passed = explicitPassed ?? (criteria.length > 0 && criteria.every((criterion) => criterion.passed === true)
    ? true
    : criteria.some((criterion) => criterion.passed === false)
      ? false
      : null);
  const errorMessage = readString(reflection.errorMessage) || readString(reflection.error_message);
  const stateLabel = errorMessage
    ? "Reflection error"
    : passed === null
      ? "Not evaluated"
      : passed
        ? "Passed"
        : "Needs improvement";
  const finalDecision = readString(reflection.finalDecision) || readString(reflection.final_decision);
  const finalDecisionLabel = formatReflectionDecisionLabel(finalDecision);
  const attemptLabel = attempt === null ? null : `Attempt ${attempt + 1}`;
  const ariaParts = [purposeLabel, stateLabel];
  if (finalDecisionLabel) {
    ariaParts.push(`Decision ${finalDecisionLabel}`);
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

export const getWorkingBubbleData = (runtimeState: ConversationRuntimeState | null | undefined): WorkingBubbleState => {
  if (!runtimeState) {
    return { isPlanning: false };
  }

  const isPlanning = runtimeState.routeKind === "virtual" || runtimeState.routeKind === "worker" ||
                     runtimeState.continuationStatus === "planning";

  const planName = runtimeState.providerLabel
    ? `Task via ${runtimeState.providerLabel}`
    : "Execution Plan";

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
export function formatTokenCount(tokens: number | null | undefined): string {
  if (tokens === undefined || tokens === null) return "0";
  return TOKEN_COUNT_FORMATTER.format(tokens);
}

/**
 * Shortens UUIDs or identifiers to be compact but unambiguous
 */
export function shortenIdentifier(id: string | null | undefined): string {
  if (!id) return "";
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}
