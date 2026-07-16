import { describe, expect, it } from "vitest";
import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../../../dashboard/src/types.js";
import { buildSprintDagWorkflowEvidenceByTaskId } from "../../../../dashboard/src/v2/lib/sprint-dag-workflow-evidence.js";

function task(index: number): Subtask {
  return {
    record_id: `task-${index}`,
    project_id: "project-1",
    sprint_id: "sprint-1",
    id: `T${index}`,
    title: `Task ${index}`,
    prompt: `Implement task ${index}.`,
    depends_on: index === 0 ? [] : [`T${index - 1}`],
    status: "RUNNING",
    is_independent: index === 0,
  };
}

function dispatch(index: number): ExecutionTaskDispatchSummary {
  return {
    id: `dispatch-${index}`,
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintRunId: "run-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    taskId: `task-${index}`,
    taskKey: `T${index}`,
    taskTitle: `Task ${index}`,
    status: "running",
    executorType: "docker_cli",
    priority: index,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    taskRunId: `task-run-${index}`,
    taskRunState: "RUNNING",
    provider: "codex",
    sessionId: `session-${index}`,
    sessionName: `session-${index}`,
    workerBranch: `worker/t-${index}`,
    prUrl: `https://example.test/pr/${index}`,
    queuedAt: "2026-07-16T08:00:00.000Z",
    claimedAt: "2026-07-16T08:00:01.000Z",
    startedAt: "2026-07-16T08:00:02.000Z",
    finishedAt: null,
    lastHeartbeatAt: "2026-07-16T08:00:03.000Z",
    errorMessage: null,
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
  };
}

function event(index: number): ExecutionRuntimeEventSummary {
  return {
    id: `event-${index}`,
    scopeType: "task_run",
    taskRunId: `task-run-${index}`,
    sprintRunId: "run-1",
    dispatchId: `dispatch-${index}`,
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: `task-${index}`,
    taskKey: `T${index}`,
    taskTitle: `Task ${index}`,
    taskRunState: "RUNNING",
    eventType: "ci_gate_status",
    originator: "system",
    sourceEventKey: null,
    provider: "codex",
    sessionId: `session-${index}`,
    sessionName: `session-${index}`,
    workerBranch: `worker/t-${index}`,
    prUrl: `https://example.test/pr/${index}`,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-07-16T08:00:04.000Z",
    payload: { state: "waiting_checks", prNumber: index, hasPendingChecks: true },
  };
}

function attention(index: number): ExecutionAttentionItemSummary {
  return {
    id: `attention-${index}`,
    sprintId: "sprint-1",
    taskId: `task-${index}`,
    sprintRunId: "run-1",
    dispatchId: `dispatch-${index}`,
    attentionType: "human_escalation_required",
    severity: "high",
    ownerType: "human",
    status: "open",
    assignedWorkerEndpointId: null,
    title: `Human decision ${index}`,
    summaryMarkdown: "Only a person can resolve this.",
    payload: { taskKey: `T${index}` },
    openedAt: "2026-07-16T08:00:05.000Z",
    claimedAt: null,
    resolvedAt: null,
    updatedAt: "2026-07-16T08:00:05.000Z",
  };
}

describe("buildSprintDagWorkflowEvidenceByTaskId", () => {
  it("indexes a 400-task evidence feed without cross-task contamination", () => {
    const tasks = Array.from({ length: 400 }, (_, index) => task(index));
    const dispatches = Array.from({ length: 400 }, (_, index) => dispatch(index));
    const events = Array.from({ length: 400 }, (_, index) => event(index));
    const attentionItems = Array.from({ length: 400 }, (_, index) => attention(index));

    const evidence = buildSprintDagWorkflowEvidenceByTaskId({
      tasks,
      dispatches,
      events,
      attentionItems,
      locale: "en",
    });

    expect(evidence.size).toBe(800);
    expect(evidence.get("T0")?.ciPresentation?.label).toBe("CI running");
    expect(evidence.get("task-399")?.ciPresentation?.label).toBe("CI running");
    expect(evidence.get("T0")?.humanIntervention?.id).toBe("attention-0");
    expect(evidence.get("T399")?.humanIntervention?.id).toBe("attention-399");
  });

  it("indexes dispatch-only human attention to the owning task", () => {
    const taskRecord = task(1);
    const dispatchRecord = dispatch(1);
    const dispatchOnlyAttention = {
      ...attention(1),
      taskId: null,
      payload: null,
    };

    const evidence = buildSprintDagWorkflowEvidenceByTaskId({
      tasks: [taskRecord],
      dispatches: [dispatchRecord],
      events: [],
      attentionItems: [dispatchOnlyAttention],
      locale: "en",
    });

    expect(evidence.get(taskRecord.id)?.humanIntervention?.id).toBe(dispatchOnlyAttention.id);
  });
});
