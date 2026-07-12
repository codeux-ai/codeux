import type { DashboardSettings, ExternalSettingsHints, VirtualWorkerProvider } from "../contracts/app-types.js";
import type { OnboardingStateRecord } from "../domain/user/onboarding-state.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemSettings,
} from "../contracts/settings-scope-types.js";
import { SettingsDbStorage } from "./settings-db-storage.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { executeChunkedInQuery } from "./repository-utils.js";
import {
  buildDefaultProjectSettings,
  buildDefaultSystemSettings,
  SettingsResolutionCache,
  resolveDashboardSettings,
  sanitizeSystemSettings,
  toProjectSettingsOverride,
  toSprintSettingsOverride,
} from "../services/settings-resolution-service.js";
import { DEFAULT_VIRTUAL_WORKER_MODELS } from "./settings-defaults.js";
import {
  DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
  LOCAL_TRANSCRIPTION_MODEL_IDS,
} from "../contracts/speech-types.js";
import { redactSettingsCredentialValues } from "../domain/settings/settings-sanitizers/credential-reference-sanitizer.js";

const LOCAL_TRANSCRIPTION_MODEL_ID_SET = new Set<string>(LOCAL_TRANSCRIPTION_MODEL_IDS);

const LEGACY_DEFAULT_GUARDRAIL_SHAPE = {
  enabled: true,
  perTaskTotalCeiling: 0,
  jobs: {
    task_coding: { cap: 8, onLimit: "BLOCK_AND_ESCALATE" },
    ci_fix: { cap: 3, onLimit: "BLOCK_AND_ESCALATE" },
    merge_conflict: { cap: 5, onLimit: "BLOCK_AND_ESCALATE" },
    clarification_reply: { cap: 3, onLimit: "STOP_AND_WAIT" },
    planning: { cap: 5, onLimit: "BLOCK_AND_ESCALATE" },
    remediation: { cap: 2, onLimit: "BLOCK_AND_ESCALATE" },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesLegacyDefaultGuardrails(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.jobs)) {
    return false;
  }
  const expected = LEGACY_DEFAULT_GUARDRAIL_SHAPE;
  if (value.enabled !== expected.enabled || value.perTaskTotalCeiling !== expected.perTaskTotalCeiling) {
    return false;
  }
  const jobs = value.jobs;
  return Object.entries(expected.jobs).every(([purpose, expectedPolicy]) => {
    const policy = jobs[purpose];
    return isRecord(policy)
      && policy.cap === expectedPolicy.cap
      && policy.onLimit === expectedPolicy.onLimit;
  });
}

/**
 * Advances only the complete, historical default guardrail profile. Matching
 * every policy protects intentional custom values (including a deliberate 8
 * or 3) from being rewritten during startup.
 */
function migrateLegacyDefaultAttemptCaps(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.defaults) || !matchesLegacyDefaultGuardrails(value.defaults.guardrails)) {
    return false;
  }
  const guardrails = value.defaults.guardrails as Record<string, unknown>;
  const jobs = guardrails.jobs as Record<string, Record<string, unknown>>;
  jobs.task_coding.cap = 5;
  jobs.ci_fix.cap = 5;

  const ciIntelligence = value.defaults.ciIntelligence;
  if (isRecord(ciIntelligence) && ciIntelligence.julesCiAutofixMaxRetries === 3) {
    ciIntelligence.julesCiAutofixMaxRetries = 5;
  }
  return true;
}

function migrateRemovedLocalTranscriptionModel(value: unknown, systemScope: boolean): boolean {
  if (!isRecord(value)) return false;
  const settings = systemScope && isRecord(value.defaults) ? value.defaults : value;
  if (!isRecord(settings) || !isRecord(settings.speech)) return false;
  const modelId = settings.speech.localModelId;
  if (typeof modelId !== "string" || LOCAL_TRANSCRIPTION_MODEL_ID_SET.has(modelId.trim())) return false;
  settings.speech.localModelId = DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID;
  return true;
}

export class SettingsRepository {
  private static systemSettingsCache: SystemSettings | null = null;
  private static hasMigratedLegacySettings = false;
  private static resolutionRevision = 0;

