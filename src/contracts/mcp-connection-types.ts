export interface McpConnectionInfo {
  url: string;
  authToken: string | null;
  /**
   * Agent preset id advertised to the code_ux gateway (via the X-Code-Ux-Agent header)
   * so per-agent code_ux tool toggles can be enforced for this run.
   */
  agentId?: string;
}
