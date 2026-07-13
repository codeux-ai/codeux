import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { SettingsCredentialMigrationService } from "../../../src/services/credentials/settings-credential-migration-service.js";
import { SettingsCredentialResolver } from "../../../src/services/credentials/settings-credential-resolver.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import type { ExternalSettingsMigrationValues } from "../../../src/config/external-settings.js";

const dirs: string[] = [];

async function fixture(prepareSettings?: (repository: SettingsRepository) => void) {
  const dir = await mkdtemp(join(tmpdir(), "settings-credential-test-"));
  dirs.push(dir);
  const keyPath = join(dir, "root.key");
  await writeFile(keyPath, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  const appStorage = new AppDbStorage(join(dir, "app.db"));
  const settingsRepository = new SettingsRepository(join(dir, "settings.db"));
  prepareSettings?.(settingsRepository);
  const projects = new ProjectManagementRepository(appStorage, undefined, settingsRepository);
  const first = projects.createProject({ name: "First", sourceType: "local", sourceRef: join(dir, "first") });
  const second = projects.createProject({ name: "Second", sourceType: "local", sourceRef: join(dir, "second") });
  const credentialRepository = new AutomationCredentialRepository(appStorage);
  const provider = new MountedKeyFileProvider(keyPath);
  const broker = new CredentialBroker(
    credentialRepository,
    new EncryptedSqliteSecretStore(credentialRepository, provider),
    provider,
  );
  return { appStorage, projects, first, second, broker, settingsRepository };
}

function externalHints(sentinel: (name: string) => string): ExternalSettingsMigrationValues {
  const values = {
    julesApiKey: sentinel("jules"),
    geminiApiKey: sentinel("gemini"),
    codexApiKey: sentinel("codex"),
    claudeCodeApiKey: sentinel("claude-code"),
    qwenCodeApiKey: sentinel("qwen-code"),
    openCodeApiKey: sentinel("opencode"),
    antigravityApiKey: sentinel("antigravity"),
    githubToken: sentinel("github"),
    gitlabToken: sentinel("gitlab"),
    jiraToken: sentinel("jira"),
  };
  return {
    env: { ...values },
    settingsJson: { ...values },
    resolved: { ...values },
  };
}

function countCredentialReferences(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, entry) => total + countCredentialReferences(entry), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce((total, [key, entry]) => (
    total + (key.endsWith("CredentialRef") && entry ? 1 : countCredentialReferences(entry))
  ), 0);
}

