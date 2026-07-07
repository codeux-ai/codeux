import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped store carrying identifiers advertised by a worker's code_ux
 * connection (via X-Code-Ux-* headers). Lets MCP handlers resolve provider
 * run context without threading ids through the MCP SDK.
 */
interface McpAgentContext {
  agentId: string | null;
  invocationId: string | null;
}

const storage = new AsyncLocalStorage<McpAgentContext>();

export const runWithMcpAgentContext = <T>(
  agentId: string | null,
  fn: () => T,
  invocationId: string | null = null,
): T => storage.run({ agentId, invocationId }, fn);

export const getCurrentMcpAgentId = (): string | null => storage.getStore()?.agentId ?? null;

export const getCurrentMcpInvocationId = (): string | null => storage.getStore()?.invocationId ?? null;
