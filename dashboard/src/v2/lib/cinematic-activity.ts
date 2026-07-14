import type { ChatThread, ExecutionInvocationRecord } from "../types.js";
import {
  STAGE_ACTIVITY_MESSAGE_MIN_INTERVAL_MS,
  selectAgentHumorMessage,
  type AgentHumorCategory,
} from "./agent-humor-messages.js";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateChatMessage } from "../i18n/messages/chat.js";

export type CinematicActivityPhase =
  | "container_startup"
  | "provider_work"
  | "planning"
  | "qa_handoff"
  | "completion"
  | "error";

type CinematicActivityInvocation = Pick<
  ExecutionInvocationRecord,
  | "agentPresetId"
  | "id"
  | "messageCount"
  | "provider"
  | "providerInvocationId"
  | "startedAt"
  | "status"
  | "type"
>;

type CinematicActivityThread = Pick<ChatThread, "id" | "runtimeState">;

export interface CinematicActivityCue {
  id: string;
  label: string;
  phase: CinematicActivityPhase;
  providerLabel: string | null;
  quote: string;
  tone: "active" | "complete" | "error";
}

export interface CinematicActivityDisplayState {
  projectManagerActive: boolean;
  foregroundCue: CinematicActivityCue | null;
  backgroundActivityCount: number;
  backgroundCue: CinematicActivityCue | null;
}

export interface ResolveCinematicActivityOptions {
  agentId: string | null | undefined;
  error: string | null;
  hasAwaitedReply: boolean;
  invocations: readonly CinematicActivityInvocation[];
  nowMs: number;
  projectManagerAgentPresetId: string | null | undefined;
  selectedThread: CinematicActivityThread | null;
  locale?: DashboardLocale;
}

const PHASE_CATEGORY: Record<CinematicActivityPhase, AgentHumorCategory> = {
  container_startup: "starting",
  provider_work: "working",
  planning: "planning",
  qa_handoff: "qa_handoff",
  completion: "completion",
  error: "error",
};

const PHASE_LABEL: Record<CinematicActivityPhase, string> = {
  container_startup: "Container starting",
  provider_work: "Provider running",
  planning: "Planning in progress",
  qa_handoff: "QA review in progress",
  completion: "Runtime step completed",
  error: "Runtime needs attention",
};

const PHASE_MESSAGE_KEY: Record<CinematicActivityPhase, Parameters<typeof translateChatMessage>[1]> = {
  container_startup: "phaseContainerStartup",
  provider_work: "phaseProviderWork",
  planning: "phasePlanning",
  qa_handoff: "phaseQaHandoff",
  completion: "phaseCompletion",
  error: "phaseError",
};

const isQaInvocation = (type: string): boolean => /(^|_)(qa|quality)(_|$)|review/.test(type.toLowerCase());
const isPlanningInvocation = (type: string): boolean => /plan/.test(type.toLowerCase());

/** Classifies only facts persisted on one invocation; it does not infer task progress. */
export const classifyCinematicActivityPhase = (
  invocation: CinematicActivityInvocation,
): CinematicActivityPhase | null => {
  if (invocation.status === "failed") return "error";
  if (invocation.status === "completed") return "completion";
  if (invocation.status !== "running") return null;
  if (!invocation.providerInvocationId || invocation.messageCount === 0) return "container_startup";
  if (isQaInvocation(invocation.type)) return "qa_handoff";
  if (isPlanningInvocation(invocation.type)) return "planning";
  return "provider_work";
};

const isProjectManagerReply = (
  invocation: CinematicActivityInvocation,
  projectManagerAgentPresetId: string | null | undefined,
): boolean => Boolean(
  projectManagerAgentPresetId
    && invocation.agentPresetId === projectManagerAgentPresetId
    && (invocation.type === "dashboard_reply" || invocation.type === "worker_reply"),
);

const latestInvocation = (
  invocations: readonly CinematicActivityInvocation[],
): CinematicActivityInvocation | null => (
  [...invocations].sort((left, right) => (
    right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id)
  ))[0] ?? null
);

