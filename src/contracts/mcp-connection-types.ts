export interface McpConnectionInfo {
  url: string;
  authToken: string | null;
  /**
   * Agent preset id advertised to the code_ux gateway (via the X-Code-Ux-Agent header)
   * so per-agent code_ux tool toggles can be enforced for this run.
   */
  agentId?: string;
  /**
   * Durable execution invocation advertised via X-Code-Ux-Invocation. The
   * gateway uses it to authorize the exact coding run even when the selected
   * agent is a fallback that is not statically assigned to the task.
   */
  executionInvocationId?: string;
  /**
   * Dashboard chat thread id advertised only for the active reply turn (via the
   * X-Code-Ux-Thread header) so MCP handlers can recover the originating thread.
   */
  threadId?: string;
}
