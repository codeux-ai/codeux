/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import { HelpCircle } from "lucide-preact";
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
  useReducedMotion: () => true,
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
});
