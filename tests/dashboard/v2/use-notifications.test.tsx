/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import { act } from "preact/test-utils";
import { HelpCircle } from "lucide-preact";
import { useNotifications } from "../../../dashboard/src/v2/hooks/use-notifications.js";
import type { DashboardNotification as DashboardNotificationRecord } from "../../../dashboard/src/types.js";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as realtime from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";
import * as schedulerApi from "../../../dashboard/src/v2/lib/scheduler-api.js";
import { openOnboarding } from "../../../dashboard/src/v2/lib/onboarding-control.js";

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => ({
  fetchOnboardingReadiness: vi.fn(async () => ({
    checkedAt: new Date().toISOString(),
    cluster: { status: "ready", label: "Ready", detail: "Runtime is ready." },
    dependencies: [],
    providers: [],
  })),
  fetchDashboardNotifications: vi.fn(async () => ({ notifications: [], updatedAt: null })),
}));

const makeIntervention = (overrides: Partial<DashboardNotificationRecord> = {}): DashboardNotificationRecord => ({
  id: "attention:attention-1",
  kind: "human_intervention",
  severity: "high",
  title: "Manual decision required",
  summary: "Choose the safe migration path.",
  reason: "The worker needs an operator decision.",
  instructions: "Review the task and resume the sprint.",
  projectId: "project-other",
  projectName: "Other Project",
  sprintId: "sprint-10",
  sprintName: "Migration Sprint",
  sprintNumber: 10,
  taskId: "task-1",
  taskKey: "T01",
  taskTitle: "Migrate storage",
  attentionItemId: "attention-1",
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:03:00.000Z",
  source: {
    type: "attention_item",
    id: "attention-1",
    eventType: "action_required",
    sprintRunId: "run-10",
    taskRunId: null,
    dispatchId: "dispatch-1",
    attentionOwnerType: "human",
    attentionStatus: "open",
  },
  links: {
    project: "/projects?projectId=project-other",
    sprint: "/sprints?projectId=project-other&sprintId=sprint-10",
    task: "/tasks?projectId=project-other&sprintId=sprint-10&taskId=task-1",
    live: "/live?projectId=project-other&sprintId=sprint-10",
  },
  ...overrides,
});

vi.mock("../../../dashboard/src/v2/lib/onboarding-control.js", () => ({
  openOnboarding: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/scheduler-api.js", () => ({
  fetchActiveAgentSchedulerEntries: vi.fn(async () => []),
}));

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => vi.fn()),
}));

