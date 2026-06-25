import type {
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../contracts/app-types.js";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  CreateSprintInput,
  UpdateSprintInput,
  CreateTaskInput,
  UpdateTaskInput,
  ProjectStatus,
  ProjectSourceType,
  ProjectInitMode,
  SprintStatus,
  TaskStatus,
  TaskPriority,
  TaskExecutorType,
  SprintLinkedIssueInput,
  ProjectSetupRequestInput,
} from "../contracts/project-management-types.js";
import type {
  CreateQuicksprintTemplateInput,
  UpdateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
} from "../contracts/quicksprint-types.js";

// Validation Helpers

function parseEnum<T extends string>(value: unknown, allowedValues: T[], fieldName: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new Error(`Invalid value for ${fieldName}. Must be one of: ${allowedValues.join(", ")}`);
  }
  return value as T;
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return Boolean(value);
}

// Project Parsers

export function parseCreateProjectInput(body: unknown): CreateProjectInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Missing or empty required field: name");

  const sourceType = parseEnum(input.sourceType, ["local", "git"], "sourceType");
  if (!sourceType) throw new Error("Invalid value for sourceType. Must be one of: local, git");

  const sourceRef = typeof input.sourceRef === "string" ? input.sourceRef.trim() : "";
  if (!sourceRef) throw new Error("Missing or empty required field: sourceRef");

  return {
    name,
    sourceType,
    sourceRef,
    cloneDir: parseOptionalString(input.cloneDir),
    setup: input.setup as ProjectSetupRequestInput | undefined,
    defaultBranch: parseOptionalString(input.defaultBranch),
    featureBranchPrefix: parseOptionalString(input.featureBranchPrefix),
    status: parseEnum(input.status, ["running", "failed", "intervention", "idle"], "status"),
    initMode: parseEnum(input.initMode, ["existing", "new-local", "new-remote"], "initMode"),
    isPrivate: parseOptionalBoolean(input.isPrivate),
    remoteProvider: parseEnum(input.remoteProvider, ["github", "gitlab"], "remoteProvider"),
  };
}

export function parseUpdateProjectInput(body: unknown): UpdateProjectInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  return {
    name: parseOptionalString(input.name),
    sourceType: parseEnum(input.sourceType, ["local", "git"], "sourceType"),
    sourceRef: parseOptionalString(input.sourceRef),
    baseDir: parseOptionalString(input.baseDir),
    defaultBranch: parseOptionalString(input.defaultBranch) ?? (input.defaultBranch === null ? null : undefined),
    featureBranchPrefix: parseOptionalString(input.featureBranchPrefix) ?? (input.featureBranchPrefix === null ? null : undefined),
    status: parseEnum(input.status, ["running", "failed", "intervention", "idle"], "status"),
  };
}

// Sprint Parsers

export function parseCreateSprintInput(body: unknown): CreateSprintInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Missing or empty required field: name");

  return {
    name,
    originalPrompt: parseOptionalString(input.originalPrompt) ?? (input.originalPrompt === null ? null : undefined),
    goal: parseOptionalString(input.goal),
    linkedIssues: input.linkedIssues as SprintLinkedIssueInput[] | undefined,
    number: parseOptionalNumber(input.number) ?? (input.number === null ? null : undefined),
    slug: parseOptionalString(input.slug),
    status: parseEnum(input.status, ["running", "paused", "completed", "failed", "cancelled", "idle"], "status"),
    showcasePinned: parseOptionalBoolean(input.showcasePinned),
    startDate: parseOptionalString(input.startDate) ?? (input.startDate === null ? null : undefined),
    endDate: parseOptionalString(input.endDate) ?? (input.endDate === null ? null : undefined),
    featureBranch: parseOptionalString(input.featureBranch) ?? (input.featureBranch === null ? null : undefined),
    baseCommitSha: parseOptionalString(input.baseCommitSha) ?? (input.baseCommitSha === null ? null : undefined),
  };
}

