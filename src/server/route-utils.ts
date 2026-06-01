import type { Request, Response, RequestHandler } from "express";
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

function parsePlanningOverrides(value: unknown): PlanningOverrides | undefined {
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

export function toErrorResponse(error: unknown, prefix?: string): { error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (prefix) {
    return { error: `${prefix}: ${message}` };
  }
  return { error: message };
}

export function syncRoute(handler: (req: Request, res: Response) => void): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(400).json(toErrorResponse(error));
      } else {
        next(error);
      }
    }
  };
}

export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(400).json(toErrorResponse(error));
      } else {
        next(error);
      }
    }
  };
}
