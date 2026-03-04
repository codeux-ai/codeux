import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootSettings, syncGitSettingsFromDashboard, type BootSettingsDeps } from "../../../../src/app/lifecycle/settings-lifecycle-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../src/repositories/settings-defaults.js";
import * as fs from "fs/promises";
import * as path from "path";
import os from "os";

vi.mock("fs/promises");
vi.mock("os");

describe("settings-lifecycle-service", () => {
  let mockDeps: BootSettingsDeps;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };

    vi.clearAllMocks();

    vi.mocked(os.homedir).mockReturnValue("/home/user");
    vi.spyOn(process, "cwd").mockReturnValue("/cwd");

    mockDeps = {
      runtimeContext: {
        settings: {
          maxFailures: 3,
          defaultBranch: "main",
          githubMode: false,
        },
        dashboardSettings: undefined,
      } as any,
      projectRoot: "/project-root",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      } as any,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("syncGitSettingsFromDashboard", () => {
    it("syncs git settings from default when dashboard settings are undefined", () => {
      syncGitSettingsFromDashboard(mockDeps.runtimeContext);

      expect(mockDeps.runtimeContext.settings.defaultBranch).toBe(DEFAULT_DASHBOARD_SETTINGS.git.defaultBranch);
      expect(mockDeps.runtimeContext.settings.githubMode).toBe(DEFAULT_DASHBOARD_SETTINGS.git.githubMode);
    });

    it("syncs git settings from existing dashboard settings", () => {
      mockDeps.runtimeContext.dashboardSettings = {
        git: {
          defaultBranch: "develop",
          githubMode: true,
        }
      } as any;

      syncGitSettingsFromDashboard(mockDeps.runtimeContext);

      expect(mockDeps.runtimeContext.settings.defaultBranch).toBe("develop");
      expect(mockDeps.runtimeContext.settings.githubMode).toBe(true);
    });
  });

  describe("bootSettings (and loadSettings)", () => {
    it("loads environment variables (JULES_API_MAX_FAILS)", async () => {
      process.env.JULES_API_MAX_FAILS = "5";

      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));

      await bootSettings(mockDeps);

      expect(mockDeps.runtimeContext.settings.maxFailures).toBe(5);
    });

    it("loads and merges settings.json files correctly in reverse order", async () => {
      const mockSettings1 = { JULES_API_MAX_FAILS: "10", someOtherSetting: "value1" };
      const mockSettings2 = { maxFailures: 15, someOtherSetting: "value2" };

      vi.mocked(fs.access).mockImplementation(async (filePath) => {
        if (filePath.toString().includes("project-root") || filePath.toString().includes("home/user")) {
          return Promise.resolve();
        }
        return Promise.reject(new Error("File not found"));
      });

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath.toString().includes("home/user")) {
          return JSON.stringify(mockSettings1);
        }
        if (filePath.toString().includes("project-root")) {
          return JSON.stringify(mockSettings2);
        }
        return "{}";
      });

      await bootSettings(mockDeps);

      // Home should load first (reverse order) and set maxFailures to 10.
      // Then project root should load and override maxFailures to 15.
      expect(mockDeps.runtimeContext.settings.maxFailures).toBe(15);
      expect((mockDeps.runtimeContext.settings as any).someOtherSetting).toBe("value2");

      expect(mockDeps.logger.info).toHaveBeenCalledWith(
        "Loaded settings",
        expect.objectContaining({ settingsPath: expect.stringContaining("home/user") })
      );
      expect(mockDeps.logger.info).toHaveBeenCalledWith(
        "Loaded settings",
        expect.objectContaining({ settingsPath: expect.stringContaining("project-root") })
      );
    });

    it("handles missing or invalid config files gracefully", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));

      await expect(bootSettings(mockDeps)).resolves.not.toThrow();

      expect(mockDeps.runtimeContext.settings.maxFailures).toBe(3); // unchanged

      // Valid path, invalid JSON
      vi.mocked(fs.access).mockResolvedValue();
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid json");

      await expect(bootSettings(mockDeps)).resolves.not.toThrow();
    });
  });
});
