import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import {
  CredentialBroker,
  CredentialEncryptedStateError,
  CredentialKeyCustodyUnavailableError,
} from "../../../src/services/credentials/credential-broker.js";
import { createLogger } from "../../../src/shared/logging/logger.js";
import { runWithCorrelationId } from "../../../src/shared/logging/correlation-id.js";

const directories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "credential-broker-test-"));
  directories.push(directory);
  const keyPath = join(directory, "root.key");
  await writeFile(keyPath, Buffer.alloc(32, 5).toString("base64"), { mode: 0o600 });
  const storage = new AppDbStorage(join(directory, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const managingProject = projects.createProject({ name: "Managing", sourceType: "local", sourceRef: join(directory, "managing") });
  const consumerProject = projects.createProject({ name: "Consumer", sourceType: "local", sourceRef: join(directory, "consumer") });
  const repository = new AutomationCredentialRepository(storage);
  const provider = new MountedKeyFileProvider(keyPath);
  const secretStore = new EncryptedSqliteSecretStore(repository, provider);
  const audit = new AutomationAuditExportService(storage);
  const broker = new CredentialBroker(repository, secretStore, provider, audit);
  return { directory, keyPath, storage, managingProject, consumerProject, repository, secretStore, audit, broker };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("credential broker lifecycle policy", () => {
  it("assesses all compatibility dimensions without resolving plaintext", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.managingProject.id, {
      name: "Jobs API",
      kind: "http.token",
      value: "compatibility-secret-canary",
      scope: "global",
      allowedProjectIds: [f.managingProject.id, f.consumerProject.id],
      capabilities: ["read", "jobs.list"],
    });
    const get = vi.spyOn(f.secretStore, "get");

    const compatible = await f.broker.assessCompatibility(created.id, {
      projectId: f.consumerProject.id,
      allowedKinds: ["http.token"],
      requiredCapabilities: ["read", "jobs.list"],
    });
    expect(compatible).toMatchObject({
      compatible: true,
      backendReady: true,
      configured: true,
      active: true,
      projectAccess: true,
      kindAllowed: true,
      capabilitiesAllowed: true,
      missingCapabilities: [],
      issues: [],
    });

    const denied = await f.broker.assessCompatibility(created.id, {
      projectId: f.consumerProject.id,
      allowedKinds: ["ssh-key"],
      requiredCapabilities: ["read", "jobs.write"],
    });
    expect(denied).toMatchObject({ compatible: false, kindAllowed: false, capabilitiesAllowed: false });
    expect(denied.missingCapabilities).toEqual(["jobs.write"]);
    expect(denied.issues).toEqual(expect.arrayContaining(["kind_not_allowed", "capability_missing"]));
    expect(get).not.toHaveBeenCalled();
    f.storage.close();
  });

  it("keeps metadata immutable except for bounded names and makes restrictions monotonic and version-safe", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.managingProject.id, {
      name: "Original",
      kind: "token",
      value: "metadata-secret-canary",
      scope: "global",
      allowedProjectIds: [f.managingProject.id, f.consumerProject.id],
      capabilities: ["read", "write"],
    });
    const renamed = f.broker.updateMetadata(f.managingProject.id, created.id, { name: "Renamed", expectedVersion: created.version });
    expect(renamed).toMatchObject({ name: "Renamed", kind: "token", managementProjectId: f.managingProject.id, version: 2 });
    expect(() => f.broker.updateMetadata(f.managingProject.id, created.id, {
      name: "Unsafe",
      expectedVersion: renamed.version,
      kind: "ssh-key",
    } as never)).toThrow(/unsupported fields: kind/);

    const restricted = f.broker.restrict(f.managingProject.id, created.id, {
      allowedProjectIds: [f.managingProject.id],
      capabilities: ["read"],
      expectedVersion: renamed.version,
    });
    expect(restricted).toMatchObject({ allowedProjectIds: [f.managingProject.id], capabilities: ["read"], version: 3 });
    expect(() => f.broker.restrict(f.managingProject.id, created.id, {
      allowedProjectIds: [f.managingProject.id, f.consumerProject.id],
      capabilities: ["read"],
      expectedVersion: restricted.version,
    })).toThrow(/cannot add project access/);
    expect(() => f.broker.restrict(f.managingProject.id, created.id, {
      allowedProjectIds: [f.managingProject.id],
      capabilities: ["read", "write"],
      expectedVersion: restricted.version,
    })).toThrow(/cannot add capabilities/);
    expect(() => f.broker.updateMetadata(f.managingProject.id, created.id, { name: "Stale", expectedVersion: renamed.version })).toThrow(/refresh its metadata/);

    const revoked = f.broker.revoke(f.managingProject.id, created.id, { expectedVersion: restricted.version });
    expect(revoked).toMatchObject({ status: "revoked", version: 4 });
    expect(f.broker.revoke(f.managingProject.id, created.id, { expectedVersion: revoked.version })).toMatchObject({ status: "revoked", version: 4 });
    expect(() => f.broker.revoke(f.managingProject.id, created.id, { expectedVersion: restricted.version })).toThrow(/refresh its metadata/);
    f.storage.close();
  });

  it("requires confirmed versioned promotion and enforces all capabilities and an allowed kind before one read", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.managingProject.id, {
      name: "Project token",
      kind: "http.token",
      value: "resolution-secret-canary",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["read", "jobs.list"],
    });
    await expect(f.broker.promote(f.managingProject.id, created.id, {
      allowedProjectIds: [f.managingProject.id, f.consumerProject.id],
      expectedVersion: created.version,
      confirmScopeExpansion: false,
    })).rejects.toThrow(/confirmScopeExpansion/);
    const promoted = await f.broker.promote(f.managingProject.id, created.id, {
      allowedProjectIds: [f.managingProject.id, f.consumerProject.id],
      expectedVersion: created.version,
      confirmScopeExpansion: true,
    });
    expect(promoted).toMatchObject({ scope: "global", version: 2 });
    f.broker.bind(f.consumerProject.id, promoted.id, {
      bindingKey: "jobs",
      requiredCapabilities: ["read", "jobs.list"],
    });
    const get = vi.spyOn(f.secretStore, "get");
    await expect(f.broker.resolve({
      projectId: f.consumerProject.id,
      bindingKey: "jobs",
      allowedKinds: ["ssh-key"],
      requiredCapabilities: ["read", "jobs.list"],
      workspaceId: "run",
    })).rejects.toThrow(/kind is not approved/);
    await expect(f.broker.resolve({
      projectId: f.consumerProject.id,
      bindingKey: "jobs",
      allowedKinds: ["http.token"],
      requiredCapabilities: ["read", "jobs.write"],
      workspaceId: "run",
    })).rejects.toThrow(/every required capability/);
    expect(get).not.toHaveBeenCalled();
    expect((await f.broker.resolve({
      projectId: f.consumerProject.id,
      bindingKey: "jobs",
      allowedKinds: ["http.token"],
      requiredCapabilities: ["read", "jobs.list"],
      workspaceId: "run",
    })).value).toBe("resolution-secret-canary");
    expect(get).toHaveBeenCalledTimes(1);
    f.storage.close();
  });

  it("classifies validation failures without leaking request secrets to errors, logs, audits, or settings", async () => {
    const f = await fixture();
    const canary = "CREDENTIAL_REQUEST_SECRET_CANARY";
    const created = await runWithCorrelationId("credential-lifecycle-correlation", () => f.broker.create(f.managingProject.id, {
      name: "Tamper test",
      kind: "token",
      value: canary,
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["read"],
    }));
    f.storage.getDatabase().prepare("UPDATE automation_credential_secrets SET auth_tag = ? WHERE credential_id = ?")
      .run(Buffer.alloc(16, 1), created.id);
    let serializedError = "";
    try {
      await f.broker.test(f.managingProject.id, created.id, { expectedVersion: created.version });
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialEncryptedStateError);
      serializedError = JSON.stringify(error, Object.getOwnPropertyNames(error));
    }
    expect(f.repository.get(created.id)).toMatchObject({ validationStatus: "invalid", version: 2 });
    expect(f.audit.list().find((record) => record.action === "credential.create")?.correlationId).toBe("credential-lifecycle-correlation");

    const capturedLogs: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      capturedLogs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    vi.stubEnv("CODEUX_FORCE_LOG_LEVEL", "info");
    createLogger({ environment: "production", consoleLogLevel: "info", consoleLogMode: "full" })
      .info("credential lifecycle canary", { credentialValue: canary });
    const settings = new SettingsRepository(join(f.directory, "settings.db")).getSystemSettings();
    const observable = JSON.stringify({ serializedError, logs: capturedLogs, audit: f.audit.list(), settings });
    expect(observable).not.toContain(canary);
    expect(observable).toContain("[REDACTED]");
    f.storage.close();
  });

  it("marks validation unavailable when key custody cannot recover the envelope", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.managingProject.id, {
      name: "Custody test",
      kind: "token",
      value: "custody-secret-canary",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["read"],
    });
    await unlink(f.keyPath);
    await expect(f.broker.test(f.managingProject.id, created.id, { expectedVersion: created.version }))
      .rejects.toBeInstanceOf(CredentialKeyCustodyUnavailableError);
    expect(f.repository.get(created.id)).toMatchObject({ validationStatus: "unavailable", version: 2 });
    f.storage.close();
  });
});
