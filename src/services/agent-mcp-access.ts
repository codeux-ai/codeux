import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import type { CustomMcpServer, McpToolToggle } from "../contracts/app-types.js";
import { TOOL_DEFINITIONS } from "../contracts/mcp-tool-definitions.js";
import type { McpToolAudience, ToolName } from "../contracts/mcp-tool-definitions.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { ProviderInvocationUsageRecord } from "../contracts/execution-types.js";
import type { ExecutionInvocationRecord } from "../contracts/invocation-types.js";
import { sanitizeCustomMcpServers } from "../mcp/mcp-tool-availability.js";
import { DEFAULT_PLAYWRIGHT_MCP_SERVER_ID } from "../repositories/settings-defaults.js";
import type { AgentCodeUxToolAccess } from "../mcp/mcp-tool-availability.js";

const VALID_TOOL_NAMES = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.name));

export const defaultAgentMcpAccess = (): AgentMcpAccessConfig => ({
  codeUxEnabled: false,
  codeUxToolToggles: [],
  linkedServerIds: [],
});

export const defaultCodingAgentLinkedServerIds = (): string[] => [
  DEFAULT_PLAYWRIGHT_MCP_SERVER_ID,
];

export const defaultCodingAgentMcpAccess = (): AgentMcpAccessConfig => ({
  ...defaultAgentMcpAccess(),
  linkedServerIds: defaultCodingAgentLinkedServerIds(),
});

const normalizeLinkedServerIds = (linkedServerIds: readonly string[] = []): string[] => Array.from(
  new Set(linkedServerIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())),
);

const dashboardReplyLinkedServerIds = (linkedServerIds: readonly string[] = []): string[] => normalizeLinkedServerIds([
  DEFAULT_PLAYWRIGHT_MCP_SERVER_ID,
  ...linkedServerIds,
]);

export const codeUxAgentMcpAccess = (linkedServerIds: readonly string[] = []): AgentMcpAccessConfig => ({
  codeUxEnabled: true,
  codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    enabled: true,
    isInternal: true,
  })),
  linkedServerIds: normalizeLinkedServerIds(linkedServerIds),
});

export const codeUxAgentMcpAccessWithoutScheduler = (linkedServerIds: readonly string[] = []): AgentMcpAccessConfig => ({
  codeUxEnabled: true,
  codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    enabled: tool.name !== "scheduler_code_ux",
    isInternal: true,
  })),
  linkedServerIds: normalizeLinkedServerIds(linkedServerIds),
});

export const schedulerOnlyAgentMcpAccess = (linkedServerIds: readonly string[] = []): AgentMcpAccessConfig => ({
  codeUxEnabled: true,
  codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    enabled: tool.name === "scheduler_code_ux",
    isInternal: true,
  })),
  linkedServerIds: normalizeLinkedServerIds(linkedServerIds),
});

export const dashboardReplyAgentMcpAccess = (access: AgentMcpAccessConfig | null | undefined): AgentMcpAccessConfig => {
  if (!access?.codeUxEnabled) {
    return codeUxAgentMcpAccess(dashboardReplyLinkedServerIds(access?.linkedServerIds));
  }
  const byName = new Map(access.codeUxToolToggles.map((toggle) => [toggle.name, toggle]));
  byName.set("scheduler_code_ux", { name: "scheduler_code_ux", enabled: true, isInternal: true });
  byName.set("add_long_term_memory", { name: "add_long_term_memory", enabled: true, isInternal: true });
  return {
    ...access,
    codeUxEnabled: true,
    linkedServerIds: dashboardReplyLinkedServerIds(access.linkedServerIds),
    codeUxToolToggles: Array.from(byName.values()),
  };
};

export const isWorkerClarificationAgent = (args: {
  agentId: string;
  assignedTaskAgentIds: readonly string[];
  settings: DashboardSettings;
}): boolean => {
  const routing = args.settings.agents.routing.taskCoding;
  return args.assignedTaskAgentIds.includes(args.agentId)
    || (routing.mode === "MANUAL" && routing.agentPresetId === args.agentId)
    || routing.orchestratorAgentPresetIds.includes(args.agentId);
};

