import { ValidationError } from "../../repositories/repository-utils.js";
import { AutomationApprovalRepository, type AutomationApprovalRecord } from "../../repositories/automation-approval-repository.js";
import type { NodeFlowJsonObject } from "../../contracts/node-flow-types.js";
import type { AutomationAuditExportService } from "../automation-audit-export-service.js";

export class ApprovalRequiredError extends Error {
  constructor(public readonly approval: AutomationApprovalRecord) {
    super(`Approval is required: ${approval.id}`);
    this.name = "ApprovalRequiredError";
  }
}

export class ApprovalService {
  constructor(private readonly repository: AutomationApprovalRepository, private readonly auditService?: AutomationAuditExportService) {}

  requireApproval(input: {
    projectId: string; flowId: string; runId: string; nodeId: string;
    logicalItem?: string; request: NodeFlowJsonObject; expiresAt?: string | null;
  }): AutomationApprovalRecord {
    const logicalItem = input.logicalItem?.trim() || "default";
    this.repository.expireDue();
    const existing = this.repository.getForItem(input.runId, input.nodeId, logicalItem);
    const requested = existing
      ? { approval: existing, changed: false }
      : this.repository.requestIdempotently({ ...input, logicalItem });
    const approval = requested.approval;
    if (approval.status === "approved") return approval;
    if (requested.changed) this.auditService?.recordSystem({ action: "approval.requested", resourceType: "automation_approval", resourceId: approval.id, projectId: approval.projectId, outcome: "succeeded", metadata: { flowId: approval.flowId, runId: approval.runId, nodeId: approval.nodeId, logicalItem: approval.logicalItem } });
    if (approval.status === "rejected" || approval.status === "expired") {
      throw new ValidationError(`Approval ${approval.id} is ${approval.status}.`);
    }
    throw new ApprovalRequiredError(approval);
  }

  approve(id: string, decidedBy: string, decision: NodeFlowJsonObject = {}): AutomationApprovalRecord {
    this.repository.expireDue();
    const result = this.repository.decideIdempotently(id, { status: "approved", decidedBy, decision });
    const approval = result.approval;
    if (result.changed) this.auditService?.recordSystem({ action: "approval.approved", resourceType: "automation_approval", resourceId: approval.id, projectId: approval.projectId, outcome: "succeeded", principalId: decidedBy, metadata: { flowId: approval.flowId, runId: approval.runId, nodeId: approval.nodeId } });
    return approval;
  }
  reject(id: string, decidedBy: string, decision: NodeFlowJsonObject = {}): AutomationApprovalRecord {
    this.repository.expireDue();
    const result = this.repository.decideIdempotently(id, { status: "rejected", decidedBy, decision });
    const approval = result.approval;
    if (result.changed) this.auditService?.recordSystem({ action: "approval.rejected", resourceType: "automation_approval", resourceId: approval.id, projectId: approval.projectId, outcome: "succeeded", principalId: decidedBy, metadata: { flowId: approval.flowId, runId: approval.runId, nodeId: approval.nodeId } });
    return approval;
  }
  listForRun(runId: string): AutomationApprovalRecord[] { this.repository.expireDue(); return this.repository.listForRun(runId); }
  get(id: string): AutomationApprovalRecord | null { this.repository.expireDue(); return this.repository.get(id); }
  resolveProjectId(id: string): string | null { return this.get(id)?.projectId ?? null; }
}
