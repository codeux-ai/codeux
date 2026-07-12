import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped store carrying internal identity advertised by a worker's code_ux
 * connection. Lets MCP handlers recover the agent and originating dashboard thread
 * without threading either id through the MCP SDK.
 */
interface McpAgentContext {
  agentId: string | null;
  threadId: string | null;
}

const storage = new AsyncLocalStorage<McpAgentContext>();

export function runWithMcpAgentContext<T>(agentId: string | null, fn: () => T): T;
export function runWithMcpAgentContext<T>(agentId: string | null, threadId: string | null, fn: () => T): T;
export function runWithMcpAgentContext<T>(
  agentId: string | null,
  threadIdOrFn: string | null | (() => T),
  maybeFn?: () => T,
): T {
  const threadId = typeof threadIdOrFn === "function" ? null : threadIdOrFn;
  const fn = typeof threadIdOrFn === "function" ? threadIdOrFn : maybeFn!;
  return storage.run({ agentId, threadId }, fn);
}

export const getCurrentMcpAgentId = (): string | null => storage.getStore()?.agentId ?? null;

export const getCurrentMcpThreadId = (): string | null => storage.getStore()?.threadId ?? null;