afterEach(async () => {
  const resetDir = await mkdtemp(join(tmpdir(), "settings-credential-reset-"));
  dirs.push(resetDir);
  const reset = new SettingsRepository(join(resetDir, "settings.db"));
  reset.resetAllData();
  reset.close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("settings credential migration and resolution", () => {
  it("resolves pre-project operations through current management scope and observes rotation", async () => {
    const f = await fixture();
    const credential = await f.broker.create(f.first.id, {
      name: "GitHub project creation",
      kind: "settings:integrations.githubToken",
      value: "first-value",
      scope: "global",
      allowedProjectIds: [f.first.id, f.second.id],
      capabilities: ["read"],
    });
    const resolver = new SettingsCredentialResolver(f.broker);
    const reference = { credentialId: credential.id, capability: "read" as const };

    await expect(resolver.isManagementCredentialAvailable(reference)).resolves.toBe(true);
    await expect(resolver.isManagementCredentialAvailable({ credentialId: "", capability: "read" })).rejects.toThrow("malformed");
    await expect(resolver.isManagementCredentialAvailable({ credentialId: "missing", capability: "read" })).resolves.toBe(false);
    const health = vi.spyOn(f.broker, "health").mockResolvedValue({
      available: false,
      secure: false,
      provider: "test",
      keyId: null,
      keyVersion: null,
    });
    await expect(resolver.isManagementCredentialAvailable(reference)).resolves.toBe(false);
    health.mockRestore();

    await expect(resolver.withManagementCredential(reference, {
      consumer: "git.github.project-create",
    }, (secret) => secret.toString("utf8"))).resolves.toBe("first-value");

    await f.broker.rotate(f.first.id, credential.id, "rotated-value");
    await expect(resolver.withManagementCredential(reference, {
      consumer: "git.github.project-create",
    }, (secret) => secret.toString("utf8"))).resolves.toBe("rotated-value");

    f.broker.restrict(f.first.id, credential.id, [f.first.id, f.second.id], []);
    await expect(resolver.isManagementCredentialAvailable(reference)).resolves.toBe(false);
    await expect(resolver.withManagementCredential(reference, {
      consumer: "git.github.project-create",
    }, () => undefined)).rejects.toThrow("Required capability is not approved");
    await expect(resolver.withManagementCredential({ credentialId: "missing", capability: "read" }, {
      consumer: "git.github.project-create",
    }, () => undefined)).rejects.toThrow("Credential is missing");
    f.settingsRepository.close();
    f.appStorage.close();
  });

  it("does not initialize secure storage when fresh settings contain no credentials", async () => {
    const f = await fixture();
    const health = vi.spyOn(f.broker, "health");
    const migration = new SettingsCredentialMigrationService({
      settingsRepository: f.settingsRepository,
      credentialBroker: f.broker,
      listProjectIds: () => [f.first.id, f.second.id],
    });

    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 0, scrubbed: 0 });
    expect(health).not.toHaveBeenCalled();
    f.settingsRepository.close();
    f.appStorage.close();
  });

  it("migrates legacy values once, emits references only, and honors global allowlists", async () => {
    const f = await fixture();
    const secret = "legacy-settings-secret";
    f.settingsRepository.getDatabase().prepare(
      "INSERT INTO system_settings (id,payload,updated_at) VALUES (1,?,?)",
    ).run(JSON.stringify({
      integrations: {
        providers: { jules: { provider: "jules", apiKey: secret } },
        codexApiKey: "legacy-flat-provider-token",
        githubToken: "legacy-github-token",
      },
    }), new Date().toISOString());
    f.settingsRepository.getDatabase().prepare(
      "INSERT INTO project_settings (project_id,payload,updated_at) VALUES (?,?,?)",
    ).run(f.first.id, JSON.stringify({ jira: { apiToken: "project-jira-token" } }), new Date().toISOString());
    const migration = new SettingsCredentialMigrationService({
      settingsRepository: f.settingsRepository,
      credentialBroker: f.broker,
      listProjectIds: () => [f.first.id, f.second.id],
    });

    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 4, scrubbed: 0 });
    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 0, scrubbed: 0, recordsChanged: 0 });
    const raw = f.settingsRepository.getDatabase().prepare("SELECT payload FROM system_settings WHERE id=1").get() as { payload: string };
    expect(raw.payload).not.toContain(secret);
    expect(raw.payload).not.toContain("legacy-github-token");
    expect(raw.payload).not.toContain("legacy-flat-provider-token");
    const payload = JSON.parse(raw.payload) as {
      integrations: {
        providers: {
          jules: { apiKeyCredentialRef: { credentialId: string; capability: "read" } };
          codex: { apiKeyCredentialRef: { credentialId: string; capability: "read" } };
        };
      };
    };
    const reference = payload.integrations.providers.jules.apiKeyCredentialRef;
    expect(reference).toMatchObject({ capability: "read" });
    expect(payload.integrations.providers.codex.apiKeyCredentialRef).toMatchObject({ capability: "read" });
    const serializedSystem = JSON.stringify(f.settingsRepository.getSystemSettings());
    const serializedProject = JSON.stringify(f.settingsRepository.getProjectSettings(f.first.id));
    const serializedEffective = JSON.stringify(f.settingsRepository.resolveProjectDashboardSettings(f.first.id));
    expect(serializedSystem).not.toContain(secret);
    expect(serializedProject).not.toContain("project-jira-token");
    expect(serializedEffective).not.toContain("project-jira-token");
    expect(serializedProject).toContain("apiTokenCredentialRef");
    expect(serializedEffective).toContain("apiTokenCredentialRef");

    const resolver = new SettingsCredentialResolver(f.broker);
    let transient: Buffer | null = null;
    await expect(resolver.withCredential(reference, {
      projectId: f.second.id,
      consumer: "provider.jules",
    }, (value) => {
      transient = value;
      return value.toString("utf8");
    })).resolves.toBe(secret);
    expect(transient).not.toBeNull();
    expect(transient!.equals(Buffer.alloc(transient!.length))).toBe(true);
    f.settingsRepository.close();
    f.appStorage.close();
  });

  it("moves every supported legacy database credential into one broker reference", async () => {
    const legacy = structuredClone(DEFAULT_DASHBOARD_SETTINGS);
    const sentinels: string[] = [];
    const sentinel = (name: string): string => {
      const value = `legacy-${name}-sentinel`;
      sentinels.push(value);
      return value;
    };
    for (const [providerConfigId, provider] of Object.entries(legacy.aiProvider.providers)) {
      if (provider.provider === "mockup-cli") continue;
      provider.apiKey = sentinel(providerConfigId);
    }
    legacy.aiProvider.providers["qwen-code"].qwenAdditionalModelProviders = [
      { id: "first", name: "First", authType: "openai", envKey: "FIRST_API_KEY", apiKey: sentinel("qwen-first"), baseUrl: "https://first.invalid" },
      { id: "second", name: "Second", authType: "anthropic", envKey: "SECOND_API_KEY", apiKey: sentinel("qwen-second"), baseUrl: "https://second.invalid" },
    ];
    legacy.git.githubToken = sentinel("github");
    legacy.git.gitlabToken = sentinel("gitlab");
    legacy.git.defaultBranch = "preserved-legacy-branch";
    legacy.jira.apiToken = sentinel("jira");
    for (const [name, importer] of Object.entries({
      notion: legacy.notion,
      asana: legacy.asana,
      linear: legacy.linear,
      miro: legacy.miro,
      lucid: legacy.lucid,
      figma: legacy.figma,
      mural: legacy.mural,
    })) {
      importer.apiToken = sentinel(`${name}-token`);
      importer.apiSecret = sentinel(`${name}-secret`);
      importer.baseUrl = `https://${name}.invalid/api`;
    }
    legacy.memory.externalEmbedding.apiKey = sentinel("embedding");
    legacy.speech.externalTranscription.apiKey = sentinel("transcription");
    legacy.speech.synthesis.externalSynthesis.apiKey = sentinel("synthesis");
    const f = await fixture((repository) => {
      repository.getDatabase().prepare(
        "INSERT INTO app_settings (id,payload,updated_at) VALUES (1,?,?)",
      ).run(JSON.stringify(legacy), new Date().toISOString());
    });

    expect(f.settingsRepository.getSystemSettings().defaults.git.defaultBranch).toBe("preserved-legacy-branch");
    const handoff = f.settingsRepository.getDatabase().prepare("SELECT payload FROM system_settings WHERE id=1").get() as { payload: string };
    expect(sentinels.every((value) => handoff.payload.includes(value))).toBe(true);
    expect(f.settingsRepository.getDatabase().prepare("SELECT payload FROM app_settings WHERE id=1").get()).toBeUndefined();

    const migration = new SettingsCredentialMigrationService({
      settingsRepository: f.settingsRepository,
      credentialBroker: f.broker,
      listProjectIds: () => [f.first.id, f.second.id],
    });
    await expect(migration.migrate()).resolves.toMatchObject({ migrated: sentinels.length, scrubbed: 0 });
    const migrated = f.settingsRepository.getDatabase().prepare("SELECT payload FROM system_settings WHERE id=1").get() as { payload: string };
    expect(sentinels.every((value) => !migrated.payload.includes(value))).toBe(true);
    expect(countCredentialReferences(JSON.parse(migrated.payload))).toBe(sentinels.length);
    expect(f.broker.list(f.first.id)).toHaveLength(sentinels.length);
    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 0, scrubbed: 0, recordsChanged: 0 });
    expect(f.broker.list(f.first.id)).toHaveLength(sentinels.length);
    f.settingsRepository.close();
    f.appStorage.close();
  });

  it("moves every legacy settings.json hint into a provider or integration reference", async () => {
    const f = await fixture();
    const hints = externalHints((name) => `settings-json-${name}-sentinel`);
    const migration = new SettingsCredentialMigrationService({
      settingsRepository: f.settingsRepository,
      credentialBroker: f.broker,
      listProjectIds: () => [f.first.id, f.second.id],
      externalSettingsMigrationValues: hints,
    });

    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 10, scrubbed: 0 });
    const raw = f.settingsRepository.getDatabase().prepare("SELECT payload FROM system_settings WHERE id=1").get() as { payload: string };
    expect(Object.values(hints.resolved).every((value) => !raw.payload.includes(value))).toBe(true);
    expect(countCredentialReferences(JSON.parse(raw.payload))).toBe(10);
    expect(f.broker.list(f.first.id)).toHaveLength(10);
    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 0, recordsChanged: 0 });
    expect(f.broker.list(f.first.id)).toHaveLength(10);
    f.settingsRepository.close();
    f.appStorage.close();
  });

  it("scrubs values and fails closed when secure storage or references are unavailable", async () => {
    const f = await fixture();
    f.settingsRepository.getDatabase().prepare(
      "INSERT INTO project_settings (project_id,payload,updated_at) VALUES (?,?,?)",
    ).run(f.first.id, JSON.stringify({
      jira: {
        apiToken: "must-disappear",
        apiTokenCredentialRef: { credentialId: "stale-reference", capability: "read" },
      },
    }), new Date().toISOString());
    f.settingsRepository.getDatabase().prepare(
      "INSERT INTO project_settings (project_id,payload,updated_at) VALUES (?,?,?)",
    ).run(f.second.id, '{"jira":{"apiToken":"malformed-secret"', new Date().toISOString());
    const create = vi.fn();
    const unavailableBroker = {
      health: vi.fn(async () => ({ available: false, secure: false })),
      create,
    } as unknown as CredentialBroker;
    const migration = new SettingsCredentialMigrationService({
      settingsRepository: f.settingsRepository,
      credentialBroker: unavailableBroker,
      listProjectIds: () => [f.first.id],
    });
    await expect(migration.migrate()).resolves.toMatchObject({ migrated: 0, scrubbed: 1, secureStorageAvailable: false });
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(f.settingsRepository.getProjectSettings(f.first.id))).not.toContain("must-disappear");
    expect(f.settingsRepository.getProjectSettings(f.first.id).jira?.apiTokenCredentialRef).toBeNull();
    const malformed = f.settingsRepository.getDatabase().prepare("SELECT payload FROM project_settings WHERE project_id=?").get(f.second.id) as { payload: string };
    expect(malformed.payload).toBe("{}");
    await expect(new SettingsCredentialResolver(f.broker).withCredential(
      { credentialId: "", capability: "read" },
      { projectId: f.first.id, consumer: "jira" },
      () => undefined,
    )).rejects.toThrow(/malformed/);
    f.settingsRepository.close();
    f.appStorage.close();
  });
});
