import type { NodeFlowRepository } from "../../repositories/node-flow-repository.js";
import type { NodeFlowRunRecord } from "../../contracts/node-flow-types.js";
import type { ApprovalService } from "./approval-service.js";
import type { NodeFlowRuntimeService } from "../node-flow-runtime-service.js";

export class NodeFlowRecoveryService {
  constructor(
    private readonly repository: NodeFlowRepository,
    private readonly approvalService?: ApprovalService,
    private readonly runtimeService?: NodeFlowRuntimeService,
  ) {}

  recover(now = new Date()): NodeFlowRunRecord[] {
    const recoverable = this.repository.listRecoverableRuns(now.toISOString());
    return recoverable.map((run) => {
      if (run.status !== "running") return run;
      const attempts = this.repository.listNodeAttempts(run.id);
      const active = attempts.find((attempt) => attempt.status === "running");
      if (active) {
        const nextStatus = active.invocationId ? "attention_required" : "queued";
        return this.repository.updateRun(run.id, {
          status: nextStatus,
          errorMessage: active.invocationId
            ? "An externally observable attempt lost its lease; its outcome is unknown and requires attention."
            : "Lease expired before an external invocation began; the run was safely requeued.",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
      }
      return this.repository.updateRun(run.id, { status: "queued", leaseOwner: null, leaseExpiresAt: null });
    });
  }

  async resumeDecidedApprovals(): Promise<NodeFlowRunRecord[]> {
    if (!this.approvalService || !this.runtimeService) return [];
    const resumed: NodeFlowRunRecord[] = [];
    const waitingRuns = this.repository.listRecoverableRuns().filter((run) => run.status === "approval_waiting");
    for (const run of waitingRuns) {
      const waitingNode = this.repository.listNodeRuns(run.id).find((candidate) => candidate.status === "approval_waiting");
      if (!waitingNode) continue;
      const approval = this.approvalService.listForRun(run.id)
        .map((candidate) => this.approvalService!.get(candidate.id) ?? candidate)
        .find((candidate) => candidate.nodeId === waitingNode.nodeId && candidate.status !== "pending");
      if (!approval) continue;
      const summary = await this.runtimeService.resumeApproval(run.projectId, approval.id, run.id);
      resumed.push(summary.run);
    }
    return resumed;
  }
}
