import type { NodeFlowRepository } from "../../repositories/node-flow-repository.js";

export class NodeFlowLeaseService {
  constructor(private readonly repository: NodeFlowRepository) {}
  heartbeat(runId: string, executorId: string, leaseDurationMs: number): boolean {
    return this.repository.heartbeatRun(runId, executorId, leaseDurationMs);
  }
}
