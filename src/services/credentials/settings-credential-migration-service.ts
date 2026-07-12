import type { SettingsCredentialReference } from "../../contracts/app-types.js";
import type { ExternalSettingsMigrationValues } from "../../config/external-settings.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import type { CredentialBroker } from "./credential-broker.js";

type SettingsScope = "system" | "project" | "sprint";

export interface SettingsCredentialMigrationResult {
  migrated: number;
  scrubbed: number;
  recordsChanged: number;
  secureStorageAvailable: boolean;
}

export interface SettingsCredentialMigrationDependencies {
  settingsRepository: SettingsRepository;
  credentialBroker: CredentialBroker;
  listProjectIds: () => string[];
  resolveSprintProjectId?: (sprintId: string) => string | null;
  externalSettingsMigrationValues?: ExternalSettingsMigrationValues;
}

const SECRET_KEY_PATTERN = /^(?:apiKey|apiToken|apiSecret|githubToken|gitlabToken|[a-zA-Z0-9]+ApiKey)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function containsPlaintextCredential(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPlaintextCredential);
  const object = asRecord(value);
  if (!object) return false;
  return Object.entries(object).some(([key, nested]) => (
    SECRET_KEY_PATTERN.test(key) && typeof nested === "string" && nested.length > 0
  ) || containsPlaintextCredential(nested));
}

function containsExternalHintCredential(hints: ExternalSettingsMigrationValues | undefined): boolean {
  return Boolean(hints && Object.values(hints.resolved).some((value) => typeof value === "string" && value.length > 0));
}

function seedExternalHints(root: Record<string, unknown>, hints: ExternalSettingsMigrationValues | undefined): void {
  if (!hints) return;
  const integrations = asRecord(root.integrations) ?? {};
  root.integrations = integrations;
  const providers = asRecord(integrations.providers) ?? {};
  integrations.providers = providers;
  const providerHints: Array<[string, string]> = [
    ["jules", hints.resolved.julesApiKey],
    ["gemini", hints.resolved.geminiApiKey],
    ["codex", hints.resolved.codexApiKey],
    ["claude-code", hints.resolved.claudeCodeApiKey],
    ["qwen-code", hints.resolved.qwenCodeApiKey],
    ["opencode", hints.resolved.openCodeApiKey],
    ["antigravity", hints.resolved.antigravityApiKey],
  ];
  for (const [providerId, secret] of providerHints) {
    if (!secret) continue;
    const provider = asRecord(providers[providerId]) ?? { provider: providerId };
    providers[providerId] = provider;
    if (!provider.apiKey && !provider.apiKeyCredentialRef) provider.apiKey = secret;
  }
  if (!integrations.githubToken && !integrations.githubTokenCredentialRef) integrations.githubToken = hints.resolved.githubToken;
  if (!integrations.gitlabToken && !integrations.gitlabTokenCredentialRef) integrations.gitlabToken = hints.resolved.gitlabToken ?? "";
  const jira = asRecord(integrations.jira) ?? {};
  integrations.jira = jira;
  if (!jira.apiToken && !jira.apiTokenCredentialRef) jira.apiToken = hints.resolved.jiraToken ?? "";
}

function safeKind(path: string): string {
  return `settings:${path.replace(/[^a-zA-Z0-9._:-]+/g, ".").slice(0, 110)}`;
}

function setLegacyProviderReference(
  parentPath: string,
  parent: Record<string, unknown>,
  key: string,
  reference: SettingsCredentialReference | null,
): boolean {
  if (parentPath !== "integrations") return false;
  const providerByLegacyKey: Record<string, string> = {
    julesApiKey: "jules",
    geminiApiKey: "gemini",
    codexApiKey: "codex",
    claudeCodeApiKey: "claude-code",
    qwenCodeApiKey: "qwen-code",
    openCodeApiKey: "opencode",
    antigravityApiKey: "antigravity",
  };
  const providerId = providerByLegacyKey[key];
  if (!providerId) return false;
  const providers = asRecord(parent.providers) ?? {};
  parent.providers = providers;
  const provider = asRecord(providers[providerId]) ?? { provider: providerId };
  providers[providerId] = provider;
  provider.apiKeyCredentialRef = reference;
  return true;
}

export class SettingsCredentialMigrationService {
  constructor(private readonly deps: SettingsCredentialMigrationDependencies) {}

