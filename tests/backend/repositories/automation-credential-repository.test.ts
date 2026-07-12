import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import type { SecretContext, SecretStore } from "../../../src/services/credentials/secret-store.js";

const dirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "credential-test-"));
  dirs.push(dir);
  const dbPath = join(dir, "app.db");
  const keyPath = join(dir, "root.key");
  await writeFile(keyPath, Buffer.alloc(32, 9).toString("base64"), { mode: 0o600 });
  const storage = new AppDbStorage(dbPath);
  const projects = new ProjectManagementRepository(storage);
  const first = projects.createProject({ name: "First", sourceType: "local", sourceRef: join(dir, "first") });
  const second = projects.createProject({ name: "Second", sourceType: "local", sourceRef: join(dir, "second") });
  const repository = new AutomationCredentialRepository(storage);
  const provider = new MountedKeyFileProvider(keyPath);
  const secretStore = new EncryptedSqliteSecretStore(repository, provider);
  const broker = new CredentialBroker(repository, secretStore, provider);
  return { dir, dbPath, storage, repository, provider, secretStore, broker, first, second };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("automation credential repository and broker", () => {
  it("persists only encrypted material, resolves capabilities, rotates, and audits metadata", async () => {
    const f = await fixture();
    const secret = "plain-secret-marker";
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "api-token", value: secret, capabilities: ["read"] });
    expect(created).toMatchObject({ configured: true, managementProjectId: f.first.id });
    expect(JSON.stringify(created)).not.toContain(secret);
    const persisted = f.storage.getDatabase().prepare("SELECT * FROM automation_credential_secrets WHERE credential_id=?").get(created.id) as Record<string, unknown>;
    expect(JSON.stringify(persisted)).not.toContain(secret);
    f.broker.bind(f.first.id, created.id, "node.http", ["read"]);
    expect((await f.broker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" })).value).toBe(secret);
    const rotated = await f.broker.rotate(f.first.id, created.id, "replacement");
    expect(rotated.version).toBe(2);
    expect((await f.broker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" })).value).toBe("replacement");
    const event = f.storage.getDatabase().prepare("SELECT * FROM automation_credential_access_events ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(f.storage.getDatabase().prepare("SELECT COUNT(*) AS count FROM automation_credential_rotations").get()).toMatchObject({ count: 1 });
    f.storage.close();
  });

  it("fails closed for cross-project, revoked, missing, and insecure providers", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "api-token", value: "secret", capabilities: ["read"] });
    expect(() => f.broker.bind(f.second.id, created.id, "node.http", ["read"])).toThrow(/not available/);
    f.broker.bind(f.first.id, created.id, "node.http", ["read"]);
    f.broker.revoke(f.first.id, created.id);
    await expect(f.broker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" })).rejects.toThrow(/not active/);
    const insecurePath = join(f.dir, "insecure.key");
    await writeFile(insecurePath, Buffer.alloc(32, 4).toString("base64"), { mode: 0o644 });
    const insecureHealth = await new MountedKeyFileProvider(insecurePath).health();
    expect(insecureHealth).toMatchObject({ available: false, secure: false });
    f.storage.close();
    const unavailable = new MountedKeyFileProvider(undefined);
    expect((await unavailable.health()).available).toBe(false);
  });

  it("requires explicit project allowlists and re-encrypts promoted credentials", async () => {
    const f = await fixture();
    await expect(f.broker.create(f.first.id, {
      name: "Global",
      kind: "token",
      value: "secret",
      scope: "global",
      allowedProjectIds: [f.second.id],
      capabilities: ["read"],
    })).rejects.toThrow(/explicit allowlist/);
    const projectCredential = await f.broker.create(f.first.id, { name: "Promoted", kind: "token", value: "secret", capabilities: ["read"] });
    const promoted = await f.broker.promote(f.first.id, projectCredential.id, [f.first.id, f.second.id]);
    expect(promoted).toMatchObject({ scope: "global", managementProjectId: f.first.id });
    f.broker.bind(f.second.id, promoted.id, "node.global", ["read"]);
    expect((await f.broker.resolve({ projectId: f.second.id, bindingKey: "node.global", capability: "read", workspaceId: "run" })).value).toBe("secret");
    expect(() => f.broker.revoke(f.second.id, promoted.id)).toThrow(/not managed/);
    await expect(f.broker.rotate(f.second.id, promoted.id, "stolen")).rejects.toThrow(/not managed/);
    expect(() => f.broker.restrict(f.second.id, promoted.id, [f.first.id, f.second.id], ["read"])).toThrow(/not managed/);
    f.storage.close();
  });

  it("removes a global credential when its management project is deleted", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.first.id, {
      name: "Global",
      kind: "token",
      value: "secret",
      scope: "global",
      allowedProjectIds: [f.first.id, f.second.id],
      capabilities: ["read"],
    });
    f.storage.getDatabase().prepare("DELETE FROM projects WHERE id = ?").run(f.first.id);
    expect(f.repository.get(created.id)).toBeNull();
    f.storage.close();
  });

  it("rolls back credential metadata when initial envelope persistence fails", async () => {
    const f = await fixture();
    f.storage.getDatabase().exec(`
      CREATE TRIGGER reject_credential_secret_insert
      BEFORE INSERT ON automation_credential_secrets
      BEGIN
        SELECT RAISE(ABORT, 'forced secret insert failure');
      END
    `);
    await expect(f.broker.create(f.first.id, { name: "Token", kind: "token", value: "secret", capabilities: ["read"] })).rejects.toThrow(/forced secret insert failure/);
    expect(f.storage.getDatabase().prepare("SELECT COUNT(*) AS count FROM automation_credentials").get()).toMatchObject({ count: 0 });
    f.storage.close();
  });

  it("rolls back version metadata and keeps the old value when envelope replacement fails", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "token", value: "original", capabilities: ["read"] });
    f.broker.bind(f.first.id, created.id, "node.http", ["read"]);
    f.storage.getDatabase().exec(`
      CREATE TRIGGER reject_credential_secret_update
      BEFORE UPDATE ON automation_credential_secrets
      BEGIN
        SELECT RAISE(ABORT, 'forced secret update failure');
      END
    `);
    await expect(f.broker.rotate(f.first.id, created.id, "replacement")).rejects.toThrow(/forced secret update failure/);
    expect(f.repository.get(created.id)).toMatchObject({ version: 1, status: "active" });
    expect((await f.broker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" })).value).toBe("original");
    expect(f.storage.getDatabase().prepare("SELECT COUNT(*) AS count FROM automation_credential_rotations").get()).toMatchObject({ count: 0 });
    f.storage.close();
  });

  it("rolls back scope changes when promoted-envelope persistence fails", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "token", value: "original", capabilities: ["read"] });
    f.storage.getDatabase().exec(`
      CREATE TRIGGER reject_promoted_secret_update
      BEFORE UPDATE ON automation_credential_secrets
      BEGIN
        SELECT RAISE(ABORT, 'forced promotion failure');
      END
    `);
    await expect(f.broker.promote(f.first.id, created.id, [f.first.id, f.second.id])).rejects.toThrow(/forced promotion failure/);
    expect(f.repository.get(created.id)).toMatchObject({ scope: "project", projectId: f.first.id, managementProjectId: f.first.id });
    f.broker.bind(f.first.id, created.id, "node.http", ["read"]);
    expect((await f.broker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" })).value).toBe("original");
    f.storage.close();
  });

  it("allows only one overlapping rotation to commit", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "token", value: "original", capabilities: ["read"] });
    f.broker.bind(f.first.id, created.id, "node.http", ["read"]);
    const results = await Promise.allSettled([
      f.broker.rotate(f.first.id, created.id, "replacement-a"),
      f.broker.rotate(f.first.id, created.id, "replacement-b"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(f.repository.get(created.id)).toMatchObject({ version: 2 });
    const resolved = await f.broker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" });
    expect(["replacement-a", "replacement-b"]).toContain(resolved.value);
    expect(f.storage.getDatabase().prepare("SELECT COUNT(*) AS count FROM automation_credential_rotations").get()).toMatchObject({ count: 1 });
    f.storage.close();
  });

  it("rechecks authorization after decryption so revocation wins an in-flight resolve", async () => {
    const f = await fixture();
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "token", value: "secret", capabilities: ["read"] });
    f.broker.bind(f.first.id, created.id, "node.http", ["read"]);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readStarted = new Promise<void>((resolve) => { entered = resolve; });
    let delayed = true;
    const delayedStore: SecretStore = {
      seal: (context, plaintext) => f.secretStore.seal(context, plaintext),
      get: async (context: SecretContext): Promise<Buffer> => {
        if (delayed) {
          delayed = false;
          entered();
          await gate;
        }
        return f.secretStore.get(context);
      },
    };
    const resolvingBroker = new CredentialBroker(f.repository, delayedStore, f.provider);
    const pending = resolvingBroker.resolve({ projectId: f.first.id, bindingKey: "node.http", capability: "read", workspaceId: "run" });
    await readStarted;
    f.broker.revoke(f.first.id, created.id);
    release();
    await expect(pending).rejects.toThrow(/not active/);
    f.storage.close();
  });

  it("rejects malformed and oversized runtime inputs instead of coercing them", async () => {
    const f = await fixture();
    await expect(f.broker.create(f.first.id, { name: "Token", kind: "token", value: "x".repeat(64 * 1024 + 1) })).rejects.toThrow(/65536/);
    await expect(f.broker.create(f.first.id, { name: "Token", kind: "token", value: "secret", capabilities: "read" as unknown as string[] })).rejects.toThrow(/array of strings/);
    const created = await f.broker.create(f.first.id, { name: "Token", kind: "token", value: "secret", capabilities: ["read"] });
    expect(() => f.broker.bind(f.first.id, created.id, "node.http", ["read", 7] as unknown)).toThrow(/must be a string/);
    f.storage.close();
  });
});
