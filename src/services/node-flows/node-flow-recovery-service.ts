import type { NodeFlowRepository } from "../../repositories/node-flow-repository.js";
import type { NodeFlowRunRecord } from "../../contracts/node-flow-types.js";

export class NodeFlowRecoveryService {
  constructor(private readonly repository: NodeFlowRepository) {}

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
}
