import type { CodeUxPrincipal } from "../contracts/headless-security-types.js";
import type { NodeFlowRunRecord } from "../contracts/node-flow-types.js";
import type { NodeFlowRepository } from "../repositories/node-flow-repository.js";
import { NodeFlowQueueService, NodeFlowQuotaExceededError } from "./node-flows/node-flow-queue-service.js";

export class DistributedRunnerAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributedRunnerAuthorizationError";
  }
}

/**
 * Owns the narrow distributed-runner lease boundary. Execution remains in the
 * node-flow runtime; this service only grants project-scoped, compare-and-set
 * leases to authenticated runner identities.
 */
export class DistributedNodeFlowRunnerService {
  private readonly queue: NodeFlowQueueService;

  constructor(private readonly repository: NodeFlowRepository) {
    this.queue = new NodeFlowQueueService(repository);
  }

  claimNext(principal: CodeUxPrincipal): NodeFlowRunRecord | null {
    this.requireRunner(principal);
    const candidates = this.repository.listRecoverableRuns().filter((run) =>
      (run.status === "queued" || run.status === "retry_waiting")
      && (principal.projectIds.includes("*") || principal.projectIds.includes(run.projectId))
    );
    for (const run of candidates) {
      try {
        return this.queue.claim(run, principal.id);
      } catch (error) {
        if (error instanceof NodeFlowQuotaExceededError) return null;
        // Another runner may have won the compare-and-set lease; try the next row.
      }
    }
    return null;
  }

  heartbeat(principal: CodeUxPrincipal, runId: string, leaseDurationMs: number): boolean {
    this.requireRunner(principal);
    return this.repository.heartbeatRun(runId, principal.id, leaseDurationMs);
  }

  private requireRunner(principal: CodeUxPrincipal): void {
    if (principal.kind !== "service" || !principal.roles.includes("automation_runner")) {
      throw new DistributedRunnerAuthorizationError("A service principal with automation_runner is required.");
    }
  }
}