export function parseUpdateSprintInput(body: unknown): UpdateSprintInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  return {
    name: parseOptionalString(input.name),
    originalPrompt: parseOptionalString(input.originalPrompt) ?? (input.originalPrompt === null ? null : undefined),
    goal: parseOptionalString(input.goal),
    linkedIssues: input.linkedIssues as SprintLinkedIssueInput[] | undefined,
    number: parseOptionalNumber(input.number) ?? (input.number === null ? null : undefined),
    slug: parseOptionalString(input.slug),
    status: parseEnum(input.status, ["running", "paused", "completed", "failed", "cancelled", "idle"], "status"),
    showcasePinned: parseOptionalBoolean(input.showcasePinned),
    startDate: parseOptionalString(input.startDate) ?? (input.startDate === null ? null : undefined),
    endDate: parseOptionalString(input.endDate) ?? (input.endDate === null ? null : undefined),
    featureBranch: parseOptionalString(input.featureBranch) ?? (input.featureBranch === null ? null : undefined),
    baseCommitSha: parseOptionalString(input.baseCommitSha) ?? (input.baseCommitSha === null ? null : undefined),
  };
}

// Task Parsers

export function parseCreateTaskInput(body: unknown): CreateTaskInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  const sprintId = typeof input.sprintId === "string" ? input.sprintId.trim() : "";
  if (!sprintId) throw new Error("Missing or empty required field: sprintId");

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) throw new Error("Missing or empty required field: title");

  return {
    sprintId,
    title,
    taskKey: parseOptionalString(input.taskKey),
    promptMarkdown: parseOptionalString(input.promptMarkdown),
    description: parseOptionalString(input.description),
    status: parseEnum(input.status, ["pending", "in_progress", "coding_completed", "completed", "QA_REVIEW_FAILED"], "status"),
    priority: parseEnum(input.priority, ["critical", "high", "medium", "low"], "priority"),
    executorType: parseEnum(input.executorType, ["auto", "docker_cli", "jules"], "executorType"),
    agentPresetId: parseOptionalString(input.agentPresetId) ?? (input.agentPresetId === null ? null : undefined),
    sortOrder: parseOptionalNumber(input.sortOrder),
    dependsOnTaskIds: Array.isArray(input.dependsOnTaskIds) ? input.dependsOnTaskIds.map(String) : undefined,
    isIndependent: parseOptionalBoolean(input.isIndependent),
    isMerged: parseOptionalBoolean(input.isMerged),
    mergeIndicator: parseOptionalString(input.mergeIndicator) ?? (input.mergeIndicator === null ? null : undefined),
    sourceType: parseOptionalString(input.sourceType) ?? (input.sourceType === null ? null : undefined),
    sourcePath: parseOptionalString(input.sourcePath) ?? (input.sourcePath === null ? null : undefined),
    model: parseOptionalString(input.model) ?? (input.model === null ? null : undefined),
  };
}

export function parseUpdateTaskInput(body: unknown): UpdateTaskInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  return {
    title: parseOptionalString(input.title),
    promptMarkdown: parseOptionalString(input.promptMarkdown),
    description: parseOptionalString(input.description),
    status: parseEnum(input.status, ["pending", "in_progress", "coding_completed", "completed", "QA_REVIEW_FAILED"], "status"),
    priority: parseEnum(input.priority, ["critical", "high", "medium", "low"], "priority"),
    executorType: parseEnum(input.executorType, ["auto", "docker_cli", "jules"], "executorType"),
    agentPresetId: parseOptionalString(input.agentPresetId) ?? (input.agentPresetId === null ? null : undefined),
    model: parseOptionalString(input.model) ?? (input.model === null ? null : undefined),
    sortOrder: parseOptionalNumber(input.sortOrder),
    dependsOnTaskIds: Array.isArray(input.dependsOnTaskIds) ? input.dependsOnTaskIds.map(String) : undefined,
    isIndependent: parseOptionalBoolean(input.isIndependent),
    isMerged: parseOptionalBoolean(input.isMerged),
    mergeIndicator: parseOptionalString(input.mergeIndicator) ?? (input.mergeIndicator === null ? null : undefined),
    sourceType: parseOptionalString(input.sourceType) ?? (input.sourceType === null ? null : undefined),
    sourcePath: parseOptionalString(input.sourcePath) ?? (input.sourcePath === null ? null : undefined),
  };
}

// Quicksprint Parsers

