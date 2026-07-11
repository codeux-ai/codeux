/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
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
    to: vi.fn((_target: unknown, options?: { onComplete?: () => void }) => options?.onComplete?.()),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d: any) => d,
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/lib/motion/constants.js", () => ({
  GSAP_INTERACTION_TOKENS: {
    controlFeedback: { duration: 0, ease: "power2.out" },
    enterExit: { duration: 0, ease: "power2.out" },
    expansionCollapse: { duration: 0, ease: "power2.out" },
    listReveal: { duration: 0, ease: "power2.out" },
    listReorder: { duration: 0, ease: "power2.out" },
    asyncFeedback: { duration: 0, ease: "power2.out" },
  },
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

  afterEach(() => {
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
    expect(screen.queryByRole("button", { name: /Details for/i })).not.toBeInTheDocument();
  });

  it("shows system-error details without inventing task context and uses the supplied project-aware action", async () => {
    const onMarkRead = vi.fn();
    const onNavigate = vi.fn();
    render(
      <NotificationPanel
        notifications={[{
          id: "system-error-1@2026-07-11T11:00:00.000Z",
          sourceId: "system-error-1",
          type: "system-error",
          severity: "critical",
          title: "Sprint runtime failed",
          body: "Sprint SPR-14 · Project Workspace — The runtime exited unexpectedly.",
          time: "just now",
          updatedAt: "2026-07-11T11:00:00.000Z",
          unread: true,
          dismissible: true,
          icon: HelpCircle,
          actionLabel: "Review error",
          actionHref: "/live?projectId=project-9&sprintId=sprint-14",
          details: [
            { label: "Project", value: "Workspace" },
            { label: "Sprint", value: "SPR-14 (Runtime recovery)" },
            { label: "What went wrong", value: "The runtime exited unexpectedly." },
            { label: "Why this needs attention", value: "The sprint cannot continue automatically." },
            { label: "Recommended next steps", value: "Inspect the runtime log and restart safely." },
            { label: "Timestamp", value: "2026-07-11T11:00:00.000Z" },
            { label: "Source context", value: "Sprint run event · Source event-9" },
          ],
        }]}
        unreadCount={1}
        onMarkAllRead={vi.fn()}
        onMarkRead={onMarkRead}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    const directLink = screen.getByRole("link", { name: "Review error Sprint runtime failed" });
    expect(directLink).toHaveAttribute("href", "/live?projectId=project-9&sprintId=sprint-14");
    fireEvent.click(directLink);
    expect(onMarkRead).toHaveBeenCalledWith("system-error-1@2026-07-11T11:00:00.000Z");
    expect(onNavigate).toHaveBeenCalledWith("/live?projectId=project-9&sprintId=sprint-14");

    fireEvent.click(screen.getByRole("button", { name: "Details for Sprint runtime failed" }));
    const modal = await screen.findByRole("dialog", { name: "Sprint runtime failed" });
    expect(modal).toHaveTextContent("Workspace");
    expect(modal).toHaveTextContent("SPR-14 (Runtime recovery)");
    expect(modal).not.toHaveTextContent("Task");
    expect(modal).toHaveTextContent("The sprint cannot continue automatically.");
    expect(screen.getByRole("link", { name: "Review error" })).toHaveAttribute(
      "href",
      "/live?projectId=project-9&sprintId=sprint-14",
    );
  });
});