/**
 * Authorize the narrow clarification audience from the live execution that
 * launched the MCP client. Request scope may be omitted because the service
 * derives it from the invocation, but any supplied scope must match exactly.
 */
export const isInvocationScopedWorkerClarificationAgent = (args: {
  agentId: string;
  projectId: string;
  invocation: Pick<
    ExecutionInvocationRecord,
    "agentPresetId" | "projectId" | "status" | "taskId" | "taskRunId" | "type"
  > | null;
  requestedTaskId?: unknown;
  requestedTaskRunId?: unknown;
}): boolean => {
  const invocation = args.invocation;
  if (
    !invocation
    || invocation.projectId !== args.projectId
    || invocation.agentPresetId !== args.agentId
    || invocation.type !== "cli_task_coding"
    || invocation.status !== "running"
  ) {
    return false;
  }
  if (args.requestedTaskId !== undefined && args.requestedTaskId !== invocation.taskId) {
    return false;
  }
  return args.requestedTaskRunId === undefined || args.requestedTaskRunId === invocation.taskRunId;
};

export const isProjectManagerClarificationAgent = (args: {
  agentId: string;
  agentName: string;
  settings: DashboardSettings;
}): boolean => {
  const routing = args.settings.agents.routing;
  if (routing.dashboardReply.agentPresetId === args.agentId || routing.clarificationReply.agentPresetId === args.agentId) {
    return true;
  }
  if (routing.dashboardReply.agentPresetId && routing.clarificationReply.agentPresetId) {
    return false;
  }
  const normalizedName = args.agentName.trim().toLowerCase();
  return normalizedName === "project manager" || normalizedName === "iris";
};

/** Add one audience-scoped clarification grant without enabling unrelated tools. */
export const withClarificationAudienceAccess = (
  access: AgentCodeUxToolAccess,
  audience: McpToolAudience,
  toolName: Extract<ToolName, "request_clarification" | "reply_to_clarification">,
): AgentCodeUxToolAccess => ({
  ...access,
  audiences: Array.from(new Set([...(access.audiences ?? []), audience])),
  audienceToolNames: Array.from(new Set([...(access.audienceToolNames ?? []), toolName])),
});

/** Expose only the narrow attached-flow runner when an agent owns at least one flow attachment. */
export const withAttachedFlowAccess = (access: AgentCodeUxToolAccess): AgentCodeUxToolAccess => {
  const byName = new Map(access.codeUxToolToggles.map((toggle) => [toggle.name, toggle]));
  byName.set("run_attached_flow", { name: "run_attached_flow", enabled: true, isInternal: true });
  return {
    ...access,
    codeUxEnabled: true,
    audiences: Array.from(new Set([...(access.audiences ?? []), "worker" as const])),
    codeUxToolToggles: Array.from(byName.values()),
  };
};

const clarificationGatewayAccess = (
  access: AgentMcpAccessConfig | null | undefined,
  toolName: Extract<ToolName, "request_clarification" | "reply_to_clarification">,
): AgentMcpAccessConfig => {
  if (access?.codeUxEnabled) return access;
  return {
    ...(access ?? defaultAgentMcpAccess()),
    codeUxEnabled: true,
    codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      enabled: tool.name === toolName,
      isInternal: true,
    })),
  };
};

/** Ensure an already-selected coding worker receives the gateway connection for its narrow request grant. */
export const workerClarificationAgentMcpAccess = (
  access: AgentMcpAccessConfig | null | undefined,
): AgentMcpAccessConfig => clarificationGatewayAccess(access, "request_clarification");

/** Ensure an already-selected clarification reply agent receives the gateway connection for its narrow reply grant. */
export const projectManagerClarificationAgentMcpAccess = (
  access: AgentMcpAccessConfig | null | undefined,
): AgentMcpAccessConfig => clarificationGatewayAccess(access, "reply_to_clarification");

