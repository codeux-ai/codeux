import type { AgentConnection, ChatThread, ExecutionInvocationRecord } from "../types.js";

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
