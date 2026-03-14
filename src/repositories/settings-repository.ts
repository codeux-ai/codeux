import type { DashboardSettings, ExternalSettingsHints } from "../contracts/app-types.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemSettings,
} from "../contracts/settings-scope-types.js";
import { SettingsDbStorage } from "./settings-db-storage.js";
import {
  buildDefaultProjectSettings,
  buildDefaultSystemSettings,
  resolveDashboardSettings,
  resolveProjectSettings,
  sanitizeSystemSettings,
  systemSettingsToDashboardSettings,
  toProjectSettingsOverride,
  toSprintSettingsOverride,
} from "../services/settings-resolution-service.js";

export class SettingsRepository {
  private readonly storage: SettingsDbStorage;
  private readonly externalHints: ExternalSettingsHints | undefined;

  constructor(dbPath?: string, externalHints?: ExternalSettingsHints) {
    this.storage = new SettingsDbStorage(dbPath);
    this.externalHints = externalHints;
  }

  getSystemSettings(): SystemSettings {
    this.migrateLegacySettingsIfNeeded();
    const payload = this.storage.readSystemPayload();
    if (!payload) {
      return buildDefaultSystemSettings(this.externalHints);
    }

    try {
      return sanitizeSystemSettings(JSON.parse(payload), this.externalHints);
    } catch {
      return buildDefaultSystemSettings(this.externalHints);
    }
  }

  saveSystemSettings(input: SystemSettings): SystemSettings {
    const normalized = sanitizeSystemSettings(input, this.externalHints);
    this.storage.writeSystemPayload(JSON.stringify(normalized));
    return normalized;
  }

  getProjectSettings(projectId: string): ProjectSettingsOverride {
    this.migrateLegacySettingsIfNeeded();
    const payload = this.storage.readProjectPayload(projectId);
    if (!payload) {
      return {};
    }

    try {
      return JSON.parse(payload) as ProjectSettingsOverride;
    } catch {
      return {};
    }
  }

  saveProjectSettings(projectId: string, patch: ProjectSettingsOverride): ProjectSettingsOverride {
    const base = this.getSystemSettings().defaults;
    const normalized = toProjectSettingsOverride(base, patch, this.externalHints);
    this.storage.writeProjectPayload(projectId, JSON.stringify(normalized));
    return normalized;
  }

  resetProjectSettings(projectId: string): void {
    this.storage.deleteProjectPayload(projectId);
  }

  getSprintSettings(sprintId: string): SprintSettingsOverride {
    this.migrateLegacySettingsIfNeeded();
    const payload = this.storage.readSprintPayload(sprintId);
    if (!payload) {
      return {};
    }

    try {
      return JSON.parse(payload) as SprintSettingsOverride;
    } catch {
      return {};
    }
  }

  saveSprintSettings(sprintId: string, baseProjectSettings: ProjectSettings, patch: SprintSettingsOverride): SprintSettingsOverride {
    const normalized = toSprintSettingsOverride(baseProjectSettings, patch, this.externalHints);
    this.storage.writeSprintPayload(sprintId, JSON.stringify(normalized));
    return normalized;
  }

  resetSprintSettings(sprintId: string): void {
    this.storage.deleteSprintPayload(sprintId);
  }

  resetAllData(): void {
    this.storage.resetAllData();
  }

  resolveProjectDashboardSettings(projectId: string): EffectiveSettingsResponse {
    return resolveDashboardSettings({
      systemSettings: this.getSystemSettings(),
      projectOverride: this.getProjectSettings(projectId),
    });
  }

  resolveSprintDashboardSettings(projectId: string, sprintId: string): EffectiveSettingsResponse {
    return resolveDashboardSettings({
      systemSettings: this.getSystemSettings(),
      projectOverride: this.getProjectSettings(projectId),
      sprintOverride: this.getSprintSettings(sprintId),
    });
  }

