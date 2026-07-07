import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped store carrying the agent preset id advertised by a worker's code_ux
 * connection (via the X-Code-Ux-Agent header). Lets the MCP request router enforce
 * per-agent code_ux tool toggles without threading the id through the MCP SDK.
 */
const storage = new AsyncLocalStorage<string | null>();

export const runWithMcpAgentContext = <T>(agentId: string | null, fn: () => T): T =>
  storage.run(agentId, fn);

export const getCurrentMcpAgentId = (): string | null => storage.getStore() ?? null;
