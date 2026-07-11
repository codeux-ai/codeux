import { describe, expect, it } from "vitest";
import { AlertTriangle, CircleStop, ServerCrash } from "lucide-preact";
import type { DashboardNotification } from "../../../dashboard/src/types.js";
import { toNotificationViewModel } from "../../../dashboard/src/v2/lib/notification-view-models.js";

const baseRecord = (overrides: Partial<DashboardNotification> = {}): DashboardNotification => ({
  id: "dispatch:dispatch-1:failed",
  kind: "task_execution_failed",
  severity: "high",
  title: "T02 execution failed",
  summary: "The provider exited before producing a result.",
  reason: "Provider process exited.",
  instructions: "Review the task and retry it.",
  projectId: "project / one",
  projectName: "Project One",
  sprintId: "sprint / one",
  sprintName: "Hardening",
  sprintNumber: 12,
  taskId: "task / two",
  taskKey: "T02",
  taskTitle: "Harden retries",
  attentionItemId: null,
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:30:00.000Z",
  source: {
    type: "task_dispatch",
    id: "dispatch-1",
    eventType: "dispatch_failed",
    sprintRunId: "run-1",
    taskRunId: null,
    dispatchId: "dispatch-1",
    attentionOwnerType: null,
    attentionStatus: null,
  },
  links: {
    project: "/projects?projectId=project%20%2F%20one",
    sprint: "/sprints?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one",
    task: "/tasks?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one&taskId=task%20%2F%20two",
    live: "/live?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one",
  },
  ...overrides,
});

describe("notification view models", () => {
  it("maps task failures to critical task actions with encoded direct links", () => {
    const result = toNotificationViewModel(baseRecord(), new Date("2026-07-11T09:35:00.000Z").getTime());

    expect(result).toMatchObject({
      id: "dispatch:dispatch-1:failed@2026-07-11T09:30:00.000Z",
      type: "task-failure",
      severity: "critical",
      icon: AlertTriangle,
      time: "5m ago",
      actionLabel: "Review task",
      actionHref: "/tasks?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one&taskId=task%20%2F%20two",
    });
    expect(result.details).toEqual([
      { label: "Project", value: "Project One" },
      { label: "Sprint", value: "SPR-12 (Hardening)" },
      { label: "Task", value: "T02 (Harden retries)" },
      { label: "What went wrong", value: "The provider exited before producing a result." },
      { label: "Why this needs attention", value: "Provider process exited." },
      { label: "Recommended next steps", value: "Review the task and retry it." },
      { label: "Timestamp", value: "2026-07-11T09:30:00.000Z" },
      { label: "Source context", value: "Task dispatch · dispatch failed · Source dispatch-1" },
    ]);
  });

  it("maps failed and automatically stopped sprint records to live context", () => {
    const sprintFailure = toNotificationViewModel(baseRecord({
      id: "sprint-run:run-1:failed",
      kind: "sprint_execution_failed",
      severity: "critical",
      taskId: null,
      taskKey: null,
      taskTitle: null,
      source: { ...baseRecord().source, type: "sprint_run", id: "run-1", dispatchId: null },
    }));
    const stopped = toNotificationViewModel(baseRecord({
      id: "event:sprint_run_event:event-1",
      kind: "sprint_automatically_stopped",
      severity: "medium",
      taskId: null,
      taskKey: null,
      taskTitle: null,
      source: { ...baseRecord().source, type: "sprint_run_event", id: "event-1", dispatchId: null },
    }));

    expect(sprintFailure).toMatchObject({
      type: "sprint-failure",
      severity: "critical",
      icon: AlertTriangle,
      actionHref: "/live?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one",
    });
    expect(stopped).toMatchObject({
      type: "automatic-stop",
      severity: "warning",
      icon: CircleStop,
      actionHref: "/live?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one",
    });
  });

  it("keeps system records without task or sprint context and links to the project", () => {
    const result = toNotificationViewModel(baseRecord({
      id: "event:task_run_event:event-2",
      kind: "system_execution_error",
      sprintId: null,
      sprintName: null,
      sprintNumber: null,
      taskId: null,
      taskKey: null,
      taskTitle: null,
      source: {
        ...baseRecord().source,
        type: "task_run_event",
        id: "event-2",
        sprintRunId: null,
        dispatchId: null,
      },
    }));

    expect(result).toMatchObject({
      type: "system-error",
      severity: "critical",
      icon: ServerCrash,
      subtitle: "Project Project One",
      actionHref: "/projects?projectId=project%20%2F%20one",
    });
    expect(result.details?.some((detail) => detail.label === "Sprint" || detail.label === "Task")).toBe(false);
  });

  it("falls back to the sprint surface when no live run context exists", () => {
    const result = toNotificationViewModel(baseRecord({
      taskId: null,
      taskKey: null,
      taskTitle: null,
      source: { ...baseRecord().source, sprintRunId: null, dispatchId: null },
    }));

    expect(result.actionHref).toBe("/sprints?projectId=project%20%2F%20one&sprintId=sprint%20%2F%20one");
  });
});