  async migrate(): Promise<SettingsCredentialMigrationResult> {
    const records = this.deps.settingsRepository.getCredentialMigrationRecords();
    const systemRequiresHintMigration = records.some((record) => {
      if (record.scope !== "system") return false;
      try {
        return asRecord(JSON.parse(record.payload))?.credentialMigrationVersion !== 1;
      } catch {
        return true;
      }
    });
    const requiresSecureStorage = records.some((record) => {
      try {
        return containsPlaintextCredential(JSON.parse(record.payload));
      } catch {
        return false;
      }
    }) || (systemRequiresHintMigration && containsExternalHintCredential(this.deps.externalSettingsMigrationValues));
    const health = requiresSecureStorage
      ? await this.deps.credentialBroker.health().catch(() => ({ available: false, secure: false }))
      : { available: true, secure: true };
    const secureStorageAvailable = health.available === true && health.secure === true;
    const projectIds = [...new Set(this.deps.listProjectIds().map((id) => id.trim()).filter(Boolean))].sort();
    const managerProjectId = projectIds[0] ?? null;
    let migrated = 0;
    let scrubbed = 0;
    let recordsChanged = 0;

    for (const record of records) {
      let root: Record<string, unknown>;
      let malformedPayload = false;
      try {
        root = asRecord(JSON.parse(record.payload)) ?? {};
      } catch {
        root = {};
        malformedPayload = true;
      }
      const credentialMigrationComplete = root.credentialMigrationVersion === 1;
      if (record.scope === "system" && !credentialMigrationComplete) {
        seedExternalHints(root, this.deps.externalSettingsMigrationValues);
      }
      let changed = malformedPayload;
      const projectId = this.projectIdFor(record.scope, record.scopeId, managerProjectId);
      const visit = async (value: unknown, path: string): Promise<void> => {
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index += 1) await visit(value[index], `${path}.${index}`);
          return;
        }
        const object = asRecord(value);
        if (!object) return;
        for (const [key, nested] of Object.entries(object)) {
          const fieldPath = path ? `${path}.${key}` : key;
          if (SECRET_KEY_PATTERN.test(key) && typeof nested === "string") {
            const plaintext = nested;
            if (plaintext.length > 0) {
              const reference = await this.createReference(record.scope, projectId, managerProjectId, projectIds, fieldPath, plaintext, secureStorageAvailable);
              if (reference) {
                if (!setLegacyProviderReference(path, object, key, reference)) {
                  object[`${key}CredentialRef`] = reference;
                }
                migrated += 1;
              } else {
                if (!setLegacyProviderReference(path, object, key, null)) {
                  object[`${key}CredentialRef`] = null;
                }
                scrubbed += 1;
              }
            }
            if (plaintext !== "") changed = true;
            object[key] = "";
            continue;
          }
          await visit(nested, fieldPath);
        }
      };
      await visit(root, "");
      if (record.scope === "system" && !credentialMigrationComplete) {
        root.credentialMigrationVersion = 1;
        changed = true;
      }
      if (changed || record.scope === "system" && record.payload === "{}" && Object.keys(root).length > 0) {
        this.deps.settingsRepository.replaceCredentialMigrationRecord(record.scope, record.scopeId, JSON.stringify(root));
        recordsChanged += 1;
      }
    }
    return { migrated, scrubbed, recordsChanged, secureStorageAvailable };
  }

  private projectIdFor(scope: SettingsScope, scopeId: string | null, managerProjectId: string | null): string | null {
    if (scope === "project") return scopeId;
    if (scope === "sprint" && scopeId) return this.deps.resolveSprintProjectId?.(scopeId) ?? null;
    return managerProjectId;
  }

  private async createReference(
    scope: SettingsScope,
    projectId: string | null,
    managerProjectId: string | null,
    allowedProjectIds: string[],
    path: string,
    value: string,
    secureStorageAvailable: boolean,
  ): Promise<SettingsCredentialReference | null> {
    if (!secureStorageAvailable || !projectId || !managerProjectId) return null;
    try {
      const metadata = await this.deps.credentialBroker.create(projectId, {
        name: `Settings credential: ${path}`.slice(0, 128),
        kind: safeKind(path),
        value,
        scope: scope === "system" ? "global" : "project",
        allowedProjectIds: scope === "system" ? allowedProjectIds : undefined,
        capabilities: ["read"],
      });
      return { credentialId: metadata.id, capability: "read" };
    } catch {
      return null;
    }
  }
}