describe("useNotifications", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(dashboardApi.fetchOnboardingReadiness).mockResolvedValue({
      checkedAt: new Date().toISOString(),
      cluster: { status: "ready", label: "Ready", detail: "Runtime is ready." },
      dependencies: [],
      providers: [],
    });
    vi.mocked(schedulerApi.fetchActiveAgentSchedulerEntries).mockResolvedValue([]);
    vi.mocked(dashboardApi.fetchDashboardNotifications).mockResolvedValue({ notifications: [], updatedAt: null });
    vi.mocked(realtime.subscribeToDashboardRealtime).mockReturnValue(vi.fn());
  });

  it("includes global interventions from non-selected projects with task context and no placeholder", async () => {
    const intervention = makeIntervention();
    vi.mocked(dashboardApi.fetchDashboardNotifications).mockResolvedValueOnce({
      notifications: [intervention],
      updatedAt: intervention.updatedAt,
    });
    const { result } = renderHook(() => useNotifications("project-selected"));

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.sourceId === intervention.id)).toBe(true);
    });

    const projected = result.current.notifications.find((notification) => notification.sourceId === intervention.id);

    expect(projected).toMatchObject({
      id: `attention:attention-1@${intervention.updatedAt}`,
      sourceId: "attention:attention-1",
      type: "intervention",
      severity: "warning",
      title: "Manual decision required",
      body: "Task T01 (Migrate storage) · Sprint SPR-10 (Migration Sprint) · Project Other Project — Choose the safe migration path.",
      subtitle: "Task T01 (Migrate storage) · Sprint SPR-10 (Migration Sprint) · Project Other Project",
      unread: true,
      iconColor: "text-status-amber",
      actionHref: "/tasks?projectId=project-other&sprintId=sprint-10&taskId=task-1",
    });
    expect(projected?.icon).toBe(HelpCircle);
    expect(projected?.details).toEqual(expect.arrayContaining([
      { label: "Project", value: "Other Project" },
      { label: "Sprint", value: "SPR-10 (Migration Sprint)" },
      { label: "Task", value: "T01 (Migrate storage)" },
    ]));
    expect(result.current.notifications.some((notification) => notification.id === "4")).toBe(false);
    expect(dashboardApi.fetchOnboardingReadiness).toHaveBeenCalledTimes(1);
    expect(dashboardApi.fetchDashboardNotifications).toHaveBeenCalledTimes(1);
  });

  it("keeps startup errors persistent and exposes an operator recovery action", async () => {
    vi.mocked(dashboardApi.fetchOnboardingReadiness).mockResolvedValueOnce({
      checkedAt: new Date().toISOString(),
      cluster: { status: "blocked", label: "Blocked", detail: "Docker is missing." },
      dependencies: [
        {
          id: "docker",
          label: "Docker",
          status: "missing",
          required: true,
          detail: "Docker is unavailable.",
          resolution: "Install Docker and restart Code UX.",
        },
      ],
      providers: [],
    } as any);

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "startup-cluster-not-ready")).toBe(true);
    });

    const startupError = result.current.notifications.find((notification) => notification.id === "startup-cluster-not-ready");
    expect(startupError).toMatchObject({
      severity: "critical",
      dismissible: false,
      actionLabel: "Open onboarding",
    });

    startupError?.onAction?.();
    expect(openOnboarding).toHaveBeenCalledTimes(1);
  });

  it("shows a persistent onboarding action when no provider configuration is usable", async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "startup-provider-auth-missing")).toBe(true);
    });

    const providerMissing = result.current.notifications.find((notification) => notification.id === "startup-provider-auth-missing");
    expect(providerMissing).toMatchObject({
      severity: "warning",
      title: "Provider configuration required",
      dismissible: false,
      actionLabel: "Open onboarding",
    });
    providerMissing?.onAction?.();
    expect(openOnboarding).toHaveBeenCalledTimes(1);
  });

  it("derives stable notifications for active agent-created schedules", async () => {
    vi.mocked(schedulerApi.fetchActiveAgentSchedulerEntries).mockResolvedValueOnce([
      {
        id: "entry-wakeup",
        targetType: "agent_wakeup",
        label: "Agent wakeup",
        title: "Morning queue check",
        status: "scheduled",
        statusLabel: "scheduled",
        timingSummary: "Scheduled for Jul 7, 09:00 AM",
        targetSummary: "Thread thread-123",
        scheduledAt: "2026-07-07T09:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useNotifications("proj-1"));

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "scheduler-agent-entry-wakeup")).toBe(true);
    });

    const scheduleNotification = result.current.notifications.find((notification) => notification.id === "scheduler-agent-entry-wakeup");
    expect(scheduleNotification).toMatchObject({
      id: "scheduler-agent-entry-wakeup",
      severity: "info",
      title: "Agent wakeup scheduled",
      body: "Morning queue check. Thread thread-123. Scheduled for Jul 7, 09:00 AM. Status: scheduled.",
      unread: true,
      dismissible: true,
      time: "Scheduled",
    });
    expect(result.current.agentSchedules).toHaveLength(1);
    expect(schedulerApi.fetchActiveAgentSchedulerEntries).toHaveBeenCalledWith("proj-1");
  });

  it("keeps read and dismiss state stable across scheduler refreshes", async () => {
    const entry = {
      id: "entry-task",
      targetType: "task" as const,
      label: "Task run",
      title: "Retry task T01",
      status: "scheduled" as const,
      statusLabel: "scheduled",
      timingSummary: "After source sprint sprint-1 ends + 5 minutes",
      targetSummary: "Task task-1 · codex",
      scheduledAt: null,
    };
    vi.mocked(schedulerApi.fetchActiveAgentSchedulerEntries).mockResolvedValue([entry]);

    const { result } = renderHook(() => useNotifications("proj-1"));

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "scheduler-agent-entry-task")).toBe(true);
    });

    act(() => {
      result.current.markRead("scheduler-agent-entry-task");
    });

    await waitFor(() => {
      expect(result.current.notifications.find((notification) => notification.id === "scheduler-agent-entry-task")?.unread).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.notifications.find((notification) => notification.id === "scheduler-agent-entry-task")?.unread).toBe(false);

    act(() => {
      result.current.dismiss("scheduler-agent-entry-task");
    });

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "scheduler-agent-entry-task")).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.notifications.some((notification) => notification.id === "scheduler-agent-entry-task")).toBe(false);
  });

  it("refreshes the agent schedule projection for the selected project", async () => {
    vi.mocked(schedulerApi.fetchActiveAgentSchedulerEntries)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "entry-refresh",
          targetType: "task",
          label: "Task run",
          title: "Retry refreshed task",
          status: "scheduled",
          statusLabel: "scheduled",
          timingSummary: "Scheduled for Jul 7, 10:30 AM",
          targetSummary: "Task task-refresh",
          scheduledAt: "2026-07-07T10:30:00.000Z",
        },
      ]);

    const { result } = renderHook(() => useNotifications("proj-1"));

    await waitFor(() => {
      expect(schedulerApi.fetchActiveAgentSchedulerEntries).toHaveBeenCalledTimes(1);
    });
    expect(result.current.notifications.some((notification) => notification.id === "scheduler-agent-entry-refresh")).toBe(false);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "scheduler-agent-entry-refresh")).toBe(true);
    });
    expect(schedulerApi.fetchActiveAgentSchedulerEntries).toHaveBeenLastCalledWith("proj-1");
  });

  it("preserves intervention read and dismiss state until the server timestamp changes", async () => {
    const original = makeIntervention();
    const updated = makeIntervention({ updatedAt: "2026-07-11T09:05:00.000Z", summary: "A new decision is required." });
    vi.mocked(dashboardApi.fetchDashboardNotifications)
      .mockResolvedValueOnce({ notifications: [original], updatedAt: original.updatedAt })
      .mockResolvedValueOnce({ notifications: [original], updatedAt: original.updatedAt })
      .mockResolvedValueOnce({ notifications: [updated], updatedAt: updated.updatedAt });

    const { result } = renderHook(() => useNotifications());
    const originalId = `${original.id}@${original.updatedAt}`;

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === originalId)).toBe(true);
    });
    act(() => result.current.markRead(originalId));
    await act(async () => result.current.refresh());
    expect(result.current.notifications.find((notification) => notification.id === originalId)?.unread).toBe(false);

    act(() => result.current.dismiss(originalId));
    expect(result.current.notifications.some((notification) => notification.id === originalId)).toBe(false);

    await act(async () => result.current.refresh());
    const updatedId = `${updated.id}@${updated.updatedAt}`;
    expect(result.current.notifications.find((notification) => notification.id === updatedId)).toMatchObject({
      body: expect.stringContaining("A new decision is required."),
      unread: true,
    });
  });

  it("subscribes globally and refreshes the relevant projection for realtime events", async () => {
    let realtimeCallback: Parameters<typeof realtime.subscribeToDashboardRealtime>[1] | undefined;
    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, callback) => {
      expect(scopes).toEqual(["overview", "project:proj-1"]);
      realtimeCallback = callback;
      return vi.fn();
    });
    const { result } = renderHook(() => useNotifications("proj-1"));

    await waitFor(() => expect(realtimeCallback).toBeDefined());
    await act(async () => result.current.refresh());
    const initialGlobalCalls = vi.mocked(dashboardApi.fetchDashboardNotifications).mock.calls.length;
    const initialReadinessCalls = vi.mocked(dashboardApi.fetchOnboardingReadiness).mock.calls.length;
    const initialSchedulerCalls = vi.mocked(schedulerApi.fetchActiveAgentSchedulerEntries).mock.calls.length;

    await act(async () => {
      realtimeCallback?.({
        type: "event",
        sequence: 1,
        event: { eventType: "overview.telemetry.updated" },
      } as Parameters<NonNullable<typeof realtimeCallback>>[0]);
    });
    await waitFor(() => {
      expect(dashboardApi.fetchDashboardNotifications).toHaveBeenCalledTimes(initialGlobalCalls + 1);
    });
    expect(schedulerApi.fetchActiveAgentSchedulerEntries).toHaveBeenCalledTimes(initialSchedulerCalls);
    expect(dashboardApi.fetchOnboardingReadiness).toHaveBeenCalledTimes(initialReadinessCalls);

    await act(async () => {
      realtimeCallback?.({
        type: "event",
        sequence: 2,
        event: { eventType: "project.execution.updated" },
      } as Parameters<NonNullable<typeof realtimeCallback>>[0]);
    });
    expect(schedulerApi.fetchActiveAgentSchedulerEntries).toHaveBeenCalledTimes(initialSchedulerCalls);
    expect(result.current.notifications.some((notification) => notification.id === "4")).toBe(false);
  });
});
