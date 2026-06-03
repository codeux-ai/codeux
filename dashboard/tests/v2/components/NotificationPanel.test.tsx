/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AlertTriangle } from "lucide-preact";
import { NotificationPanel } from "../../../src/v2/components/NotificationPanel.js";
import { useOverviewTelemetry } from "../../../src/hooks/use-overview-telemetry.js";
import type { OverviewTelemetrySnapshot } from "../../../src/types.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (cb: () => void) => {
      cb();
      return { revert: () => undefined };
    },
    fromTo: () => undefined,
  },
}));

vi.mock("../../../src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../src/hooks/use-overview-telemetry.js", () => ({
  useOverviewTelemetry: vi.fn(),
}));

describe("NotificationPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders startup notifications and exposes actions", () => {
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: null,
      } as OverviewTelemetrySnapshot,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    const markAllRead = vi.fn();
    const markRead = vi.fn();
    const dismiss = vi.fn();
    const refresh = vi.fn();
    const action = vi.fn();

    render(
      <NotificationPanel
        unreadCount={1}
        notifications={[{
          id: "startup-cluster-not-ready",
          severity: "critical",
          title: "Cluster not ready",
          body: "Docker daemon must be available before containerized provider CLIs can run.",
          time: "just now",
          unread: true,
          dismissible: false,
          icon: AlertTriangle,
          actionLabel: "Open onboarding",
          onAction: action,
        }]}
        onMarkAllRead={markAllRead}
        onMarkRead={markRead}
        onDismiss={dismiss}
        onRefresh={refresh}
      />,
    );

    expect(screen.getByRole("menu", { name: "Notifications Panel" })).toBeInTheDocument();
    expect(screen.getByText("Cluster not ready")).toBeInTheDocument();
    expect(screen.queryByText("Deployment successful")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open onboarding" }));
    expect(markRead).toHaveBeenCalledWith("startup-cluster-not-ready");
    expect(action).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Mark all notifications read" }));
    expect(markAllRead).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders intervention notifications from overview telemetry", () => {
    const refreshTelemetry = vi.fn();

    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [
          {
            projectId: "project-1",
            projectName: "Alpha Project",
            sprintId: "sprint-1",
            sprintName: "Sprint One",
            sprintNumber: 1,
            sprintRunId: "run-1",
            sprintRunStatus: "paused",
            activeDispatchCount: 0,
            runningDispatchCount: 0,
            updatedAt: null,
            humanIntervention: {
              title: "Merge Required",
              reason: "Approve the outstanding pull request before resuming.",
              instructions: "Review and merge the PR.",
              attentionType: "merge",
              severity: "high",
              ownerType: "human",
            },
          },
        ],
        recentEvents: [],
        updatedAt: null,
      } as OverviewTelemetrySnapshot,
      loading: false,
      error: null,
      refresh: refreshTelemetry,
    });

    render(
      <NotificationPanel
        unreadCount={0}
        notifications={[]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Merge Required")).toBeInTheDocument();
    expect(screen.getByText("Approve the outstanding pull request before resuming.")).toBeInTheDocument();

    const amberIcon = screen.getByText("Merge Required").closest("[data-notification-item]")?.querySelector(".text-status-amber");
    expect(amberIcon).toBeInTheDocument();
    expect(screen.queryByText("No notifications")).not.toBeInTheDocument();
  });
});
