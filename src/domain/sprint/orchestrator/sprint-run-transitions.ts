import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { SprintRunStatus, UpdateSprintRunInput } from "../../../contracts/execution-types.js";

export function transitionSprintRun(
  executionRepository: Pick<ExecutionRepository, "updateSprintRun" | "appendSprintRunEvent">,
  sprintRunId: string,
  status: SprintRunStatus,
  eventType: string,
  eventPayload: Record<string, unknown>,
  sourceEventKeySuffix: string
): void {
  const now = new Date().toISOString();
  const isTerminal = status === "completed" || status === "failed" || status === "cancelled";

  const updatePayload: UpdateSprintRunInput = {
    status,
    lastHeartbeatAt: now,
  };
  if (isTerminal) {
    updatePayload.finishedAt = now;
  }

  executionRepository.updateSprintRun(sprintRunId, updatePayload);
  executionRepository.appendSprintRunEvent(
    sprintRunId,
    eventType,
    "system",
    eventPayload,
    {
      sourceEventKey: sourceEventKeySuffix,
    }
  );
}
