import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles getting system settings", async () => {
    const res = await actions.handleSettingsAction({ domain: "settings", action: "get_system", payload: {} });
    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "FULL" } } });
  });

  it("requires human approval before patching system settings", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel", value: "SEMI_AUTO" },
    });
    expect(res.approvalRequired).toBe(true);
    expect(res.approvalMessage).toContain("DO NOT call this settings endpoint again");
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("does not let approval.confirmed bypass the first settings mutation call", async () => {
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel", value: "SEMI_AUTO" },
      approval: { confirmed: true },
    });
    expect(res.approvalRequired).toBe(true);
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("executes a settings patch only after the same payload is confirmed", async () => {
    const payload = { path: "defaults.automationLevel", value: "SEMI_AUTO" };

    await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
    });
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
      approval: { confirmed: true },
    });

    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "SEMI_AUTO" } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("does not replay a consumed settings approval", async () => {
    const payload = { path: "defaults.automationLevel", value: "SEMI_AUTO" };

    await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload });
    await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload, approval: { confirmed: true } });
    const replay = await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload, approval: { confirmed: true } });

    expect(replay.approvalRequired).toBe(true);
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a settings approval for a different payload", async () => {
    await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel", value: "SEMI_AUTO" },
    });
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel", value: "MANUAL" },
      approval: { confirmed: true },
    });

    expect(res.approvalRequired).toBe(true);
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("keeps concurrent pending settings approvals independent by fingerprint", async () => {
    const firstPayload = { path: "defaults.automationLevel", value: "SEMI_AUTO" };
    const secondPayload = { path: "defaults.automationLevel", value: "MANUAL" };

    await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload: firstPayload });
    await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload: secondPayload });

    const second = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: secondPayload,
      approval: { confirmed: true },
    });
    const first = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: firstPayload,
      approval: { confirmed: true },
    });

    expect(second.result).toEqual({ settings: { defaults: { automationLevel: "MANUAL" } } });
    expect(first.result).toEqual({ settings: { defaults: { automationLevel: "SEMI_AUTO" } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalledTimes(2);
  });

  it("requires a new approval when array value order changes", async () => {
    const payload = { path: "defaults.enabledProviders", value: ["codex", "gemini"] };

    await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload });
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.enabledProviders", value: ["gemini", "codex"] },
      approval: { confirmed: true },
    });

    expect(res.approvalRequired).toBe(true);
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("distinguishes missing and null setting values in approval fingerprints", async () => {
    const payload = { path: "defaults.model", value: null };

    await actions.handleSettingsAction({ domain: "settings", action: "patch_system_setting", payload });
    await expect(actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.model" },
      approval: { confirmed: true },
    })).rejects.toThrow("value is required");

    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
      approval: { confirmed: true },
    });

    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "FULL", model: null } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("expires pending settings approvals after 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T10:00:00Z"));
    const payload = { path: "defaults.automationLevel", value: "SEMI_AUTO" };

    await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
    });

    vi.setSystemTime(new Date("2026-06-08T10:16:00Z"));

    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
      approval: { confirmed: true },
    });

    expect(res.approvalRequired).toBe(true);
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("rejects settings patches without a value", async () => {
    await expect(actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload: { path: "defaults.automationLevel" },
    })).rejects.toThrow("value is required");
    expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("preserves explicit null patch values after confirmation", async () => {
    const payload = { path: "defaults.automationLevel", value: null };

    await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
    });
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_system_setting",
      payload,
      approval: { confirmed: true },
    });

    expect(res.result).toEqual({ settings: { defaults: { automationLevel: null } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalledWith({ defaults: { automationLevel: null } });
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

  it("allows replacing system settings with explicit approval after a pending request exists", async () => {
    const payload = { settings: { defaults: { automationLevel: "MANUAL" } } };
    await actions.handleSettingsAction({
      domain: "settings",
      action: "replace_system_settings",
      payload,
    });
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "replace_system_settings",
      payload,
      approval: { confirmed: true },
    });
    expect(res.result).toEqual({ settings: { defaults: { automationLevel: "MANUAL" } } });
    expect(settingsRepository.saveSystemSettings).toHaveBeenCalled();
  });

  it("patches project settings after confirmation", async () => {
    const payload = { projectId: "proj-1", path: "automationLevel", value: "AGENT" };
    await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_project_setting",
      payload,
    });
    const res = await actions.handleSettingsAction({
      domain: "settings",
      action: "patch_project_setting",
      payload,
      approval: { confirmed: true },
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

  const confirm = async (action: string, payload: Record<string, unknown>) => {
    await actions.handleSettingsAction({ domain: "settings", action, payload } as any);
    return actions.handleSettingsAction({ domain: "settings", action, payload: { ...payload, approval: { confirmed: true } }, approval: { confirmed: true } } as any);
  };

  describe("read actions", () => {
    it("returns the project override", async () => {
      const res = await actions.handleSettingsAction({ domain: "settings", action: "get_project_override", payload: { projectId: "proj-1" } });
      expect(settingsRepository.getProjectSettings).toHaveBeenCalledWith("proj-1");
      expect((res.result as any).override).toEqual({ automationLevel: "SEMI_AUTO" });
    });

    it("resolves project effective settings", async () => {
      const res = await actions.handleSettingsAction({ domain: "settings", action: "resolve_project_effective", payload: { projectId: "proj-1" } });
      expect(settingsRepository.resolveProjectDashboardSettings).toHaveBeenCalledWith("proj-1");
      expect((res.result as any).settings).toEqual({ settings: { level: "resolved_project" } });
    });

    it("returns the sprint override", async () => {
      const res = await actions.handleSettingsAction({ domain: "settings", action: "get_sprint_override", payload: { sprintId: "sprint-1" } });
      expect(settingsRepository.getSprintSettings).toHaveBeenCalledWith("sprint-1");
      expect((res.result as any).override).toEqual({ automationLevel: "MANUAL" });
    });

    it("resolves sprint effective settings", async () => {
      const res = await actions.handleSettingsAction({ domain: "settings", action: "resolve_sprint_effective", payload: { projectId: "proj-1", sprintId: "sprint-1" } });
      expect(settingsRepository.resolveSprintDashboardSettings).toHaveBeenCalledWith("proj-1", "sprint-1");
      expect((res.result as any).settings).toEqual({ settings: { level: "resolved_sprint" } });
    });

    it("throws when a required string is missing", async () => {
      await expect(
        actions.handleSettingsAction({ domain: "settings", action: "get_project_override", payload: {} }),
      ).rejects.toThrow(/projectId is required/);
    });
  });

  describe("remaining mutations (after confirmation)", () => {
    it("replaces project settings", async () => {
      const res = await confirm("replace_project_settings", { projectId: "proj-1", settings: { automationLevel: "FULL" } });
      expect(settingsRepository.saveProjectSettings).toHaveBeenCalledWith("proj-1", { automationLevel: "FULL" });
      expect((res.result as any).settings).toEqual({ automationLevel: "FULL" });
    });

    it("replaces sprint settings using resolved project settings as the base", async () => {
      const res = await confirm("replace_sprint_settings", { projectId: "proj-1", sprintId: "sprint-1", settings: { automationLevel: "MANUAL" } });
      expect(settingsRepository.getProjectResolvedSettings).toHaveBeenCalledWith("proj-1");
      expect(settingsRepository.saveSprintSettings).toHaveBeenCalledWith("sprint-1", {}, { automationLevel: "MANUAL" });
      expect((res.result as any).settings).toEqual({ automationLevel: "MANUAL" });
    });

    it("patches a sprint setting", async () => {
      const res = await confirm("patch_sprint_setting", { projectId: "proj-1", sprintId: "sprint-1", path: "automationLevel", value: "SEMI_AUTO" });
      expect(settingsRepository.saveSprintSettings).toHaveBeenCalled();
      expect((res.result as any).settings).toBeDefined();
    });

    it("resets sprint settings", async () => {
      const res = await confirm("reset_sprint_settings", { sprintId: "sprint-1" });
      expect(settingsRepository.resetSprintSettings).toHaveBeenCalledWith("sprint-1");
      expect((res.result as any).success).toBe(true);
    });
  });

  describe("validation", () => {
    it("rejects replace_system_settings without a settings object", async () => {
      await expect(
        actions.handleSettingsAction({ domain: "settings", action: "replace_system_settings", payload: {} }),
      ).rejects.toThrow(/settings object is required/);
    });

    it("rejects replace_system_settings with an invalid settings object type", async () => {
      await expect(
        actions.handleSettingsAction({ domain: "settings", action: "replace_system_settings", payload: { settings: [] } }),
      ).rejects.toThrow(/settings object is required/);
      expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
    });

    it("rejects replace_project_settings without a settings object", async () => {
      await expect(
        actions.handleSettingsAction({ domain: "settings", action: "replace_project_settings", payload: { projectId: "p" } }),
      ).rejects.toThrow(/settings object is required/);
    });

    it("rejects replace_sprint_settings without a settings object", async () => {
      await expect(
        actions.handleSettingsAction({ domain: "settings", action: "replace_sprint_settings", payload: { projectId: "p", sprintId: "s" } }),
      ).rejects.toThrow(/settings object is required/);
    });

    it("throws on an unknown settings action", async () => {
      await expect(
        actions.handleSettingsAction({ domain: "settings", action: "frobnicate", payload: {} } as any),
      ).rejects.toThrow(/Unknown settings action: frobnicate/);
    });
  });

  describe("settings bundles", () => {
    beforeEach(() => {
      vi.mocked((settingsRepository as any).getSystemSettings).mockReturnValue({
        runtime: { dashboardPort: 4444 },
        integrations: {
          providers: {
            codex: { provider: "codex", name: "Codex", apiKey: "sk-system-secret", authType: "apiKey" },
          },
          githubToken: "ghp-system-secret",
          gitlabToken: "",
          jira: { apiToken: "" },
        },
        defaults: { automationLevel: "FULL" },
        mcpTools: [],
        customMcpServers: [],
        modelPricing: { overrides: {} },
      });
      vi.mocked((settingsRepository as any).getProjectSettings).mockReturnValue({
        automationLevel: "SEMI_AUTO",
        git: { githubToken: "ghp-project-secret" },
      });
      vi.mocked((settingsRepository as any).getSprintSettings).mockReturnValue({
        automationLevel: "MANUAL",
        jira: { apiToken: "jira-sprint-secret" },
      });
    });

    it("exports a redacted system bundle without approval by default", async () => {
      const res = await actions.handleSettingsAction({
        domain: "settings",
        action: "export_settings_bundle",
        payload: {},
      });

      expect(res.approvalRequired).toBeUndefined();
      const bundle = (res.result as any).bundle;
      expect(bundle.metadata.schemaVersion).toBe(1);
      expect(bundle.metadata.includedScopes).toEqual(["system"]);
      expect(bundle.metadata.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(bundle.metadata.containsSecrets).toBe(true);
      expect(bundle.system.integrations.providers.codex.apiKey).toBe("[REDACTED]");
      expect(bundle.system.integrations.githubToken).toBe("[REDACTED]");
    });

    it("requires one-use approval before exporting secrets", async () => {
      const payload = { includeSecrets: true };

      const first = await actions.handleSettingsAction({ domain: "settings", action: "export_settings_bundle", payload });
      expect(first.approvalRequired).toBe(true);

      const approved = await actions.handleSettingsAction({
        domain: "settings",
        action: "export_settings_bundle",
        payload,
        approval: { confirmed: true },
      });
      expect((approved.result as any).bundle.system.integrations.providers.codex.apiKey).toBe("sk-system-secret");

      const replay = await actions.handleSettingsAction({
        domain: "settings",
        action: "export_settings_bundle",
        payload,
        approval: { confirmed: true },
      });
      expect(replay.approvalRequired).toBe(true);
    });

    it("applies a complete secret-bearing bundle only after approval", async () => {
      const bundle = {
        metadata: {
          schemaVersion: 1,
          exportedAt: "2026-07-07T00:00:00.000Z",
          includedScopes: ["system", "projects", "sprints"],
          fingerprint: "fp",
          containsSecrets: true,
        },
        system: {
          integrations: {
            providers: { codex: { provider: "codex", name: "Codex", apiKey: "sk-imported" } },
            githubToken: "ghp-imported",
            jira: { apiToken: "jira-imported" },
          },
          defaults: { automationLevel: "FULL" },
          runtime: {},
          mcpTools: [],
          customMcpServers: [],
          modelPricing: { overrides: {} },
        },
        projects: [{ projectId: "proj-1", settings: { automationLevel: "FULL" } }],
        sprints: [{ projectId: "proj-1", sprintId: "sprint-1", settings: { automationLevel: "SEMI_AUTO" } }],
      };
      const payload = { bundle };

      const first = await actions.handleSettingsAction({ domain: "settings", action: "apply_settings_bundle", payload });
      expect(first.approvalRequired).toBe(true);
      expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();

      const approved = await actions.handleSettingsAction({
        domain: "settings",
        action: "apply_settings_bundle",
        payload,
        approval: { confirmed: true },
      });

      expect((approved.result as any).applied).toEqual({ system: 1, projects: 1, sprints: 1 });
      expect(settingsRepository.saveSystemSettings).toHaveBeenCalledWith(bundle.system);
      expect(settingsRepository.saveProjectSettings).toHaveBeenCalledWith("proj-1", { automationLevel: "FULL" });
      expect(settingsRepository.getProjectResolvedSettings).toHaveBeenCalledWith("proj-1");
      expect(settingsRepository.saveSprintSettings).toHaveBeenCalledWith("sprint-1", {}, { automationLevel: "SEMI_AUTO" });
    });

    it("applies only requested partial bundle scopes", async () => {
      const bundle = {
        metadata: {
          schemaVersion: 1,
          exportedAt: "2026-07-07T00:00:00.000Z",
          includedScopes: ["system", "projects"],
          fingerprint: "fp",
          containsSecrets: false,
        },
        system: { defaults: { automationLevel: "FULL" } },
        projects: [{ projectId: "proj-1", settings: { automationLevel: "MANUAL" } }],
      };

      const res = await actions.handleSettingsAction({
        domain: "settings",
        action: "apply_settings_bundle",
        payload: { bundle, scopes: ["projects"] },
      });

      expect((res.result as any).applied).toEqual({ system: 0, projects: 1, sprints: 0 });
      expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
      expect(settingsRepository.saveProjectSettings).toHaveBeenCalledWith("proj-1", { automationLevel: "MANUAL" });
    });

    it("rejects malformed bundle payloads before persistence", async () => {
      await expect(actions.handleSettingsAction({
        domain: "settings",
        action: "apply_settings_bundle",
        payload: { bundle: { metadata: { schemaVersion: 2 } } },
      })).rejects.toThrow(/schemaVersion must be 1/);
      expect(settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
    });

    it("does not include secret values in validation errors", async () => {
      const secret = "ghp-leaked-secret";
      await expect(actions.handleSettingsAction({
        domain: "settings",
        action: "apply_settings_bundle",
        payload: {
          bundle: {
            metadata: { schemaVersion: 1, includedScopes: ["projects"], fingerprint: "fp", containsSecrets: true },
            projects: [{ projectId: "proj-1", settings: "bad", githubToken: secret }],
          },
        },
      })).rejects.not.toThrow(secret);
    });
  });
});