  private readonly storage: SettingsDbStorage;
  private readonly externalHints: ExternalSettingsHints | undefined;
  private readonly resolutionCache = new SettingsResolutionCache();
  private resolutionCacheRevision = SettingsRepository.resolutionRevision;

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
      const parsed = JSON.parse(payload) as unknown;
      const migratedAttemptCaps = migrateLegacyDefaultAttemptCaps(parsed);
      const migratedSpeechModel = migrateRemovedLocalTranscriptionModel(parsed, true);
      if (migratedAttemptCaps || migratedSpeechModel) {
        this.storage.writeSystemPayload(JSON.stringify(parsed));
        // Other repository/scoped-resolver instances may already have resolved
        // the historical defaults during startup. Advance the shared revision
        // so they cannot keep serving 8/3 after the persisted migration wrote
        // the new 5/5 profile.
        this.invalidateResolutionCache();
      }
      SettingsRepository.systemSettingsCache = sanitizeSystemSettings(parsed, this.externalHints);
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
    this.invalidateResolutionCache();
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
      const parsed = JSON.parse(payload) as unknown;
      if (migrateRemovedLocalTranscriptionModel(parsed, false)) {
        this.storage.writeProjectPayload(projectId, JSON.stringify(parsed));
        this.invalidateResolutionCache();
      }
      return redactSettingsCredentialValues(parsed as ProjectSettingsOverride);
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
        const parsed = JSON.parse(row.payload) as unknown;
        if (migrateRemovedLocalTranscriptionModel(parsed, false)) {
          this.storage.writeProjectPayload(row.project_id, JSON.stringify(parsed));
          this.invalidateResolutionCache();
        }
        result.set(row.project_id, redactSettingsCredentialValues(parsed as ProjectSettingsOverride));
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
    const systemSettings = this.getSystemSettings();
    const base = systemSettings.defaults;
    const normalized = toProjectSettingsOverride(base, patch, systemSettings.integrations, this.externalHints);
    this.storage.writeProjectPayload(projectId, JSON.stringify(normalized));
    this.invalidateResolutionCache();
    return normalized;
  }

  resetProjectSettings(projectId: string): void {
    this.storage.deleteProjectPayload(projectId);
    this.invalidateResolutionCache();
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
      const parsed = JSON.parse(payload) as unknown;
      if (migrateRemovedLocalTranscriptionModel(parsed, false)) {
        this.storage.writeSprintPayload(sprintId, JSON.stringify(parsed));
        this.invalidateResolutionCache();
      }
      return redactSettingsCredentialValues(parsed as SprintSettingsOverride);
    } catch {
      return {};
    }
  }

  saveSprintSettings(sprintId: string, baseProjectSettings: ProjectSettings, patch: SprintSettingsOverride): SprintSettingsOverride {
    const systemSettings = this.getSystemSettings();
    const normalized = toSprintSettingsOverride(baseProjectSettings, patch, systemSettings.integrations, this.externalHints);
    this.storage.writeSprintPayload(sprintId, JSON.stringify(normalized));
    this.invalidateResolutionCache();
    return normalized;
  }

  resetSprintSettings(sprintId: string): void {
    this.storage.deleteSprintPayload(sprintId);
    this.invalidateResolutionCache();
  }

  resetAllData(): void {
    this.storage.resetAllData();
    SettingsRepository.systemSettingsCache = null;
    SettingsRepository.hasMigratedLegacySettings = false;
    this.invalidateResolutionCache();
  }

  createScopedResolver(): ScopedEffectiveSettingsResolver {
    return new ScopedEffectiveSettingsResolver(this);
  }

  resolveProjectDashboardSettings(projectId: string): EffectiveSettingsResponse {
    return this.resolutionCache.getProjectDashboardSettings(
      this.getActiveResolutionRevision(),
      projectId,
      () => ({
        systemSettings: this.getSystemSettings(),
        projectOverride: this.getProjectSettings(projectId),
      }),
    );
  }

  resolveSprintDashboardSettings(projectId: string, sprintId: string): EffectiveSettingsResponse {
    return this.resolutionCache.getSprintDashboardSettings(
      this.getActiveResolutionRevision(),
      projectId,
      sprintId,
      () => ({
        systemSettings: this.getSystemSettings(),
        projectOverride: this.getProjectSettings(projectId),
        sprintOverride: this.getSprintSettings(sprintId),
      }),
    );
  }

  getProjectResolvedSettings(projectId: string): ProjectSettings {
    return this.resolutionCache.getProjectSettings(
      this.getActiveResolutionRevision(),
      projectId,
      () => ({
        systemSettings: this.getSystemSettings(),
        projectOverride: this.getProjectSettings(projectId),
      }),
    );
  }

  getDefaultDashboardSettings(): DashboardSettings {
    return this.resolutionCache.getSystemDashboardSettings(
      this.getActiveResolutionRevision(),
      this.getSystemSettings(),
    ).settings;
  }

  getOnboardingState(): OnboardingStateRecord {
    return {
      onboardingCompletedAt: this.storage.readOnboardingCompletedAt(),
    };
  }

  markOnboardingCompleted(completedAt?: string): OnboardingStateRecord {
    const nextCompletedAt = completedAt || new Date().toISOString();
    this.storage.writeOnboardingCompletedAt(nextCompletedAt);
    return { onboardingCompletedAt: nextCompletedAt };
  }

  resetOnboardingState(): OnboardingStateRecord {
    this.storage.clearOnboardingCompletedAt();
    return { onboardingCompletedAt: null };
  }

  getDatabase(): DatabaseAdapter {
    return this.storage.getDatabase();
  }

  /** Raw access is intentionally limited to the one-way credential migration. */
  getCredentialMigrationRecords(): Array<{
    scope: "system" | "project" | "sprint";
    scopeId: string | null;
    payload: string;
  }> {
    const db = this.storage.getDatabase();
    const system = db.prepare("SELECT payload FROM system_settings WHERE id = 1").get() as { payload: string } | undefined;
    const projects = db.prepare("SELECT project_id AS scope_id, payload FROM project_settings").all() as Array<{ scope_id: string; payload: string }>;
    const sprints = db.prepare("SELECT sprint_id AS scope_id, payload FROM sprint_settings").all() as Array<{ scope_id: string; payload: string }>;
    return [
      { scope: "system", scopeId: null, payload: system?.payload ?? "{}" },
      ...projects.map((row) => ({ scope: "project" as const, scopeId: row.scope_id, payload: row.payload })),
      ...sprints.map((row) => ({ scope: "sprint" as const, scopeId: row.scope_id, payload: row.payload })),
    ];
  }

  replaceCredentialMigrationRecord(
    scope: "system" | "project" | "sprint",
    scopeId: string | null,
    payload: string,
  ): void {
    if (scope === "system") this.storage.writeSystemPayload(payload);
    else if (scope === "project" && scopeId) this.storage.writeProjectPayload(scopeId, payload);
    else if (scope === "sprint" && scopeId) this.storage.writeSprintPayload(scopeId, payload);
    else throw new Error("Credential migration record has an invalid scope identifier.");
    SettingsRepository.systemSettingsCache = null;
    this.invalidateResolutionCache();
  }

  close(): void {
    this.storage.close();
  }

  getSettingsResolutionRevision(): number {
    return SettingsRepository.resolutionRevision;
  }

  private invalidateResolutionCache(): void {
    SettingsRepository.resolutionRevision += 1;
    this.resolutionCacheRevision = SettingsRepository.resolutionRevision;
    this.resolutionCache.clear();
  }

  private getActiveResolutionRevision(): number {
    if (this.resolutionCacheRevision !== SettingsRepository.resolutionRevision) {
      this.resolutionCacheRevision = SettingsRepository.resolutionRevision;
      this.resolutionCache.clear();
    }
    return this.resolutionCacheRevision;
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
      const legacySettings = JSON.parse(legacyPayload) as DashboardSettings & {
        enableDebugLogFile?: boolean;
        consoleLogLevel?: unknown;
      };
      const defaults = buildDefaultProjectSettings(this.externalHints);
      const systemSettings = sanitizeSystemSettings({
        runtime: {
          dashboardPort: legacySettings.dashboardPort,
          debugLogFileLevel: legacySettings.enableDebugLogFile ? "error" : "off",
          consoleLogLevel: legacySettings.consoleLogLevel,
          consoleLogMode: legacySettings.consoleLogLevel,
        },
        integrations: {
          julesApiKey: legacySettings.aiProvider?.providers?.jules?.apiKey || "",
          geminiApiKey: legacySettings.aiProvider?.providers?.gemini?.apiKey || "",
          codexApiKey: legacySettings.aiProvider?.providers?.codex?.apiKey || "",
          claudeCodeApiKey: legacySettings.aiProvider?.providers?.["claude-code"]?.apiKey || "",
          githubToken: legacySettings.git?.githubToken || "",
          gitlabToken: legacySettings.git?.gitlabToken || "",
          jira: legacySettings.jira || undefined,
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

      // Preserve legacy values only in the raw migration hand-off. Public reads
      // use the sanitized object above, and startup immediately moves these
      // values into the credential broker before deleting the legacy row.
      const credentialMigrationPayload = structuredClone(systemSettings) as SystemSettings;
      const legacyProviderSecrets: Array<[string, string]> = [
        ["jules", legacySettings.aiProvider?.providers?.jules?.apiKey || ""],
        ["gemini", legacySettings.aiProvider?.providers?.gemini?.apiKey || ""],
        ["codex", legacySettings.aiProvider?.providers?.codex?.apiKey || ""],
        ["claude-code", legacySettings.aiProvider?.providers?.["claude-code"]?.apiKey || ""],
      ];
      for (const [providerConfigId, secret] of legacyProviderSecrets) {
        const provider = credentialMigrationPayload.integrations.providers[providerConfigId];
        if (provider) provider.apiKey = secret;
      }
      credentialMigrationPayload.integrations.githubToken = legacySettings.git?.githubToken || "";
      credentialMigrationPayload.integrations.gitlabToken = legacySettings.git?.gitlabToken || "";
      credentialMigrationPayload.integrations.jira.apiToken = legacySettings.jira?.apiToken || "";
      this.storage.writeSystemPayload(JSON.stringify(credentialMigrationPayload));
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
  private cacheRevision = -1;
  private systemSettingsCache: SystemSettings | null = null;
  private readonly projectSettingsCache = new Map<string, ProjectSettingsOverride>();
  private readonly sprintSettingsCache = new Map<string, SprintSettingsOverride>();
  private readonly projectResolvedCache = new Map<string, EffectiveSettingsResponse>();
  private readonly sprintResolvedCache = new Map<string, EffectiveSettingsResponse>();

  constructor(repo: SettingsRepository) {
    this.repo = repo;
  }

  getSystemSettings(): SystemSettings {
    this.clearIfRevisionChanged();
    if (!this.systemSettingsCache) {
      this.systemSettingsCache = this.repo.getSystemSettings();
    }
    return this.systemSettingsCache;
  }

  getProjectSettings(projectId: string): ProjectSettingsOverride {
    this.clearIfRevisionChanged();
    if (!this.projectSettingsCache.has(projectId)) {
      this.projectSettingsCache.set(projectId, this.repo.getProjectSettings(projectId));
    }
    return this.projectSettingsCache.get(projectId)!;
  }

  getSprintSettings(sprintId: string): SprintSettingsOverride {
    this.clearIfRevisionChanged();
    if (!this.sprintSettingsCache.has(sprintId)) {
      this.sprintSettingsCache.set(sprintId, this.repo.getSprintSettings(sprintId));
    }
    return this.sprintSettingsCache.get(sprintId)!;
  }

  resolveProjectDashboardSettings(projectId: string): EffectiveSettingsResponse {
    this.clearIfRevisionChanged();
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
    this.clearIfRevisionChanged();
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

  private clearIfRevisionChanged(): void {
    const revision = this.repo.getSettingsResolutionRevision();
    if (revision === this.cacheRevision) {
      return;
    }

    this.cacheRevision = revision;
    this.systemSettingsCache = null;
    this.projectSettingsCache.clear();
    this.sprintSettingsCache.clear();
    this.projectResolvedCache.clear();
    this.sprintResolvedCache.clear();
  }
}

export { DEFAULT_DASHBOARD_SETTINGS } from "./settings-defaults.js";
