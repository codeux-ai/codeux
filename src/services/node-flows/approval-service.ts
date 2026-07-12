import { ValidationError } from "../../repositories/repository-utils.js";
import { AutomationApprovalRepository, type AutomationApprovalRecord } from "../../repositories/automation-approval-repository.js";
import type { NodeFlowJsonObject } from "../../contracts/node-flow-types.js";

export class ApprovalRequiredError extends Error {
  constructor(public readonly approval: AutomationApprovalRecord) {
    super(`Approval is required: ${approval.id}`);
    this.name = "ApprovalRequiredError";
  }
}

export class ApprovalService {
  constructor(private readonly repository: AutomationApprovalRepository) {}

  requireApproval(input: {
    projectId: string; flowId: string; runId: string; nodeId: string;
    logicalItem?: string; request: NodeFlowJsonObject; expiresAt?: string | null;
  }): AutomationApprovalRecord {
    const logicalItem = input.logicalItem?.trim() || "default";
    this.repository.expireDue();
    const approval = this.repository.getForItem(input.runId, input.nodeId, logicalItem)
      ?? this.repository.request({ ...input, logicalItem });
    if (approval.status === "approved") return approval;
    if (approval.status === "rejected" || approval.status === "expired") {
      throw new ValidationError(`Approval ${approval.id} is ${approval.status}.`);
    }
    throw new ApprovalRequiredError(approval);
  }

  approve(id: string, decidedBy: string, decision: NodeFlowJsonObject = {}): AutomationApprovalRecord {
    return this.repository.decide(id, { status: "approved", decidedBy, decision });
  }
  reject(id: string, decidedBy: string, decision: NodeFlowJsonObject = {}): AutomationApprovalRecord {
    return this.repository.decide(id, { status: "rejected", decidedBy, decision });
  }
  listForRun(runId: string): AutomationApprovalRecord[] { return this.repository.listForRun(runId); }
}