export function parseCreateQuicksprintTemplateInput(body: unknown): CreateQuicksprintTemplateInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Missing or empty required field: name");

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) throw new Error("Missing or empty required field: description");

  const icon = typeof input.icon === "string" ? input.icon.trim() : "";
  if (!icon) throw new Error("Missing or empty required field: icon");

  const category = typeof input.category === "string" ? input.category.trim() : "";
  if (!category) throw new Error("Missing or empty required field: category");

  const agentInstructionMarkdown = typeof input.agentInstructionMarkdown === "string" ? input.agentInstructionMarkdown.trim() : "";
  if (!agentInstructionMarkdown) throw new Error("Missing or empty required field: agentInstructionMarkdown");

  return {
    name,
    description,
    icon,
    category,
    categoryColor: parseOptionalString(input.categoryColor),
    agentInstructionMarkdown,
    defaultTaskCount: parseOptionalNumber(input.defaultTaskCount),
    agentPresetId: parseOptionalString(input.agentPresetId),
  };
}

export function parseUpdateQuicksprintTemplateInput(body: unknown): UpdateQuicksprintTemplateInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  return {
    name: parseOptionalString(input.name),
    description: parseOptionalString(input.description),
    icon: parseOptionalString(input.icon),
    category: parseOptionalString(input.category),
    categoryColor: parseOptionalString(input.categoryColor),
    agentInstructionMarkdown: parseOptionalString(input.agentInstructionMarkdown),
    defaultTaskCount: parseOptionalNumber(input.defaultTaskCount),
    agentPresetId: parseOptionalString(input.agentPresetId),
  };
}

export function parseQuicksprintExecutionInput(body: unknown): QuicksprintExecutionInput {
  if (!body || typeof body !== "object") throw new Error("Invalid input: body must be an object");
  const input = body as Record<string, unknown>;

  const templateId = typeof input.templateId === "string" ? input.templateId.trim() : "";
  if (!templateId) throw new Error("Missing or empty required field: templateId");

  const taskCount = typeof input.taskCount === "number" && Number.isFinite(input.taskCount)
    ? Math.floor(input.taskCount)
    : undefined;
  if (taskCount === undefined || taskCount <= 0) {
    throw new Error("Missing or invalid required field: taskCount");
  }

  if (input.submitMode !== "plan_only" && input.submitMode !== "plan_and_start") {
    throw new Error("Invalid submitMode. Must be 'plan_only' or 'plan_and_start'.");
  }

  return {
    templateId,
    taskCount,
    submitMode: input.submitMode,
    routeOverride: typeof input.routeOverride === "string" ? input.routeOverride : undefined,
    modelOverride: typeof input.modelOverride === "string" ? input.modelOverride : undefined,
    agentPresetId: typeof input.agentPresetId === "string" ? input.agentPresetId : undefined,
    additionalPrompt: typeof input.additionalPrompt === "string" ? input.additionalPrompt : undefined,
    planningOverrides: parsePlanningOverrides(input.planningOverrides),
  };
}

import type {
  ImprovePromptInput,
  PlanningOverrides,
  PlanSprintOptions,
} from "../contracts/project-management-types.js";
import type {
  CreateConversationThreadInput,
  UpdateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  ConversationThreadScope,
} from "../contracts/connection-chat-types.js";

export function parseTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireTrimmedString(value: unknown, name: string): string {
  const trimmed = parseTrimmedString(value);
  if (trimmed === undefined) {
    throw new Error(`Missing or empty required field: ${name}`);
  }
  return trimmed;
}

export function parseThreadRouteInput(body: unknown): { routeKind: "worker" | "virtual"; virtualProvider?: string; virtualModel?: string; workerEndpointId?: string } {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  const routeKind = typedBody.routeKind;
  if (routeKind !== "worker" && routeKind !== "virtual") {
    throw new Error("Invalid routeKind. Must be 'worker' or 'virtual'.");
  }
  return {
    routeKind,
    virtualProvider: typeof typedBody.virtualProvider === "string" ? typedBody.virtualProvider.trim() : undefined,
    virtualModel: typeof typedBody.virtualModel === "string" ? typedBody.virtualModel.trim() : undefined,
    workerEndpointId: typeof typedBody.workerEndpointId === "string" ? typedBody.workerEndpointId.trim() : undefined,
  };
}

