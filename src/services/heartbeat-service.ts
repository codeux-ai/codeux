import type { Logger } from "../shared/logging/logger.js";
import type { SprintRunLifecycleService } from "./sprint-run-lifecycle-service.js";

export interface HeartbeatServiceDependencies {
  sprintRunLifecycleService: Pick<SprintRunLifecycleService, "renewHeartbeat">;
  logger: Logger;
  intervalMs?: number;
}

export class HeartbeatService {
  private activeRuns = new Map<string, { sprintId: string; leaseToken?: string; timer: NodeJS.Timeout }>();
  private readonly intervalMs: number;

  constructor(private readonly deps: HeartbeatServiceDependencies) {
    this.intervalMs = deps.intervalMs ?? 30000; // 30 seconds default
  }

  startHeartbeat(sprintRunId: string, sprintId: string, leaseToken?: string): void {
    if (this.activeRuns.has(sprintRunId)) {
      return;
    }

    const timer = setInterval(() => {
      try {
        const renewed = this.deps.sprintRunLifecycleService.renewHeartbeat({
          sprintRunId,
          sprintId,
          leaseToken,
        });

        if (!renewed) {
          this.stopHeartbeat(sprintRunId);
        }
      } catch (err) {
        this.deps.logger.error("Failed to renew sprint run heartbeat", {
          sprintRunId,
          error: err instanceof Error ? err.message : String(err),
        });
        if (isLeaseOwnershipError(err)) {
          this.stopHeartbeat(sprintRunId);
        }
      }
    }, this.intervalMs);

    this.activeRuns.set(sprintRunId, { sprintId, leaseToken, timer });

    // Do an immediate renewal on start
    try {
      const renewed = this.deps.sprintRunLifecycleService.renewHeartbeat({
        sprintRunId,
        sprintId,
        leaseToken,
      });
      if (!renewed) {
        this.stopHeartbeat(sprintRunId);
      }
    } catch (err) {
      this.deps.logger.error("Failed to execute initial sprint run heartbeat", {
        sprintRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (isLeaseOwnershipError(err)) {
        this.stopHeartbeat(sprintRunId);
      }
    }
  }

  stopHeartbeat(sprintRunId: string): void {
    const run = this.activeRuns.get(sprintRunId);
    if (run) {
      clearInterval(run.timer);
      this.activeRuns.delete(sprintRunId);
    }
  }

  stopAll(): void {
    for (const [sprintRunId, run] of this.activeRuns.entries()) {
      clearInterval(run.timer);
    }
    this.activeRuns.clear();
  }
}

function isLeaseOwnershipError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Lease token mismatch|Lease already held/.test(message);
}
