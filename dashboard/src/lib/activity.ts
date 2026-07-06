import type { JulesActivity } from "../types.js";
import type { ExecutionInvocationRecord, ExecutionRuntimeEventSummary } from "../types.js";

export type ContainerBuildProgressKind =
  | "cache_miss"
  | "lock_wait"
  | "build_start"
  | "build_step"
  | "build_success"
  | "build_failure_fallback";

export interface ContainerBuildProgress {
  kind: ContainerBuildProgressKind;
  imageTag: string;
  baseImage: string;
  message: string;
  progressPercent?: number;
  stepText?: string;
  rawLine?: string;
  imageRole?: string;
}

const CONTAINER_BUILD_PROGRESS_KINDS: Set<string> = new Set([
  "cache_miss",
  "lock_wait",
  "build_start",
  "build_step",
  "build_success",
  "build_failure_fallback",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const asString = (value: unknown): string | null => (
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null
);

const asPercent = (value: unknown): number | undefined => (
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : undefined
);

export const getContainerBuildProgress = (value: unknown): ContainerBuildProgress | null => {
  if (!isRecord(value)) return null;

  const kind = asString(value.kind);
  const imageTag = asString(value.imageTag);
  const baseImage = asString(value.baseImage);
  const message = asString(value.message);
  if (!kind || !CONTAINER_BUILD_PROGRESS_KINDS.has(kind) || !imageTag || !baseImage || !message) {
    return null;
  }

  return {
    kind: kind as ContainerBuildProgressKind,
    imageTag,
    baseImage,
    message,
    progressPercent: asPercent(value.progressPercent),
    stepText: asString(value.stepText) ?? undefined,
    rawLine: asString(value.rawLine) ?? undefined,
    imageRole: asString(value.imageRole) ?? undefined,
  };
};

export const getActivityContainerBuildProgress = (activity?: JulesActivity): ContainerBuildProgress | null => {
  if (!activity) return null;
  return getContainerBuildProgress(activity.containerBuildProgress)
    ?? getContainerBuildProgress(activity.setupImageProgress)
    ?? getContainerBuildProgress(activity.loginImageBuildProgress)
    ?? getContainerBuildProgress(activity.buildProgress)
    ?? getContainerBuildProgress((activity.progressUpdated as Record<string, unknown> | undefined)?.containerBuildProgress);
};

export const findLatestContainerBuildProgressFromEvents = (
  events: ExecutionRuntimeEventSummary[] | undefined,
): ContainerBuildProgress | null => {
  for (const event of events ?? []) {
    const payload = event.payload;
    const progress = getContainerBuildProgress(payload)
      ?? getContainerBuildProgress(payload?.containerBuildProgress)
      ?? getContainerBuildProgress(payload?.setupImageProgress)
      ?? getContainerBuildProgress(payload?.loginImageBuildProgress)
      ?? getContainerBuildProgress(payload?.buildProgress);
    if (progress) return progress;
  }
  return null;
};

export const getInvocationContainerBuildProgress = (
  invocation: ExecutionInvocationRecord,
): ContainerBuildProgress | null => {
  const metadata = (invocation as ExecutionInvocationRecord & { metadata?: Record<string, unknown> | null }).metadata;
  return getContainerBuildProgress(metadata)
    ?? getContainerBuildProgress(metadata?.containerBuildProgress)
    ?? getContainerBuildProgress(metadata?.setupImageProgress)
    ?? getContainerBuildProgress(metadata?.loginImageBuildProgress)
    ?? getContainerBuildProgress(metadata?.buildProgress);
};

export const findLatestContainerBuildProgressFromInvocations = (
  invocations: ExecutionInvocationRecord[] | undefined,
): ContainerBuildProgress | null => {
  for (const invocation of invocations ?? []) {
    const progress = getInvocationContainerBuildProgress(invocation);
    if (progress) return progress;
  }
  return null;
};

export const getActivityText = (activity?: JulesActivity): string => {
  if (!activity) return "System activity...";
  const buildProgress = getActivityContainerBuildProgress(activity);
  if (buildProgress) return buildProgress.message;
  if (activity.agentMessaged?.agentMessage) return activity.agentMessaged.agentMessage;
  if (activity.userMessaged?.userMessage) return activity.userMessaged.userMessage;
  if (activity.progressUpdated?.title || activity.progressUpdated?.description) {
    return activity.progressUpdated.title || activity.progressUpdated.description || "System activity...";
  }
  if (activity.planGenerated?.plan?.steps?.length) {
    const firstStep = activity.planGenerated.plan.steps[0];
    return firstStep?.title ? `Plan generated: ${firstStep.title}` : "Plan generated";
  }
  if (activity.planApproved?.planId) return `Plan approved (${activity.planApproved.planId})`;
  if (activity.sessionFailed?.reason) return `Session failed: ${activity.sessionFailed.reason}`;
  if (activity.sessionCompleted) return "Session completed";
  if (activity.description) return activity.description;
  return "System activity...";
};
