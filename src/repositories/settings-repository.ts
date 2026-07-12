import type { DashboardSettings, ExternalSettingsHints } from "../contracts/app-types.js";
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
import {
  DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
  LOCAL_TRANSCRIPTION_MODEL_IDS,
} from "../contracts/speech-types.js";
import { redactSettingsCredentialValues } from "../domain/settings/settings-sanitizers/credential-reference-sanitizer.js";

const LOCAL_TRANSCRIPTION_MODEL_ID_SET = new Set<string>(LOCAL_TRANSCRIPTION_MODEL_IDS);
const LEGACY_SECRET_KEY_PATTERN = /^(?:apiKey|apiToken|apiSecret|githubToken|gitlabToken|[a-zA-Z0-9]+ApiKey)$/;

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

/**
 * Copies only supported plaintext credential fields into an already-sanitized
 * settings shape. This keeps the raw database row complete for the one-way
 * broker handoff without allowing unknown legacy fields into runtime settings.
 */
function copyLegacyCredentialValues(source: unknown, target: unknown): void {
  if (Array.isArray(source) && Array.isArray(target)) {
    for (let index = 0; index < Math.min(source.length, target.length); index += 1) {
      copyLegacyCredentialValues(source[index], target[index]);
    }
    return;
  }
  if (!isRecord(source) || !isRecord(target)) return;

  for (const [key, sourceValue] of Object.entries(source)) {
    if (!Object.hasOwn(target, key)) continue;
    if (LEGACY_SECRET_KEY_PATTERN.test(key) && typeof sourceValue === "string") {
      target[key] = sourceValue;
      continue;
    }
    copyLegacyCredentialValues(sourceValue, target[key]);
  }
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
      const legacyProviders = legacySettings.aiProvider?.providers ?? {};
      const integrationProviders = {
        ...buildDefaultSystemSettings(this.externalHints).integrations.providers,
        ...legacyProviders,
      };
      const systemSettings = sanitizeSystemSettings({
        runtime: {
          dashboardPort: legacySettings.dashboardPort,
          debugLogFileLevel: legacySettings.enableDebugLogFile ? "error" : "off",
          consoleLogLevel: legacySettings.consoleLogLevel,
          consoleLogMode: legacySettings.consoleLogMode,
          dbAutoVacuumOnStartup: legacySettings.dbAutoVacuumOnStartup,
          dbPruningEnabled: legacySettings.dbPruningEnabled,
          dbRetentionDays: legacySettings.dbRetentionDays,
          restartSprintPolicy: legacySettings.restartSprintPolicy,
          restartInvocationPolicy: legacySettings.restartInvocationPolicy,
        },
        integrations: {
          providers: integrationProviders,
          githubToken: legacySettings.git?.githubToken || "",
          gitlabToken: legacySettings.git?.gitlabToken || "",
          jira: legacySettings.jira || undefined,
          notion: legacySettings.notion,
          asana: legacySettings.asana,
          linear: legacySettings.linear,
          miro: legacySettings.miro,
          lucid: legacySettings.lucid,
          figma: legacySettings.figma,
          mural: legacySettings.mural,
        },
        techstackCatalog: legacySettings.techstackCatalog,
        defaults: legacySettings,
        mcpTools: legacySettings.mcpTools,
        customMcpServers: legacySettings.customMcpServers,
        modelPricing: legacySettings.modelPricing,
      }, this.externalHints);

      // Preserve legacy values only in the raw migration hand-off. Public reads
      // use the sanitized object above, and startup immediately moves these
      // values into the credential broker before deleting the legacy row.
      const credentialMigrationPayload = structuredClone(systemSettings) as SystemSettings;
      copyLegacyCredentialValues(legacyProviders, credentialMigrationPayload.integrations.providers);
      credentialMigrationPayload.integrations.githubToken = legacySettings.git?.githubToken || "";
      credentialMigrationPayload.integrations.gitlabToken = legacySettings.git?.gitlabToken || "";
      copyLegacyCredentialValues(legacySettings.jira, credentialMigrationPayload.integrations.jira);
      copyLegacyCredentialValues(legacySettings.notion, credentialMigrationPayload.integrations.notion);
      copyLegacyCredentialValues(legacySettings.asana, credentialMigrationPayload.integrations.asana);
      copyLegacyCredentialValues(legacySettings.linear, credentialMigrationPayload.integrations.linear);
      copyLegacyCredentialValues(legacySettings.miro, credentialMigrationPayload.integrations.miro);
      copyLegacyCredentialValues(legacySettings.lucid, credentialMigrationPayload.integrations.lucid);
      copyLegacyCredentialValues(legacySettings.figma, credentialMigrationPayload.integrations.figma);
      copyLegacyCredentialValues(legacySettings.mural, credentialMigrationPayload.integrations.mural);
      copyLegacyCredentialValues(legacySettings.memory, credentialMigrationPayload.defaults.memory);
      copyLegacyCredentialValues(legacySettings.speech, credentialMigrationPayload.defaults.speech);
      this.storage.writeSystemPayload(JSON.stringify(credentialMigrationPayload));
      this.storage.deleteLegacyPayload();

      // Warm up the cache with the migrated settings
      SettingsRepository.systemSettingsCache = systemSettings;
    } catch {
      // Keep the legacy source intact so a later startup can retry safely.
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
