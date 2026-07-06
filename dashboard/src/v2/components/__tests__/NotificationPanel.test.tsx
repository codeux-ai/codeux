/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AlertTriangle, HelpCircle } from "lucide-preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationPanel } from "../NotificationPanel.js";
import type { DashboardNotification } from "../../hooks/use-notifications.js";

expect.extend(matchers);

const gsapMock = vi.hoisted(() => ({
  fromTo: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: {
    context: (cb: () => void) => {
      cb();
      return { revert: () => undefined };
    },
    fromTo: gsapMock.fromTo,
  },
}));

vi.mock("../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: () => 0,
}));

const makeNotification = (overrides: Partial<DashboardNotification> = {}): DashboardNotification => ({
  id: "startup-cluster-not-ready",
  severity: "critical",
  title: "Cluster not ready",
  body: "Docker daemon must be available before provider CLIs can run.",
  time: "just now",
  unread: true,
  dismissible: false,
  icon: AlertTriangle,
  ...overrides,
});

describe("NotificationPanel", () => {
  afterEach(() => {
    cleanup();
    gsapMock.fromTo.mockClear();
  });

  it("shows refresh pending state with aria-busy feedback", async () => {
    let resolveRefresh: () => void = () => undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));

    render(
      <NotificationPanel
        unreadCount={1}
        notifications={[makeNotification()]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Notifications Panel" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("list", { name: "Notifications list" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Refreshing notifications" })).toBeDisabled();
    expect(screen.getByText("Refreshing notifications")).toBeInTheDocument();

    resolveRefresh();

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Notifications Panel" })).toHaveAttribute("aria-busy", "false");
    });
  });

  it("explains why mark-all-read is disabled when there is nothing unread", () => {
    render(
      <NotificationPanel
        unreadCount={0}
        notifications={[makeNotification({ unread: false })]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const markAllRead = screen.getByRole("button", { name: "All notifications are already read" });
    expect(markAllRead).toBeDisabled();
    expect(screen.getByText("All notifications are already read")).toBeInTheDocument();
    expect(screen.getByLabelText("Read notification")).toBeInTheDocument();
  });

  it("keeps critical notifications discoverable in the live notification list until caller removal", () => {
    const onDismiss = vi.fn();

    render(
      <NotificationPanel
        unreadCount={1}
        notifications={[makeNotification({ dismissible: false })]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={onDismiss}
        onRefresh={vi.fn()}
      />,
    );

    const list = screen.getByRole("list", { name: "Notifications list" });
    expect(list).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Cluster not ready")).toBeInTheDocument();
    expect(screen.getByText("Docker daemon must be available before provider CLIs can run.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss Cluster not ready" })).not.toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps focus on the panel after dismissing an item that compacts out of the list", async () => {
    const onDismiss = vi.fn();
    let rerenderPanel: ReturnType<typeof render>["rerender"] = () => undefined;
    const { rerender } = render(
      <NotificationPanel
        unreadCount={1}
        notifications={[makeNotification({ dismissible: true })]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={(id) => {
          onDismiss(id);
          rerenderPanel(
            <NotificationPanel
              unreadCount={0}
              notifications={[]}
              onMarkAllRead={vi.fn()}
              onMarkRead={vi.fn()}
              onDismiss={onDismiss}
              onRefresh={vi.fn()}
            />,
          );
        }}
        onRefresh={vi.fn()}
      />,
    );
    rerenderPanel = rerender;

    const dismiss = screen.getByRole("button", { name: "Dismiss Cluster not ready" });
    dismiss.focus();
    fireEvent.click(dismiss);

    expect(onDismiss).toHaveBeenCalledWith("startup-cluster-not-ready");
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Notifications Panel" }));
    });
  });

  it("includes notification titles in repeated action accessible names", () => {
    render(
      <NotificationPanel
        unreadCount={2}
        notifications={[
          makeNotification({
            id: "blocked",
            title: "Startup checks blocked",
            actionLabel: "Retry",
            onAction: vi.fn(),
          }),
          makeNotification({
            id: "intervention",
            severity: "warning",
            title: "Human intervention required",
            actionLabel: "Open",
            onAction: vi.fn(),
            icon: HelpCircle,
          }),
        ]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry Startup checks blocked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Human intervention required" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark read Startup checks blocked" })).toBeInTheDocument();
  });

  it("suppresses duplicate mark-read activation while the row is pending", async () => {
    let resolveMarkRead: () => void = () => undefined;
    const onMarkRead = vi.fn(() => new Promise<void>((resolve) => {
      resolveMarkRead = resolve;
    }));

    render(
      <NotificationPanel
        unreadCount={1}
        notifications={[makeNotification({ title: "Startup checks blocked" })]}
        onMarkAllRead={vi.fn()}
        onMarkRead={onMarkRead}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const markRead = screen.getByRole("button", { name: "Mark read Startup checks blocked" });
    fireEvent.click(markRead);
    fireEvent.click(markRead);

    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Marking read Startup checks blocked" })).toBeDisabled();
    expect(screen.getAllByText("Marking read")).toHaveLength(2);

    resolveMarkRead();

    await waitFor(() => {
      expect(screen.getByRole("listitem")).toHaveAttribute("aria-busy", "false");
    });
  });

  it("compacts lists immediately under reduced motion while preserving critical items first", () => {
    const warning = makeNotification({
      id: "warning",
      severity: "warning",
      title: "Provider auth detected",
      dismissible: true,
      icon: HelpCircle,
    });
    const critical = makeNotification({
      id: "critical",
      title: "Cluster not ready",
      dismissible: false,
    });
    const { rerender } = render(
      <NotificationPanel
        unreadCount={2}
        notifications={[warning, critical]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    gsapMock.fromTo.mockClear();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent ?? "")[0]).toContain("Cluster not ready");

    rerender(
      <NotificationPanel
        unreadCount={1}
        notifications={[critical]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.queryByText("Provider auth detected")).not.toBeInTheDocument();
    expect(screen.getByText("Cluster not ready")).toBeInTheDocument();
    expect(gsapMock.fromTo).not.toHaveBeenCalled();
  });
});
