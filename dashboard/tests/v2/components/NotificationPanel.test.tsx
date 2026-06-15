/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, useRef, useEffect } from "preact/hooks";
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

  it("renders empty state correctly", () => {
    const { getByText } = render(
      <NotificationPanel
        unreadCount={0}
        notifications={[]}
        onMarkAllRead={vi.fn()}
        onMarkRead={vi.fn()}
        onDismiss={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    expect(getByText("No notifications")).toBeInTheDocument();
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

    expect(screen.getByRole("dialog", { name: "Notifications Panel" })).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument(); // Unread indicator
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

    it("handles trigger ARIA wiring, Escape close, and focus restoration", async () => {
    // We simulate the TopNav wiring
    const Wrapper = () => {
      const [isOpen, setIsOpen] = useState(false);
      const containerRef = useRef<HTMLDivElement>(null);

      useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === "Escape" && isOpen) {
            setIsOpen(false);
            const triggerBtn = document.getElementById("notification-trigger");
            setTimeout(() => triggerBtn?.focus(), 0);
          }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
      }, [isOpen]);

      return (
        <div ref={containerRef}>
          <button
            id="notification-trigger"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-controls="notification-panel"
            onClick={() => setIsOpen(!isOpen)}
          >
            Trigger
          </button>
          {isOpen && (
            <NotificationPanel
              unreadCount={0}
              notifications={[]}
              onMarkAllRead={vi.fn()}
              onMarkRead={vi.fn()}
              onDismiss={vi.fn()}
              onRefresh={vi.fn()}
            />
          )}
        </div>
      );
    };

    render(<Wrapper />);
    const trigger = screen.getByRole("button", { name: "Trigger" });

    // Initial state
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Open panel
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const dialog = screen.getByRole("dialog", { name: "Notifications Panel" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("id", "notification-panel");
    expect(trigger).toHaveAttribute("aria-controls", "notification-panel");

    // Close via Escape
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Notifications Panel" })).not.toBeInTheDocument();

    // Wait for focus restoration
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(trigger);
  });
});
