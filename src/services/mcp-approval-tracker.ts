import type { ManageCodeUxArgs } from "../contracts/internal-management-types.js";

export interface PendingMcpApproval {
  action: ManageCodeUxArgs;
  approvalMessage: string;
  proposedAt: string;
}

const APPROVAL_CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOKEN_SHAPED_CORRELATION_ID_PATTERN = /^(?:gh[pousr]_|github_pat_|glpat-|sk-|sess-|ATATT3xFfGF0)/;

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
    if (!this.isValidCorrelationId(correlationId)) {
      return;
    }
    this.pending.set(correlationId, { approval, timestamp: Date.now() });
  }

  /** Takes and clears the pending approval for a given correlation ID, if any. */
  takePending(correlationId: string): PendingMcpApproval | null {
    if (!this.isValidCorrelationId(correlationId)) {
      return null;
    }
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
    if (!this.isValidCorrelationId(correlationId)) {
      return;
    }
    this.pending.delete(correlationId);
  }

  private isValidCorrelationId(correlationId: unknown): correlationId is string {
    if (typeof correlationId !== "string") {
      return false;
    }
    const trimmed = correlationId.trim();
    return APPROVAL_CORRELATION_ID_PATTERN.test(trimmed) && !TOKEN_SHAPED_CORRELATION_ID_PATTERN.test(trimmed);
  }
}
