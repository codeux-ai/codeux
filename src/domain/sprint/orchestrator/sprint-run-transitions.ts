import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";

export function transitionSprintRun(
  executionRepository: Pick<SprintOrchestratorDependencies["executionRepository"], "updateSprintRun" | "appendSprintRunEvent">,
  sprintRunId: string,
  status: string,
  eventType: string,
  eventPayload: Record<string, unknown>,
  sourceEventKeySuffix: string
): void {
  const now = new Date().toISOString();
  const isTerminal = status === "completed" || status === "failed" || status === "cancelled";

  const updatePayload: Record<string, unknown> = {
    status,
    lastHeartbeatAt: now,
  };
  if (isTerminal) {
    updatePayload.finishedAt = now;
  }

  executionRepository.updateSprintRun(sprintRunId, updatePayload as any);
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
