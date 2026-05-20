import type { ManageCodeUxArgs } from "../contracts/internal-management-types.js";

export interface PendingMcpApproval {
  action: ManageCodeUxArgs;
  approvalMessage: string;
  proposedAt: string;
}

/**
 * Tracks pending approval-required actions from MCP tool calls.
 * Used by the worker gateway to capture approval-gated actions so the
 * dashboard chat service can present them to the user for confirmation.
 */
export class McpApprovalTracker {
  private pending = new Map<string, { approval: PendingMcpApproval, timestamp: number }>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTask();
  }

  private startCleanupTask() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const expirationMs = 5 * 60 * 1000; // 5 minutes
      for (const [id, entry] of this.pending.entries()) {
        if (now - entry.timestamp > expirationMs) {
          this.pending.delete(id);
        }
      }
    }, 60 * 1000);
    this.cleanupInterval.unref?.();
  }

  setPending(correlationId: string, approval: PendingMcpApproval): void {
    this.pending.set(correlationId, { approval, timestamp: Date.now() });
  }

  /** Takes and clears the pending approval for a given correlation ID, if any. */
  takePending(correlationId: string): PendingMcpApproval | null {
    const entry = this.pending.get(correlationId);
    if (entry) {
      this.pending.delete(correlationId);
      const now = Date.now();
      const expirationMs = 5 * 60 * 1000;
      if (now - entry.timestamp > expirationMs) {
        return null;
      }
      return entry.approval;
    }
    return null;
  }

  clear(correlationId: string): void {
    this.pending.delete(correlationId);
  }
}
