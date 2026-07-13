import type {
  ExecutionInvocationRecord,
  ExecutionInvocationStatus,
} from "../../contracts/invocation-types.js";
import {
  PLANNING_INVOCATION_SAMPLE_LIMIT,
  selectRecentPlanningInvocationDurations,
} from "./invocation-metrics.js";
import { PlanningEtaEstimator } from "../sprint/composer/eta-estimator.js";

export type McpPlanningGuidanceStatus =
  | "in_progress"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused";

export interface McpPlanningGuidance {
  status: McpPlanningGuidanceStatus;
  asynchronous: true;
  isTerminal: boolean;
  invocationId: string;
  startedAt: string;
  estimatedDurationMs: number;
  estimatedCompletionAt: string;
  nextCheckAt: string | null;
  recheckIntervalMs: number;
  sampleSize: number;
  isFallbackEstimate: boolean;
  message: string;
  errorMessage?: string;
}

type GuidanceInvocation = Pick<
  ExecutionInvocationRecord,
  "id" | "startedAt" | "status" | "errorMessage" | "lastErrorMessage"
>;

export interface InitialMcpPlanningGuidanceInput {
  invocation: Pick<GuidanceInvocation, "id" | "startedAt">;
  projectInvocations: readonly ExecutionInvocationRecord[];
  currentTime: Date;
}

export interface SubsequentMcpPlanningGuidanceInput {
  invocation: GuidanceInvocation;
  projectInvocations: readonly ExecutionInvocationRecord[];
  currentTime: Date;
}

export const MCP_PLANNING_RECHECK_INTERVAL_MS = 60_000;

const estimator = new PlanningEtaEstimator();

function mapInvocationStatus(status: ExecutionInvocationStatus): McpPlanningGuidanceStatus {
  switch (status) {
    case "running":
      return "in_progress";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "paused":
      return "paused";
  }
}

function buildEstimate(
  projectInvocations: readonly ExecutionInvocationRecord[],
  startedAt: string
): Pick<
  McpPlanningGuidance,
  "estimatedDurationMs" | "estimatedCompletionAt" | "sampleSize" | "isFallbackEstimate"
> {
  const durationsMs = selectRecentPlanningInvocationDurations(
    projectInvocations,
    PLANNING_INVOCATION_SAMPLE_LIMIT
  );
  const estimate = estimator.estimate(durationsMs);

  return {
    estimatedDurationMs: estimate.estimatedMs,
    estimatedCompletionAt: new Date(Date.parse(startedAt) + estimate.estimatedMs).toISOString(),
    sampleSize: estimate.sampleSize,
    isFallbackEstimate: estimate.isFallback,
  };
}

function buildInProgressMessage(nextCheckAt: string): string {
  return "Planning is running asynchronously. Exceeding the estimated completion time is not evidence of failure. "
    + "Do not requeue, resubmit, or change settings while this invocation remains in progress. "
    + `Check the same invocation again at ${nextCheckAt}.`;
}

function buildTerminalMessage(
  status: Exclude<McpPlanningGuidanceStatus, "in_progress">,
  errorMessage: string | undefined
): string {
  const detail = errorMessage ? ` Details: ${errorMessage}` : "";
  switch (status) {
    case "succeeded":
      return "Planning completed successfully.";
    case "failed":
      return `Planning failed.${detail}`;
    case "cancelled":
      return `Planning was cancelled.${detail}`;
    case "paused":
      return `Planning is paused.${detail}`;
  }
}

/** Builds guidance returned immediately after asynchronous planning starts. */
export function buildInitialMcpPlanningGuidance(
  input: InitialMcpPlanningGuidanceInput
): McpPlanningGuidance {
  const estimate = buildEstimate(input.projectInvocations, input.invocation.startedAt);
  const nextCheckAt = estimate.estimatedCompletionAt;

  return {
    status: "in_progress",
    asynchronous: true,
    isTerminal: false,
    invocationId: input.invocation.id,
    startedAt: input.invocation.startedAt,
    ...estimate,
    nextCheckAt,
    recheckIntervalMs: MCP_PLANNING_RECHECK_INTERVAL_MS,
    message: buildInProgressMessage(nextCheckAt),
  };
}

/** Builds guidance after checking the persisted invocation status. */
export function buildSubsequentMcpPlanningGuidance(
  input: SubsequentMcpPlanningGuidanceInput
): McpPlanningGuidance {
  const status = mapInvocationStatus(input.invocation.status);
  const estimate = buildEstimate(input.projectInvocations, input.invocation.startedAt);

  if (status === "in_progress") {
    const nextCheckAt = new Date(
      input.currentTime.getTime() + MCP_PLANNING_RECHECK_INTERVAL_MS
    ).toISOString();

    return {
      status,
      asynchronous: true,
      isTerminal: false,
      invocationId: input.invocation.id,
      startedAt: input.invocation.startedAt,
      ...estimate,
      nextCheckAt,
      recheckIntervalMs: MCP_PLANNING_RECHECK_INTERVAL_MS,
      message: buildInProgressMessage(nextCheckAt),
    };
  }

  const errorMessage = status === "succeeded"
    ? undefined
    : input.invocation.errorMessage ?? input.invocation.lastErrorMessage ?? undefined;

  return {
    status,
    asynchronous: true,
    isTerminal: true,
    invocationId: input.invocation.id,
    startedAt: input.invocation.startedAt,
    ...estimate,
    nextCheckAt: null,
    recheckIntervalMs: MCP_PLANNING_RECHECK_INTERVAL_MS,
    message: buildTerminalMessage(status, errorMessage),
    ...(errorMessage ? { errorMessage } : {}),
  };
}