/**
 * Automated clarification generation is a decision-only turn. It may inspect
 * project knowledge and persistent skill guidance, but it must not mutate
 * project state or contact arbitrary linked MCP servers. The runtime delivers
 * the returned answer after the provider exits, so this turn does not need the
 * reply tool either.
 */
export const automaticClarificationReplyAgentMcpAccess = (): AgentMcpAccessConfig => {
  const readOnlyTools = new Set<ToolName>(["search_knowledge", "search_skills"]);
  return {
    codeUxEnabled: true,
    codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      enabled: readOnlyTools.has(tool.name),
      isInternal: true,
    })),
    linkedServerIds: [],
  };
};

/**
 * Identify the exact internal provider turn used to draft an automatic
 * clarification answer. Persisted agent permissions must not broaden this
 * decision-only invocation.
 */
export const isAutomaticClarificationReplyInvocation = (args: {
  agentId: string;
  projectId: string;
  invocation: Pick<
    ExecutionInvocationRecord,
    "agentPresetId" | "projectId" | "providerInvocationId" | "status" | "type"
  > | null;
  providerUsage: Pick<ProviderInvocationUsageRecord, "id" | "projectId" | "purpose" | "status"> | null;
}): boolean => {
  const { invocation, providerUsage } = args;
  return Boolean(
    invocation
    && providerUsage
    && invocation.type === "worker_reply"
    && invocation.status === "running"
    && invocation.agentPresetId === args.agentId
    && invocation.projectId === args.projectId
    && invocation.providerInvocationId === providerUsage.id
    && providerUsage.projectId === args.projectId
    && providerUsage.purpose === "clarification_reply"
    && providerUsage.status === "running",
  );
};

export const isSchedulerOnlyAgentMcpAccess = (
  access: Pick<AgentMcpAccessConfig, "codeUxEnabled" | "codeUxToolToggles">,
): boolean => {
  if (!access.codeUxEnabled) return false;
  const enabledByName = new Map(access.codeUxToolToggles.map((toggle) => [toggle.name, toggle.enabled]));
  return TOOL_DEFINITIONS.every((tool) => enabledByName.get(tool.name) === (tool.name === "scheduler_code_ux"));
};

const sanitizeToolToggles = (value: unknown): McpToolToggle[] => {
  if (!Array.isArray(value)) return [];
  const byName = new Map<string, boolean>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<McpToolToggle>;
    if (typeof candidate.name !== "string" || typeof candidate.enabled !== "boolean") continue;
    const name = candidate.name.trim();
    if (!VALID_TOOL_NAMES.has(name)) continue;
    byName.set(name, candidate.enabled);
  }
  return Array.from(byName.entries()).map(([name, enabled]) => ({ name, enabled, isInternal: true }));
};

export const sanitizeAgentMcpAccess = (value: unknown): AgentMcpAccessConfig => {
  if (!value || typeof value !== "object") return defaultAgentMcpAccess();
  const candidate = value as Partial<AgentMcpAccessConfig>;
  const linkedServerIds = Array.isArray(candidate.linkedServerIds)
    ? Array.from(
        new Set(
          candidate.linkedServerIds
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id) => id.trim()),
        ),
      )
    : [];
  return {
    codeUxEnabled: candidate.codeUxEnabled === true,
    codeUxToolToggles: sanitizeToolToggles(candidate.codeUxToolToggles),
    linkedServerIds,
  };
};

export interface ResolvedAgentMcpRuntime {
  customMcpServers: CustomMcpServer[];
  mcpConnection: McpConnectionInfo | null;
}

const retrievalOnlySkillToolAccess = (): AgentCodeUxToolAccess => ({
  codeUxEnabled: true,
  codeUxToolToggles: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    enabled: tool.name === "search_skills",
    isInternal: true,
  })),
});

const withSkillRetrievalEnabled = (access: AgentMcpAccessConfig): AgentMcpAccessConfig => {
  if (!access.codeUxEnabled) {
    return {
      ...access,
      codeUxEnabled: true,
      codeUxToolToggles: retrievalOnlySkillToolAccess().codeUxToolToggles,
    };
  }
  const byName = new Map(access.codeUxToolToggles.map((toggle) => [toggle.name, toggle]));
  byName.set("search_skills", { name: "search_skills", enabled: true, isInternal: true });
  return {
    ...access,
    codeUxToolToggles: Array.from(byName.values()),
  };
};