export function parsePlanningOverrides(value: unknown): PlanningOverrides | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const overrides: PlanningOverrides = {};
  if (typeof input.workerId === "string" && input.workerId.trim()) {
    overrides.workerId = input.workerId.trim();
  }
  if (typeof input.virtualProvider === "string" && input.virtualProvider.trim()) {
    overrides.virtualProvider = input.virtualProvider.trim() as PlanningOverrides["virtualProvider"];
  }
  if (typeof input.virtualModel === "string" && input.virtualModel.trim()) {
    overrides.virtualModel = input.virtualModel.trim();
  }
  if (typeof input.planningAgentPresetId === "string" && input.planningAgentPresetId.trim()) {
    overrides.planningAgentPresetId = input.planningAgentPresetId.trim();
  }
  if (input.agentRoutingMode === "MANUAL" || input.agentRoutingMode === "ORCHESTRATOR") {
    overrides.agentRoutingMode = input.agentRoutingMode;
  }
  if (typeof input.workerAgentPresetId === "string" && input.workerAgentPresetId.trim()) {
    overrides.workerAgentPresetId = input.workerAgentPresetId.trim();
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function parseImprovePromptInput(body: unknown): ImprovePromptInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  return {
    name: typeof typedBody.name === "string" ? typedBody.name.trim() : "",
    goal: typeof typedBody.goal === "string" ? typedBody.goal : "",
    clientRequestId: typeof typedBody.clientRequestId === "string" ? typedBody.clientRequestId.trim() : undefined,
    planningAgentPresetId: typeof typedBody.planningAgentPresetId === "string" ? typedBody.planningAgentPresetId.trim() : undefined,
    overrides: parsePlanningOverrides(typedBody.overrides),
  };
}

export function parsePlanSprintOptions(body: unknown): PlanSprintOptions {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  return {
    autoStart: Boolean(typedBody.autoStart),
    replan: Boolean(typedBody.replan),
    clientRequestId: typeof typedBody.clientRequestId === "string" ? typedBody.clientRequestId.trim() : undefined,
    planningAgentPresetId: typeof typedBody.planningAgentPresetId === "string" ? typedBody.planningAgentPresetId.trim() : undefined,
    overrides: parsePlanningOverrides(typedBody.overrides),
  };
}

export function parseRerunTaskOptions(body: unknown): { provider?: string; providerConfigId?: string; model?: string; clearWorktree?: boolean; resetDependents?: boolean; undoMerge?: boolean } {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  return {
    provider: typeof typedBody.provider === "string" ? typedBody.provider : undefined,
    providerConfigId: typeof typedBody.providerConfigId === "string" ? typedBody.providerConfigId : undefined,
    model: typeof typedBody.model === "string" ? typedBody.model : undefined,
    clearWorktree: Boolean(typedBody.clearWorktree),
    resetDependents: Boolean(typedBody.resetDependents),
    undoMerge: Boolean(typedBody.undoMerge),
  };
}

export function parsePreferredWorkerAssignment(body: unknown): { workerConnectionId?: string | null; workerEndpointId?: string | null; workerEndpointKey?: string | null } {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;

  const parseNullable = (value: unknown): string | null | undefined => {
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    workerConnectionId: parseNullable(typedBody.workerConnectionId),
    workerEndpointId: parseNullable(typedBody.workerEndpointId),
    workerEndpointKey: parseNullable(typedBody.workerEndpointKey),
  };
}

export function parseClaimAttentionItemPayload(body: unknown): { workerEndpointId?: string; claimReason?: string } {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  return {
    workerEndpointId: typeof typedBody.workerEndpointId === "string" ? typedBody.workerEndpointId.trim() : undefined,
    claimReason: typeof typedBody.claimReason === "string" ? typedBody.claimReason.trim() : undefined,
  };
}

