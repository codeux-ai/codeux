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

const dirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "settings-credential-test-"));
  dirs.push(dir);
  const keyPath = join(dir, "root.key");
  await writeFile(keyPath, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  const appStorage = new AppDbStorage(join(dir, "app.db"));
  const projects = new ProjectManagementRepository(appStorage);
  const first = projects.createProject({ name: "First", sourceType: "local", sourceRef: join(dir, "first") });
  const second = projects.createProject({ name: "Second", sourceType: "local", sourceRef: join(dir, "second") });
  const credentialRepository = new AutomationCredentialRepository(appStorage);
  const provider = new MountedKeyFileProvider(keyPath);
  const broker = new CredentialBroker(
    credentialRepository,
    new EncryptedSqliteSecretStore(credentialRepository, provider),
    provider,
  );
  const settingsRepository = new SettingsRepository(join(dir, "settings.db"));
  return { appStorage, projects, first, second, broker, settingsRepository };
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

  it("scrubs values and fails closed when secure storage or references are unavailable", async () => {
    const f = await fixture();
    f.settingsRepository.getDatabase().prepare(
      "INSERT INTO project_settings (project_id,payload,updated_at) VALUES (?,?,?)",
    ).run(f.first.id, JSON.stringify({ jira: { apiToken: "must-disappear" } }), new Date().toISOString());
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
    await expect(new SettingsCredentialResolver(f.broker).withCredential(
      { credentialId: "", capability: "read" },
      { projectId: f.first.id, consumer: "jira" },
      () => undefined,
    )).rejects.toThrow(/malformed/);
    f.settingsRepository.close();
    f.appStorage.close();
  });
});
