/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import { HelpCircle } from "lucide-preact";
import { useNotifications } from "../../../dashboard/src/v2/hooks/use-notifications.js";
import * as dashboardApi from "../../../dashboard/src/lib/api/dashboard-api.js";

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

describe("useNotifications", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
});
