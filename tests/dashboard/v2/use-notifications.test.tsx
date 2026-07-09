/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import { act } from "preact/test-utils";
import { HelpCircle } from "lucide-preact";
import { useNotifications } from "../../../dashboard/src/v2/hooks/use-notifications.js";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as schedulerApi from "../../../dashboard/src/v2/lib/scheduler-api.js";
import { openOnboarding } from "../../../dashboard/src/v2/lib/onboarding-control.js";

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => ({
  fetchOnboardingReadiness: vi.fn(async () => ({
    checkedAt: new Date().toISOString(),
    cluster: { status: "ready", label: "Ready", detail: "Runtime is ready." },
    dependencies: [],
    providers: [],
  })),
}));

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
  });

  it("includes the human intervention notification with the expected icon and copy", async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.notifications.some((notification) => notification.id === "4")).toBe(true);
    });

    const intervention = result.current.notifications.find((notification) => notification.id === "4");

    expect(intervention).toMatchObject({
      id: "4",
      type: "intervention",
      title: "Human Intervention Required",
      subtitle: "Task T01 in sprint SPR-10 requires manual decision.",
      time: "3m ago",
      unread: true,
      iconColor: "text-status-amber",
    });
    expect(intervention?.icon).toBe(HelpCircle);
    expect(dashboardApi.fetchOnboardingReadiness).toHaveBeenCalledTimes(1);
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
});
