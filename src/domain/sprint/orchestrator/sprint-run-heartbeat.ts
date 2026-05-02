import type { ExecutionRepository } from "../../../repositories/execution-repository.js";

export function renewSprintRunHeartbeat(
  executionRepository: Pick<ExecutionRepository, "getSprintRun" | "renewLease" | "updateSprintRun">,
  args: {
    sprintRunId: string;
    sprintId: string;
    leaseToken?: string;
  }
): boolean {
  const latestRun = executionRepository.getSprintRun(args.sprintRunId);
  if (
    latestRun?.status === "paused" ||
    latestRun?.status === "cancelled" ||
    latestRun?.status === "cancel_requested" ||
    latestRun?.status === "completed" ||
    latestRun?.status === "failed"
  ) {
    return false;
  }

  const now = new Date().toISOString();
  executionRepository.updateSprintRun(args.sprintRunId, {
    status: "running",
    lastHeartbeatAt: now,
  });

  if (args.leaseToken) {
    executionRepository.renewLease({
      scopeType: "sprint",
      scopeId: args.sprintId,
      leaseToken: args.leaseToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  }

  return true;
}
