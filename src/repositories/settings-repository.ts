import type { DashboardSettings, ExternalSettingsHints, VirtualWorkerProvider } from "../contracts/app-types.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemSettings,
} from "../contracts/settings-scope-types.js";
import { SettingsDbStorage } from "./settings-db-storage.js";
import { executeChunkedInQuery } from "./repository-utils.js";
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
import { DEFAULT_VIRTUAL_WORKER_MODELS } from "./settings-defaults.js";

export class SettingsRepository {
  private static systemSettingsCache: SystemSettings | null = null;
  private static hasMigratedLegacySettings = false;

  private readonly storage: SettingsDbStorage;
  private readonly externalHints: ExternalSettingsHints | undefined;

  constructor(dbPath?: string, externalHints?: ExternalSettingsHints) {
    this.storage = new SettingsDbStorage(dbPath);
    this.externalHints = externalHints;
  }

  getSystemSettings(): SystemSettings {
    if (!SettingsRepository.hasMigratedLegacySettings) {
      this.migrateLegacySettingsIfNeeded();
      SettingsRepository.hasMigratedLegacySettings = true;
    }

    if (SettingsRepository.systemSettingsCache) {
      return SettingsRepository.systemSettingsCache;
    }

    const payload = this.storage.readSystemPayload();
    if (!payload) {
      SettingsRepository.systemSettingsCache = buildDefaultSystemSettings(this.externalHints);
      return SettingsRepository.systemSettingsCache;
    }

    try {
      SettingsRepository.systemSettingsCache = sanitizeSystemSettings(JSON.parse(payload), this.externalHints);
      return SettingsRepository.systemSettingsCache;
    } catch {
      SettingsRepository.systemSettingsCache = buildDefaultSystemSettings(this.externalHints);
      return SettingsRepository.systemSettingsCache;
    }
  }

  saveSystemSettings(input: SystemSettings): SystemSettings {
    const normalized = sanitizeSystemSettings(input, this.externalHints);
    this.storage.writeSystemPayload(JSON.stringify(normalized));
    SettingsRepository.systemSettingsCache = normalized;
    return normalized;
  }

  getProjectSettings(projectId: string): ProjectSettingsOverride {
    if (!SettingsRepository.hasMigratedLegacySettings) {
      this.migrateLegacySettingsIfNeeded();
      SettingsRepository.hasMigratedLegacySettings = true;
    }
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

  getProjectSettingsBatch(projectIds: string[]): Map<string, ProjectSettingsOverride> {
    if (!SettingsRepository.hasMigratedLegacySettings) {
      this.migrateLegacySettingsIfNeeded();
      SettingsRepository.hasMigratedLegacySettings = true;
    }
    const result = new Map<string, ProjectSettingsOverride>();

    const rows = executeChunkedInQuery<{ project_id: string; payload: string }>(
      (sql) => this.storage.getCachedStatement(sql),
      {
        sqlPrefix: `
          SELECT project_id, payload
          FROM project_settings
          WHERE project_id
        `,
        items: projectIds,
      }
    );

    for (const row of rows) {
      try {
        result.set(row.project_id, JSON.parse(row.payload) as ProjectSettingsOverride);
      } catch {
        // Ignore
      }
    }

    // Ensure all requested projects have an entry (even if empty)
    for (const projectId of projectIds) {
      if (!result.has(projectId)) {
        result.set(projectId, {});
      }
    }

    return result;
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
    if (!SettingsRepository.hasMigratedLegacySettings) {
      this.migrateLegacySettingsIfNeeded();
      SettingsRepository.hasMigratedLegacySettings = true;
    }
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
    SettingsRepository.systemSettingsCache = null;
    SettingsRepository.hasMigratedLegacySettings = false;
  }

  createScopedResolver(): ScopedEffectiveSettingsResolver {
    return new ScopedEffectiveSettingsResolver(this);
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
          consoleLogLevel: legacySettings.consoleLogLevel,
        },
        integrations: {
          julesApiKey: legacySettings.aiProvider?.providers?.jules?.apiKey || "",
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
          workers: (() => {
            const legacyWorkers = legacySettings.workers || {};
            const provider = (legacyWorkers.virtualWorkerProvider || defaults.workers.virtualWorkerProvider) as VirtualWorkerProvider;
            return {
              ...defaults.workers,
              ...legacyWorkers,
              model: (legacyWorkers as { model?: string }).model
                || DEFAULT_VIRTUAL_WORKER_MODELS[provider]
                || defaults.workers.model,
            };
          })(),
          agents: legacySettings.agents || defaults.agents,
          skills: legacySettings.skills || defaults.skills,
        },
        mcpTools: legacySettings.mcpTools,
      }, this.externalHints);

      this.storage.writeSystemPayload(JSON.stringify(systemSettings));
      this.storage.deleteLegacyPayload();

      // Warm up the cache with the migrated settings
      SettingsRepository.systemSettingsCache = systemSettings;
    } catch {
      // Ignore migration failures and fall back to new defaults.
    }
  }
}

export class ScopedEffectiveSettingsResolver {
  private readonly repo: SettingsRepository;
  private systemSettingsCache: SystemSettings | null = null;
  private readonly projectSettingsCache = new Map<string, ProjectSettingsOverride>();
  private readonly sprintSettingsCache = new Map<string, SprintSettingsOverride>();
  private readonly projectResolvedCache = new Map<string, EffectiveSettingsResponse>();
  private readonly sprintResolvedCache = new Map<string, EffectiveSettingsResponse>();

  constructor(repo: SettingsRepository) {
    this.repo = repo;
  }

  getSystemSettings(): SystemSettings {
    if (!this.systemSettingsCache) {
      this.systemSettingsCache = this.repo.getSystemSettings();
    }
    return this.systemSettingsCache;
  }

  getProjectSettings(projectId: string): ProjectSettingsOverride {
    if (!this.projectSettingsCache.has(projectId)) {
      this.projectSettingsCache.set(projectId, this.repo.getProjectSettings(projectId));
    }
    return this.projectSettingsCache.get(projectId)!;
  }

  getSprintSettings(sprintId: string): SprintSettingsOverride {
    if (!this.sprintSettingsCache.has(sprintId)) {
      this.sprintSettingsCache.set(sprintId, this.repo.getSprintSettings(sprintId));
    }
    return this.sprintSettingsCache.get(sprintId)!;
  }

  resolveProjectDashboardSettings(projectId: string): EffectiveSettingsResponse {
    if (!this.projectResolvedCache.has(projectId)) {
      this.projectResolvedCache.set(
        projectId,
        resolveDashboardSettings({
          systemSettings: this.getSystemSettings(),
          projectOverride: this.getProjectSettings(projectId),
        })
      );
    }
    return this.projectResolvedCache.get(projectId)!;
  }

  resolveSprintDashboardSettings(projectId: string, sprintId: string): EffectiveSettingsResponse {
    const key = `${projectId}:${sprintId}`;
    if (!this.sprintResolvedCache.has(key)) {
      this.sprintResolvedCache.set(
        key,
        resolveDashboardSettings({
          systemSettings: this.getSystemSettings(),
          projectOverride: this.getProjectSettings(projectId),
          sprintOverride: this.getSprintSettings(sprintId),
        })
      );
    }
    return this.sprintResolvedCache.get(key)!;
  }
}

export { DEFAULT_DASHBOARD_SETTINGS } from "./settings-defaults.js";
