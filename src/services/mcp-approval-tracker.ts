import type { ManageSprintOsArgs } from "../contracts/internal-management-types.js";

export interface PendingMcpApproval {
  action: ManageSprintOsArgs;
  approvalMessage: string;
  proposedAt: string;
}

/**
 * Tracks pending approval-required actions from MCP tool calls.
 * Used by the worker gateway to capture approval-gated actions so the
 * dashboard chat service can present them to the user for confirmation.
 */
export class McpApprovalTracker {
  private latest: PendingMcpApproval | null = null;

  setPending(approval: PendingMcpApproval): void {
    this.latest = approval;
  }

  /** Takes and clears the most recent pending approval, if any. */
  takePending(): PendingMcpApproval | null {
    const entry = this.latest;
    this.latest = null;
    return entry;
  }
}
