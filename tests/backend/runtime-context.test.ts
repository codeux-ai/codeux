import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi } from "vitest";
import { DefaultRuntimeContext } from "../../src/app/runtime-context.js";
import type { DashboardSettings, DashboardStatus, Settings } from "../../src/contracts/app-types.js";
import { restoreLeakedFakeTimers, withIsolatedTestHome } from "../setup/runtime-warning-filter.js";

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

describe("Vitest deterministic runtime setup", () => {
  it("pins timezone and locale-related process defaults", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(process.env.LANG).toBe("C.UTF-8");
    expect(process.env.LC_ALL).toBe("C.UTF-8");
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
    expect(new Date("2026-01-02T03:04:05.000Z").getHours()).toBe(3);
  });

  it("uses an isolated temp home by default", () => {
    const homeDir = os.homedir();

    expect(homeDir).toContain(`${path.sep}code-ux-vitest-home-`);
    expect(process.env.HOME).toBe(homeDir);
    expect(process.env.USERPROFILE).toBe(homeDir);
    expect(process.env.XDG_CONFIG_HOME).toBe(path.join(homeDir, ".config"));
    expect(process.env.XDG_STATE_HOME).toBe(path.join(homeDir, ".local", "state"));
    expect(process.env.XDG_CACHE_HOME).toBe(path.join(homeDir, ".cache"));
  });

  it("exposes a temp-home helper that restores HOME and USERPROFILE", async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    let helperHome = "";

    const result = await withIsolatedTestHome(async (homeDir) => {
      helperHome = homeDir;
      expect(os.homedir()).toBe(homeDir);
      expect(process.env.HOME).toBe(homeDir);
      expect(process.env.USERPROFILE).toBe(homeDir);
      expect(process.env.XDG_CONFIG_HOME).toBe(path.join(homeDir, ".config"));
      return "ok";
    });

    expect(result).toBe("ok");
    expect(process.env.HOME).toBe(originalHome);
    expect(process.env.USERPROFILE).toBe(originalUserProfile);
    expect(fs.existsSync(helperHome)).toBe(false);
  });

  it("detects and restores leaked fake timers", () => {
    vi.useFakeTimers();

    expect(restoreLeakedFakeTimers()).toBe(true);
    expect(vi.isFakeTimers()).toBe(false);
  });

  it("starts the next test with real timers after fake timer cleanup", () => {
    expect(vi.isFakeTimers()).toBe(false);
  });
});
