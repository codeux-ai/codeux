import type { AgentConnection, ChatThread, ExecutionInvocationRecord } from "../types.js";
import type { WorkerOption } from "./project-worker-options.js";

export function buildThreadIndex(threads: ChatThread[]): Map<string, ChatThread> {
  const map = new Map<string, ChatThread>();
  for (const thread of threads) {
    map.set(thread.id, thread);
  }
  return map;
}

export function buildInvocationIndex(invocations: ExecutionInvocationRecord[]): Map<string, ExecutionInvocationRecord> {
  const map = new Map<string, ExecutionInvocationRecord>();
  for (const inv of invocations) {
    map.set(inv.id, inv);
  }
  return map;
}

export function buildConnectionIndex(connections: AgentConnection[]): Map<string, AgentConnection> {
  const map = new Map<string, AgentConnection>();
  for (const conn of connections) {
    map.set(conn.id, conn);
  }
  return map;
}

export function buildWorkerOptionIndex(workerOptions: WorkerOption[]): {
  byId: Map<string, WorkerOption>;
  byProvider: Map<string, WorkerOption>;
  byEndpoint: Map<string, WorkerOption>;
  byConnection: Map<string, WorkerOption>;
  primary: WorkerOption | null;
} {
  const byId = new Map<string, WorkerOption>();
  const byProvider = new Map<string, WorkerOption>();
  const byEndpoint = new Map<string, WorkerOption>();
  const byConnection = new Map<string, WorkerOption>();
  let primary: WorkerOption | null = null;

  for (const option of workerOptions) {
    byId.set(option.id, option);

    if (option.isPrimary && !primary) {
      primary = option;
    }

    if (option.type === "virtual" && option.providerId) {
      byProvider.set(option.providerId, option);
    } else if (option.type === "endpoint" && option.workerEndpointId) {
      byEndpoint.set(option.workerEndpointId, option);
    } else if (option.type === "connection" && option.connectionId) {
      byConnection.set(option.connectionId, option);
    }
  }

  return { byId, byProvider, byEndpoint, byConnection, primary };
}
