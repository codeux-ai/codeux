import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsActions } from "../../../src/mcp/management/settings-actions.js";
import type { SettingsRepository } from "../../../src/repositories/settings-repository.js";

describe("SettingsActions", () => {
  let settingsRepository: unknown;
  let actions: SettingsActions;

  beforeEach(() => {
    settingsRepository = {
      getSystemSettings: vi.fn().mockReturnValue({ defaults: { automationLevel: "FULL" } }),
      getProjectSettings: vi.fn().mockReturnValue({ automationLevel: "SEMI_AUTO" }),
      resolveProjectDashboardSettings: vi.fn().mockReturnValue({ settings: { level: "resolved_project" } }),
      getSprintSettings: vi.fn().mockReturnValue({ automationLevel: "MANUAL" }),
      resolveSprintDashboardSettings: vi.fn().mockReturnValue({ settings: { level: "resolved_sprint" } }),
      saveSystemSettings: vi.fn().mockImplementation((val) => val),
      saveProjectSettings: vi.fn().mockImplementation((id, val) => val),
      resetProjectSettings: vi.fn(),
      saveSprintSettings: vi.fn().mockImplementation((id, base, val) => val),
      resetSprintSettings: vi.fn(),
      getProjectResolvedSettings: vi.fn().mockReturnValue({}),
    };

    actions = new SettingsActions(settingsRepository as unknown as SettingsRepository);
  });

  it("handles getting system settings", async () => {
    const res = await actions.handleSettingsAction({ domain: "settings", action: "get_system", payload: {} });
    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "FULL" } } });
  });

  it("handles patching system settings without explicit approval", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel", value: "SEMI_AUTO" },
    });
    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "SEMI_AUTO" } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalled();
  });

  it("requires approval for replacing system settings", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "replace_system_settings",
      payload: { settings: {} },
    });
    expect(res.approvalRequired).toBe(true);
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("allows replacing system settings with explicit approval", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "replace_system_settings",
      payload: { settings: { defaults: { automationLevel: "MANUAL" } } },
      approval: { confirmed: true },
    });
    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "MANUAL" } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalled();
  });

  it("handles patching project settings", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_project_setting",
      payload: { projectId: "proj-1", path: "automationLevel", value: "AGENT" },
    });
    expect(res.result).toEqual({ settings: { automationLevel: "AGENT" } });
    expect(settingsRepository.saveProjectSettings).toHaveBeenCalledWith("proj-1", { automationLevel: "AGENT" });
  });

  it("requires approval for resetting project settings", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "reset_project_settings",
      payload: { projectId: "proj-1" },
    });
    expect(res.approvalRequired).toBe(true);
    expect(settingsRepository.resetProjectSettings).not.toHaveBeenCalled();
  });
});
