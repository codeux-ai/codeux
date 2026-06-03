import type { ChatMessageRecord, ExecutionInvocationMessageRecord } from "../types.js";
import type { ConversationRuntimeState } from "../types.js";
import type { ExecutionStatus } from "../components/chat/widgets/ChatWidgetFrame.js";

export type ChatWidgetType = "planning" | "none";

/** Per-turn token usage carried on tool-call invocation messages. */
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
}

export interface WorkingBubbleState {
  isPlanning: boolean;
  planName?: string;
  providerLabel?: string;
  modelLabel?: string;
}

const BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN =
  /^fatal:\s+your current branch 'code-ux-bootstrap-[^']+' does not have any commits yet\s*$/i;

export const sanitizeInvocationOutputText = (value: string): string => {
  if (!value) {
    return value;
  }

  return value
    .split("\n")
    .filter((line) => !BOOTSTRAP_BRANCH_FATAL_LINE_PATTERN.test(line.trim()))
    .join("\n");
};

const extractWidgetStateFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  bodyMarkdown?: string
): ChatWidgetState => {
  if (!metadata) {
    return { type: "none", status: "completed", planName: "" };
  }

  const widgetMetadata = metadata.widget_metadata as Record<string, unknown> | undefined;

  if (widgetMetadata && widgetMetadata.type === "planning_request") {
    const status = (widgetMetadata.status as ExecutionStatus) || (metadata.status as ExecutionStatus) || "completed";
    const planName = (widgetMetadata.route_path as string) || (metadata.planName as string) || (metadata.title as string) || "Execution Plan";
    const targetWorker = widgetMetadata.target_worker as string | undefined;
    return {
      type: "planning",
      status,
      planName,
      targetWorker,
    };
  }

  const isPlanning = metadata.type === "planning" || metadata.routeKind === "planning" ||
    (typeof bodyMarkdown === "string" && bodyMarkdown.toLowerCase().includes("planning"));

  if (isPlanning || metadata.routeKind === "virtual" || metadata.routeKind === "worker") {
    const status = (metadata.status as ExecutionStatus) || "completed";
    const planName = (metadata.planName as string) || (metadata.title as string) || "Execution Plan";
    return {
      type: "planning",
      status,
      planName,
    };
  }

  return { type: "none", status: "completed", planName: "" };
};

export const getChatWidgetData = (message: ChatMessageRecord): ChatWidgetState => {
  return extractWidgetStateFromMetadata(message.metadata, message.bodyMarkdown);
};

export const getInvocationWidgetData = (message: ExecutionInvocationMessageRecord): ChatWidgetState => {
  return extractWidgetStateFromMetadata(message.metadata, message.contentMarkdown);
};

const metaKind = (message: ExecutionInvocationMessageRecord): string | undefined =>
  typeof message.metadata?.kind === "string" ? message.metadata.kind : undefined;

const metaCallId = (message: ExecutionInvocationMessageRecord): string | undefined =>
  typeof message.metadata?.toolCallId === "string" ? message.metadata.toolCallId : undefined;

/**
 * Collapses a `tool_call` message and its matching `tool_result` into a
 * single invocation message so the transcript can render one tool card with
 * both the input and output attached.
 */
export const mergeInvocationToolMessages = (
  messages: ExecutionInvocationMessageRecord[],
): ExecutionInvocationMessageRecord[] => {
  const consumed = new Set<string>();
  const merged: ExecutionInvocationMessageRecord[] = [];

  for (let i = 0; i < messages.length; i += 1) {
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

export function formatProviderInstanceLabel(
  provider: string | null | undefined,
  model: string | null | undefined,
): string {
  if (!provider) return "";
  if (model) {
    return `${provider} ${model}`;
  }
  return provider;
}

export function formatStatusContext(
  provider: string | null | undefined,
  model: string | null | undefined,
  status: string | null | undefined,
): string {
  const parts: string[] = [];
  if (provider) parts.push(provider);
  if (model) parts.push(model);
  if (status) parts.push(status);
  return parts.join(" ");
}

export function formatTokenCount(tokens: number | null | undefined): string {
  if (tokens === undefined || tokens === null) return "0";
  return tokens.toLocaleString();
}

export function shortenIdentifier(id: string | null | undefined): string {
  if (!id) return "";
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}
