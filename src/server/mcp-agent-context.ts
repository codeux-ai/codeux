import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped store carrying internal identity advertised by a worker's code_ux
 * connection. Lets MCP handlers recover the agent and originating dashboard thread
 * without threading either id through the MCP SDK.
 */
interface McpAgentContext {
  agentId: string | null;
  threadId: string | null;
  executionInvocationId: string | null;
}

const storage = new AsyncLocalStorage<McpAgentContext>();

export function runWithMcpAgentContext<T>(agentId: string | null, fn: () => T): T;
export function runWithMcpAgentContext<T>(agentId: string | null, threadId: string | null, fn: () => T): T;
export function runWithMcpAgentContext<T>(
  agentId: string | null,
  threadId: string | null,
  executionInvocationId: string | null,
  fn: () => T,
): T;
export function runWithMcpAgentContext<T>(
  agentId: string | null,
  threadIdOrFn: string | null | (() => T),
  executionInvocationIdOrFn?: string | null | (() => T),
  maybeFn?: () => T,
): T {
  const threadId = typeof threadIdOrFn === "function" ? null : threadIdOrFn;
  const executionInvocationId = typeof executionInvocationIdOrFn === "string"
    ? executionInvocationIdOrFn
    : null;
  const fn = typeof threadIdOrFn === "function"
    ? threadIdOrFn
    : typeof executionInvocationIdOrFn === "function"
      ? executionInvocationIdOrFn
      : maybeFn!;
  return storage.run({ agentId, threadId, executionInvocationId }, fn);
}

export const getCurrentMcpAgentId = (): string | null => storage.getStore()?.agentId ?? null;

/** Returns the originating dashboard thread, or null for standalone MCP requests. */
export const getCurrentMcpThreadId = (): string | null => storage.getStore()?.threadId ?? null;

/** Returns the durable execution invocation that owns the current MCP request. */
export const getCurrentMcpExecutionInvocationId = (): string | null =>
  storage.getStore()?.executionInvocationId ?? null;
