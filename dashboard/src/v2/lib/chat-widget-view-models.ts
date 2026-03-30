import type { ChatMessageRecord, ExecutionInvocationMessageRecord } from "../types.js";
import type { ConversationRuntimeState } from "../types.js";
import type { ExecutionStatus } from "../components/chat/widgets/ChatWidgetFrame.js";

export type ChatWidgetType = "planning" | "none";

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