  getProjectResolvedSettings(projectId: string): ProjectSettings {
    return resolveProjectSettings(this.getSystemSettings(), this.getProjectSettings(projectId));
  }

  getDefaultDashboardSettings(): DashboardSettings {
    return systemSettingsToDashboardSettings(this.getSystemSettings());
  }

  private migrateLegacySettingsIfNeeded(): void {
    if (this.storage.readSystemPayload()) {
      return;
    }

    const legacyPayload = this.storage.readLegacyPayload();
    if (!legacyPayload) {
      return;
    }

    try {
      const legacySettings = JSON.parse(legacyPayload) as DashboardSettings;
      const defaults = buildDefaultProjectSettings(this.externalHints);
      const systemSettings = sanitizeSystemSettings({
        runtime: {
          dashboardPort: legacySettings.dashboardPort,
          enableDebugLogFile: legacySettings.enableDebugLogFile,
        },
        integrations: {
          julesApiKey: legacySettings.aiProvider?.providers?.jules?.apiKey || legacySettings.aiProvider?.julesApiKey || "",
          geminiApiKey: legacySettings.aiProvider?.providers?.gemini?.apiKey || "",
          codexApiKey: legacySettings.aiProvider?.providers?.codex?.apiKey || "",
          claudeCodeApiKey: legacySettings.aiProvider?.providers?.["claude-code"]?.apiKey || "",
          githubToken: legacySettings.git?.githubToken || "",
        },
        defaults: {
          automationLevel: legacySettings.automationLevel,
          automationInterventions: legacySettings.automationInterventions,
          aiProvider: {
            provider: legacySettings.aiProvider.provider,
            strategy: legacySettings.aiProvider.strategy,
            providers: {
              jules: {
                enabled: legacySettings.aiProvider.providers.jules.enabled,
                model: legacySettings.aiProvider.providers.jules.model,
                weight: legacySettings.aiProvider.providers.jules.weight,
                thinkingMode: legacySettings.aiProvider.providers.jules.thinkingMode,
              },
              gemini: {
                enabled: legacySettings.aiProvider.providers.gemini.enabled,
                model: legacySettings.aiProvider.providers.gemini.model,
                weight: legacySettings.aiProvider.providers.gemini.weight,
                thinkingMode: legacySettings.aiProvider.providers.gemini.thinkingMode,
              },
              codex: {
                enabled: legacySettings.aiProvider.providers.codex.enabled,
                model: legacySettings.aiProvider.providers.codex.model,
                weight: legacySettings.aiProvider.providers.codex.weight,
                thinkingMode: legacySettings.aiProvider.providers.codex.thinkingMode,
              },
              "claude-code": {
                enabled: legacySettings.aiProvider.providers["claude-code"].enabled,
                model: legacySettings.aiProvider.providers["claude-code"].model,
                weight: legacySettings.aiProvider.providers["claude-code"].weight,
                thinkingMode: legacySettings.aiProvider.providers["claude-code"].thinkingMode,
              },
            },
          },
          git: {
            githubMode: legacySettings.git.githubMode,
            defaultBranch: legacySettings.git.defaultBranch,
            autoCreatePr: legacySettings.git.autoCreatePr,
            featureBranchPrefix: legacySettings.git.featureBranchPrefix,
            sprintBranchScheme: legacySettings.git.sprintBranchScheme,
          },
          ciIntelligence: legacySettings.ciIntelligence,
          sprintLoopSteps: legacySettings.sprintLoopSteps,
          cliWorkflow: legacySettings.cliWorkflow,
          skills: legacySettings.skills || defaults.skills,
        },
        mcpTools: legacySettings.mcpTools,
      }, this.externalHints);

      this.storage.writeSystemPayload(JSON.stringify(systemSettings));
      this.storage.deleteLegacyPayload();
    } catch {
      // Ignore migration failures and fall back to new defaults.
    }
  }
}

export { DEFAULT_DASHBOARD_SETTINGS } from "./settings-defaults.js";
