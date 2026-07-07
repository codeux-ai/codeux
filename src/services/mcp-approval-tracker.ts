import type { ManageCodeUxArgs } from "../contracts/internal-management-types.js";
import { buildMcpApprovalFingerprint } from "../mcp/management/payload-parsers.js";

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
  private pending = new Map<string, Map<string, { approval: PendingMcpApproval, timestamp: number }>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTask();
  }

  private startCleanupTask() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const expirationMs = 5 * 60 * 1000; // 5 minutes
      for (const [correlationId, approvalsByFingerprint] of this.pending.entries()) {
        for (const [fingerprint, entry] of approvalsByFingerprint.entries()) {
          if (now - entry.timestamp > expirationMs) {
            approvalsByFingerprint.delete(fingerprint);
          }
        }
        if (approvalsByFingerprint.size === 0) {
          this.pending.delete(correlationId);
        }
      }
    }, 60 * 1000);
    this.cleanupInterval.unref?.();
  }

  setPending(correlationId: string, approval: PendingMcpApproval): void {
    if (!this.isValidCorrelationId(correlationId)) {
      return;
    }
    const normalizedCorrelationId = correlationId.trim();
    const fingerprint = buildMcpApprovalFingerprint(approval.action);
    const approvalsByFingerprint = this.pending.get(normalizedCorrelationId) ?? new Map<string, { approval: PendingMcpApproval, timestamp: number }>();
    approvalsByFingerprint.set(fingerprint, { approval, timestamp: Date.now() });
    this.pending.set(normalizedCorrelationId, approvalsByFingerprint);
  }

  /** Takes and clears the pending approval for a given correlation ID and action fingerprint, if any. */
  takePending(correlationId: string, confirmedAction?: ManageCodeUxArgs): PendingMcpApproval | null {
    if (!this.isValidCorrelationId(correlationId)) {
      return null;
    }
    const normalizedCorrelationId = correlationId.trim();
    const approvalsByFingerprint = this.pending.get(normalizedCorrelationId);
    if (!approvalsByFingerprint) {
      return null;
    }
    const fingerprint = confirmedAction ? buildMcpApprovalFingerprint(confirmedAction) : this.resolveSinglePendingFingerprint(approvalsByFingerprint);
    if (!fingerprint) {
      return null;
    }

    const entry = approvalsByFingerprint.get(fingerprint);
    if (!entry) {
      return null;
    }

    approvalsByFingerprint.delete(fingerprint);
    if (approvalsByFingerprint.size === 0) {
      this.pending.delete(normalizedCorrelationId);
    }

    const now = Date.now();
    const expirationMs = 5 * 60 * 1000;
    if (now - entry.timestamp > expirationMs) {
      return null;
    }
    return entry.approval;
  }

  clear(correlationId: string): void {
    if (!this.isValidCorrelationId(correlationId)) {
      return;
    }
    this.pending.delete(correlationId.trim());
  }

  private isValidCorrelationId(correlationId: unknown): correlationId is string {
    if (typeof correlationId !== "string") {
      return false;
    }
    const trimmed = correlationId.trim();
    return APPROVAL_CORRELATION_ID_PATTERN.test(trimmed) && !TOKEN_SHAPED_CORRELATION_ID_PATTERN.test(trimmed);
  }

  private resolveSinglePendingFingerprint(approvalsByFingerprint: Map<string, { approval: PendingMcpApproval, timestamp: number }>): string | null {
    const now = Date.now();
    const expirationMs = 5 * 60 * 1000;
    for (const [fingerprint, entry] of approvalsByFingerprint.entries()) {
      if (now - entry.timestamp > expirationMs) {
        approvalsByFingerprint.delete(fingerprint);
      }
    }
    if (approvalsByFingerprint.size !== 1) {
      return null;
    }
    return approvalsByFingerprint.keys().next().value ?? null;
  }
}
