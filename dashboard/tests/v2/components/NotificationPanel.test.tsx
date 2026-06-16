/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AlertTriangle } from "lucide-preact";
import { NotificationPanel } from "../../../src/v2/components/NotificationPanel.js";

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

describe("NotificationPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders startup notifications and exposes actions", () => {
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

    expect(screen.getByLabelText("Notifications Panel")).toBeInTheDocument();
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
});
