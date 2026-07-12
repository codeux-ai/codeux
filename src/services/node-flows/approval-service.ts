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
    const approval = this.repository.getForItem(input.runId, input.nodeId, logicalItem)
      ?? this.repository.request({ ...input, logicalItem });
    if (approval.status === "approved") return approval;
    this.auditService?.recordSystem({ action: "approval.requested", resourceType: "automation_approval", resourceId: approval.id, projectId: approval.projectId, outcome: "succeeded", metadata: { flowId: approval.flowId, runId: approval.runId, nodeId: approval.nodeId, logicalItem: approval.logicalItem } });
    if (approval.status === "rejected" || approval.status === "expired") {
      throw new ValidationError(`Approval ${approval.id} is ${approval.status}.`);
    }
    throw new ApprovalRequiredError(approval);
  }

  approve(id: string, decidedBy: string, decision: NodeFlowJsonObject = {}): AutomationApprovalRecord {
    const approval = this.repository.decide(id, { status: "approved", decidedBy, decision });
    this.auditService?.recordSystem({ action: "approval.approved", resourceType: "automation_approval", resourceId: approval.id, projectId: approval.projectId, outcome: "succeeded", principalId: decidedBy, metadata: { flowId: approval.flowId, runId: approval.runId, nodeId: approval.nodeId } });
    return approval;
  }
  reject(id: string, decidedBy: string, decision: NodeFlowJsonObject = {}): AutomationApprovalRecord {
    const approval = this.repository.decide(id, { status: "rejected", decidedBy, decision });
    this.auditService?.recordSystem({ action: "approval.rejected", resourceType: "automation_approval", resourceId: approval.id, projectId: approval.projectId, outcome: "succeeded", principalId: decidedBy, metadata: { flowId: approval.flowId, runId: approval.runId, nodeId: approval.nodeId } });
    return approval;
  }
  resolveProjectId(id: string): string | null { return this.repository.get(id)?.projectId ?? null; }
  listForRun(runId: string): AutomationApprovalRecord[] { return this.repository.listForRun(runId); }
}