export function parseResolveAttentionItemPayload(body: unknown): { status: "resolved" | "dismissed"; reason?: string; resolutionSummaryMarkdown?: string } {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  const requestedStatus = typeof typedBody.status === "string" ? typedBody.status.trim() : undefined;

  if (requestedStatus !== "resolved" && requestedStatus !== "dismissed") {
    throw new Error("Invalid status. Must be 'resolved' or 'dismissed'.");
  }

  return {
    status: requestedStatus,
    reason: typeof typedBody.reason === "string" ? typedBody.reason.trim() : undefined,
    resolutionSummaryMarkdown: typeof typedBody.resolutionSummaryMarkdown === "string"
      ? typedBody.resolutionSummaryMarkdown
      : undefined,
  };
}

export function parseCreateConversationThreadInput(body: unknown): CreateConversationThreadInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  const title = typeof typedBody.title === "string" ? typedBody.title.trim() : "";
  if (!title) {
    throw new Error("Missing or empty required field: title");
  }

  let scope = typedBody.scope as ConversationThreadScope | undefined;
  if (scope !== undefined && scope !== "project" && scope !== "connection") {
    throw new Error("Invalid scope. Must be 'project' or 'connection'.");
  }

  return {
    title,
    connectionId: typeof typedBody.connectionId === "string" ? typedBody.connectionId.trim() : (typedBody.connectionId === null ? null : undefined),
    scope,
    runtimeState: typedBody.runtimeState as CreateConversationThreadInput["runtimeState"],
  };
}

export function parseUpdateConversationThreadInput(body: unknown): UpdateConversationThreadInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  return {
    connectionId: typeof typedBody.connectionId === "string" ? typedBody.connectionId.trim() : (typedBody.connectionId === null ? null : undefined),
    runtimeState: typedBody.runtimeState as UpdateConversationThreadInput["runtimeState"],
  };
}

export function parseCreateDashboardConversationMessageInput(body: unknown): CreateDashboardConversationMessageInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }
  const typedBody = body as Record<string, unknown>;
  const bodyMarkdown = typeof typedBody.bodyMarkdown === "string" ? typedBody.bodyMarkdown.trim() : "";
  if (!bodyMarkdown) {
    throw new Error("Missing or empty required field: bodyMarkdown");
  }

  return {
    bodyMarkdown,
    threadId: typeof typedBody.threadId === "string" ? typedBody.threadId.trim() : undefined,
    title: typeof typedBody.title === "string" ? typedBody.title.trim() : undefined,
    connectionId: typeof typedBody.connectionId === "string" ? typedBody.connectionId.trim() : (typedBody.connectionId === null ? null : undefined),
    metadata: typedBody.metadata as CreateDashboardConversationMessageInput["metadata"],
  };
}

export function parseStatsDateInput(value: string | undefined, edge: "start" | "end"): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseProjectStatsQuery(query: Record<string, unknown>): ProjectStatsQuery {
  const requestedWindow = typeof query.window === "string" ? query.window.trim() : "";
  const window: ProjectStatsWindow = (
    requestedWindow === "1h" ||
    requestedWindow === "24h" ||
    requestedWindow === "7d" ||
    requestedWindow === "30d" ||
    requestedWindow === "all" ||
    requestedWindow === "custom"
  ) ? (requestedWindow as ProjectStatsWindow) : "7d";

  let from = typeof query.from === "string" && query.from.trim().length > 0 ? query.from.trim() : undefined;
  let to = typeof query.to === "string" && query.to.trim().length > 0 ? query.to.trim() : undefined;

  if (window === "custom") {
    const fromDate = parseStatsDateInput(from, "start");
    const toDate = parseStatsDateInput(to, "end");

    if (!fromDate || !toDate) {
      throw new Error("Custom stats windows require valid from and to values.");
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new Error("Custom stats window start must be earlier than end.");
    }

    const MIN_DATE = new Date("2000-01-01T00:00:00.000Z").getTime();
    const MAX_DATE = Date.now() + 30 * 24 * 60 * 60 * 1000;

    if (fromDate.getTime() < MIN_DATE) {
      from = "2000-01-01T00:00:00.000Z";
    } else {
      from = fromDate.toISOString();
    }

    if (toDate.getTime() > MAX_DATE) {
      to = new Date(MAX_DATE).toISOString();
    } else {
      to = toDate.toISOString();
    }
  }

  return { window, from, to };
}
