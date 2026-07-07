/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/preact";
import { CalendarClock, HelpCircle } from "lucide-preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { NotificationPanel } from "../../../dashboard/src/v2/components/NotificationPanel.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d: any) => d,
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/lib/motion/constants.js", () => ({
  useGsapInteractionTokens: () => ({
    enterExit: { duration: 0, ease: "power2.out" },
    listReveal: { duration: 0, ease: "power2.out" },
    listReorder: { duration: 0, ease: "power2.out" },
  }),
}));

describe("NotificationPanel", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the intervention notification with amber icon styling and a jade unread accent", () => {
    render(
      <NotificationPanel
        notifications={[
          {
            id: "4",
            type: "intervention",
            severity: "warning",
            title: "Human Intervention Required",
            subtitle: "Task T01 in sprint SPR-10 requires manual decision.",
            time: "3m ago",
            unread: true,
            dismissible: true,
            icon: HelpCircle,
            iconColor: "text-status-amber",
          },
        ]}
        unreadCount={1}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText("Human Intervention Required")).toBeInTheDocument();
    expect(screen.getByText("Task T01 in sprint SPR-10 requires manual decision.")).toBeInTheDocument();
    expect(screen.getByText("3m ago")).toBeInTheDocument();

    const icon = screen.getByText("Human Intervention Required").closest("[data-notification-item]")?.querySelector("svg");
    expect(icon).toHaveClass("text-status-amber");

    const accent = screen.getByText("Human Intervention Required").closest("[data-notification-item]")?.querySelector(".bg-signal-500");
    expect(accent).toBeInTheDocument();
  });

  it("renders stacking UI rendering classes", () => {
    render(
      <NotificationPanel
        notifications={[]}
        unreadCount={0}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const panel = screen.getByLabelText("Notifications Panel");
    expect(panel).toHaveClass("flex");
    expect(panel).toHaveClass("flex-col");
    expect(screen.getByRole("list", { name: "Notifications list" })).toHaveAttribute("aria-busy", "false");
  });

  it("marks retry-style actions read and safely releases focus to the panel", () => {
    const onAction = vi.fn();
    const onMarkRead = vi.fn();
    render(
      <NotificationPanel
        notifications={[
          {
            id: "retry-1",
            severity: "critical",
            title: "Startup checks blocked",
            body: "Docker must be available before provider CLIs can run.",
            time: "now",
            unread: true,
            dismissible: false,
            icon: HelpCircle,
            actionLabel: "Retry",
            onAction,
          },
        ]}
        unreadCount={1}
        onMarkAllRead={vi.fn()}
        onMarkRead={onMarkRead}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const retry = screen.getByRole("button", { name: "Retry Startup checks blocked" });
    retry.focus();
    fireEvent.click(retry);

    expect(onMarkRead).toHaveBeenCalledWith("retry-1");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByLabelText("Notifications Panel"));
  });

  it("renders scheduler notification details while preserving critical precedence", () => {
    render(
      <NotificationPanel
        notifications={[
          {
            id: "scheduler-agent-entry-1",
            severity: "info",
            title: "Task run scheduled",
            body: "Retry blocked task. Task task-42 · codex. Scheduled for Jul 7, 09:00 AM. Status: scheduled.",
            time: "Scheduled",
            unread: true,
            dismissible: true,
            icon: CalendarClock,
          },
          {
            id: "startup-cluster-not-ready",
            severity: "critical",
            title: "Cluster not ready",
            body: "Docker must be available before containerized provider CLIs can run.",
            time: "just now",
            unread: true,
            dismissible: false,
            icon: HelpCircle,
          },
        ]}
        unreadCount={2}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const items = Array.from(document.querySelectorAll("[data-notification-item]"));
    expect(items[0]).toHaveTextContent("Cluster not ready");
    expect(items[1]).toHaveTextContent("Task run scheduled");
    expect(screen.getByText("Retry blocked task. Task task-42 · codex. Scheduled for Jul 7, 09:00 AM. Status: scheduled.")).toBeInTheDocument();
  });
});
