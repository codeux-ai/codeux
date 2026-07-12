export type NodeFlowVersionSelection =
  | { mode: "latest_published" }
  | { mode: "pinned"; version: number };

export type NodeFlowFailureClassification =
  | "cancelled"
  | "timeout"
  | "quota"
  | "validation"
  | "credential"
  | "transient"
  | "permanent"
  | "unknown_side_effect";

export interface NodeFlowRetryPolicySnapshot {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  retryableClasses: NodeFlowFailureClassification[];
}

export interface NodeFlowExecutionPolicySnapshot {
  maxConcurrentRuns: number;
  maxConcurrentRunsPerProject: number;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  defaultTimeoutMs: number;
  retry: NodeFlowRetryPolicySnapshot;
}

export const DEFAULT_NODE_FLOW_EXECUTION_POLICY: Readonly<NodeFlowExecutionPolicySnapshot> = Object.freeze({
  maxConcurrentRuns: 4,
  maxConcurrentRunsPerProject: 2,
  leaseDurationMs: 30_000,
  heartbeatIntervalMs: 10_000,
  defaultTimeoutMs: 60_000,
  retry: Object.freeze({
    maxAttempts: 1,
    backoffMs: 500,
    maxBackoffMs: 30_000,
    jitterRatio: 0.2,
    retryableClasses: Object.freeze(["timeout", "quota", "transient"]) as NodeFlowFailureClassification[],
  }),
});
