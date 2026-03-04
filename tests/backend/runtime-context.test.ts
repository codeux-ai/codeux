import { describe, it, expect } from "vitest";
import { DefaultRuntimeContext } from "../../src/app/runtime-context.js";
import type { DashboardSettings, DashboardStatus, Settings } from "../../src/contracts/app-types.js";

describe("DefaultRuntimeContext", () => {
  it("should initialize with default values", () => {
    const context = new DefaultRuntimeContext();
    expect(context.settings).toEqual({ maxFailures: 5 });
    expect(context.dashboardSettings).toBeUndefined();
    expect(context.consecutiveFailures).toBe(0);
    expect(context.lastStatus).toEqual({ subtasks: [], timestamp: null });
    expect(context.dashboardRuntimePort).toBeNull();
  });

  it("should update settings", () => {
    const context = new DefaultRuntimeContext();
    const newSettings: Settings = { maxFailures: 10, defaultBranch: "main" };
    context.settings = newSettings;
    expect(context.settings).toEqual(newSettings);
  });

  it("should update dashboardSettings", () => {
    const context = new DefaultRuntimeContext();
    const newDashboardSettings = {
      dashboardPort: 8080,
    } as DashboardSettings;
    context.dashboardSettings = newDashboardSettings;
    expect(context.dashboardSettings).toEqual(newDashboardSettings);
  });

  it("should update consecutiveFailures", () => {
    const context = new DefaultRuntimeContext();
    context.consecutiveFailures = 3;
    expect(context.consecutiveFailures).toBe(3);
  });

  it("should update lastStatus", () => {
    const context = new DefaultRuntimeContext();
    const newStatus: Partial<DashboardStatus> = { timestamp: "2023-01-01" };
    context.lastStatus = newStatus;
    expect(context.lastStatus).toEqual(newStatus);
  });

  it("should update dashboardRuntimePort", () => {
    const context = new DefaultRuntimeContext();
    context.dashboardRuntimePort = 3000;
    expect(context.dashboardRuntimePort).toBe(3000);
  });
});