/**
 * Apply per-agent MCP access to a base set of custom servers + code_ux connection.
 * When `access` is missing for an agent-scoped run, the run falls back to
 * default-deny agent access. Non-agent runs still inherit provider-wide MCP
 * inputs unchanged.
 * When agent-scoped and code_ux is enabled, the agent id is attached to the connection so
 * the gateway can enforce per-agent code_ux tool toggles.
 */
export const resolveAgentMcpRuntime = (args: {
  access: AgentMcpAccessConfig | null | undefined;
  agentId: string | null | undefined;
  executionInvocationId?: string | null;
  customMcpServers: CustomMcpServer[];
  mcpConnection: McpConnectionInfo | null;
  persistentSkillRetrievalEnabled?: boolean;
}): ResolvedAgentMcpRuntime => {
  const agentScoped = typeof args.agentId === "string" && args.agentId.trim().length > 0;
  const resolvedAccess = args.access ?? (agentScoped ? defaultAgentMcpAccess() : null);

  if (resolvedAccess == null) {
    const mcpConnection = args.mcpConnection && args.agentId
      ? {
        ...args.mcpConnection,
        agentId: args.agentId,
        executionInvocationId: args.executionInvocationId ?? undefined,
      }
      : args.mcpConnection;
    return {
      customMcpServers: args.customMcpServers,
      mcpConnection,
    };
  }

  const access = args.persistentSkillRetrievalEnabled
    ? withSkillRetrievalEnabled(resolvedAccess)
    : resolvedAccess;
  const linked = new Set(access.linkedServerIds);
  const customMcpServers = sanitizeCustomMcpServers(args.customMcpServers).filter((server) => linked.has(server.id));
  const baseConnection = access.codeUxEnabled ? args.mcpConnection : null;
  const mcpConnection = baseConnection && args.agentId
    ? {
      ...baseConnection,
      agentId: args.agentId,
      executionInvocationId: args.executionInvocationId ?? undefined,
    }
    : baseConnection;

  return { customMcpServers, mcpConnection };
};

export const toAgentCodeUxToolAccess = (
  access: Pick<AgentMcpAccessConfig, "codeUxEnabled" | "codeUxToolToggles">,
  persistentSkillRetrievalEnabled = false,
): AgentCodeUxToolAccess => ({
  ...(persistentSkillRetrievalEnabled
    ? (access.codeUxEnabled
      ? {
        codeUxEnabled: true,
        codeUxToolToggles: withSkillRetrievalEnabled({
          codeUxEnabled: access.codeUxEnabled,
          codeUxToolToggles: access.codeUxToolToggles,
          linkedServerIds: [],
        }).codeUxToolToggles,
      }
      : retrievalOnlySkillToolAccess())
    : {
      codeUxEnabled: access.codeUxEnabled,
      codeUxToolToggles: access.codeUxToolToggles,
    }),
});

/** Merge per-agent code_ux tool toggles over the system-level toggles. */
export const mergeCodeUxToolToggles = (
  base: McpToolToggle[],
  agentToggles: McpToolToggle[] | AgentCodeUxToolAccess | null | undefined,
): McpToolToggle[] => {
  if (agentToggles && !Array.isArray(agentToggles) && !agentToggles.codeUxEnabled) {
    return base.map((toggle) => ({ ...toggle, enabled: false }));
  }
  const toggles = Array.isArray(agentToggles)
    ? agentToggles
    : agentToggles?.codeUxToolToggles;
  if (!toggles || toggles.length === 0) return base;
  const overrides = new Map(toggles.map((toggle) => [toggle.name, toggle.enabled]));
  return base.map((toggle) =>
    overrides.has(toggle.name) ? { ...toggle, enabled: overrides.get(toggle.name)! } : toggle,
  );
};