const normalizeProviderLabel = (provider: string | null | undefined): string | null => {
  const normalized = provider?.trim();
  if (!normalized) return null;
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const buildCue = (options: {
  agentId: string | null | undefined;
  humorCategory?: AgentHumorCategory;
  id: string;
  nowMs: number;
  phase: CinematicActivityPhase;
  provider: string | null | undefined;
  locale?: DashboardLocale;
}): CinematicActivityCue => {
  const providerLabel = normalizeProviderLabel(options.provider);
  return {
    id: options.id,
    label: options.locale
      ? translateChatMessage(options.locale, PHASE_MESSAGE_KEY[options.phase])
      : PHASE_LABEL[options.phase],
    phase: options.phase,
    providerLabel,
    quote: selectAgentHumorMessage({
      category: options.humorCategory ?? PHASE_CATEGORY[options.phase],
      cycleDurationMs: STAGE_ACTIVITY_MESSAGE_MIN_INTERVAL_MS,
      seed: [options.agentId ?? "unassigned", options.provider ?? "local", options.phase, options.id].join("|"),
      nowMs: options.nowMs,
      locale: options.locale,
    }),
    tone: options.phase === "error" ? "error" : options.phase === "completion" ? "complete" : "active",
  };
};

const resolveThreadPhase = (
  thread: CinematicActivityThread | null,
  hasAwaitedReply: boolean,
): CinematicActivityPhase | null => {
  const continuationStatus = thread?.runtimeState?.continuationStatus?.toLowerCase() ?? "";
  if (/fail|error/.test(continuationStatus)) return "error";
  if (/complete|done/.test(continuationStatus)) return "completion";
  if (/plan/.test(continuationStatus)) return "planning";
  if (!hasAwaitedReply) return null;
  return thread?.runtimeState?.sessionIds?.length || thread?.runtimeState?.providerLabel || thread?.runtimeState?.virtualProvider
    ? "provider_work"
    : "container_startup";
};

/**
 * Resolves foreground Project Manager work independently from project-wide
 * background activity. Only a matching reply invocation or awaited selected
 * thread may make the Project Manager active.
 */
export const resolveCinematicActivityDisplayState = (
  options: ResolveCinematicActivityOptions,
): CinematicActivityDisplayState => {
  const runningInvocations = options.invocations.filter((invocation) => invocation.status === "running");
  const projectManagerInvocation = latestInvocation(runningInvocations.filter((invocation) => (
    isProjectManagerReply(invocation, options.projectManagerAgentPresetId)
  )));
  const backgroundInvocations = runningInvocations.filter((invocation) => (
    !isProjectManagerReply(invocation, options.projectManagerAgentPresetId)
  ));
  const backgroundInvocation = latestInvocation(backgroundInvocations);
  const projectManagerActive = options.hasAwaitedReply || Boolean(projectManagerInvocation);

  let foregroundCue: CinematicActivityCue | null = null;
  if (options.error) {
    foregroundCue = buildCue({
      agentId: options.agentId,
      id: `error:${options.selectedThread?.id ?? "stage"}`,
      nowMs: options.nowMs,
      phase: "error",
      provider: options.selectedThread?.runtimeState?.providerLabel ?? options.selectedThread?.runtimeState?.virtualProvider,
      locale: options.locale,
    });
  } else if (projectManagerInvocation) {
    const phase = classifyCinematicActivityPhase(projectManagerInvocation);
    if (phase) {
      foregroundCue = buildCue({
        agentId: options.agentId,
        id: projectManagerInvocation.id,
        nowMs: options.nowMs,
        phase,
        provider: projectManagerInvocation.provider,
        locale: options.locale,
      });
    }
  } else if (projectManagerActive) {
    const phase = resolveThreadPhase(options.selectedThread, options.hasAwaitedReply);
    if (phase) {
      foregroundCue = buildCue({
        agentId: options.agentId,
        id: options.selectedThread?.id ?? "selected-thread",
        nowMs: options.nowMs,
        phase,
        provider: options.selectedThread?.runtimeState?.providerLabel ?? options.selectedThread?.runtimeState?.virtualProvider,
        locale: options.locale,
      });
    }
  }

  const backgroundPhase = backgroundInvocation
    ? classifyCinematicActivityPhase(backgroundInvocation)
    : null;
  const backgroundCue = backgroundInvocation && backgroundPhase
    ? buildCue({
      agentId: backgroundInvocation.agentPresetId,
      humorCategory: backgroundPhase === "error" || backgroundPhase === "completion"
        ? PHASE_CATEGORY[backgroundPhase]
        : "delegating",
      id: backgroundInvocation.id,
      nowMs: options.nowMs,
      phase: backgroundPhase,
      provider: backgroundInvocation.provider,
      locale: options.locale,
    })
    : null;

  return {
    projectManagerActive,
    foregroundCue,
    backgroundActivityCount: backgroundInvocations.length,
    backgroundCue,
  };
};
