import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ChatProviderSecretService } from "../../../src/services/chat-provider-secret-service.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";

const storages: AppDbStorage[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const storage of storages.splice(0).reverse()) storage.close();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("ChatProviderSecretService", () => {
  it("persists only encrypted envelopes, resolves ephemeral credentials, and rotates with CAS metadata", async () => {
    const { storage, repository } = await createRepository();
    const service = new ChatProviderSecretService(repository, createKeyProvider());
    const secret = "connector-canary-that-must-never-be-plaintext";

    const created = await service.createConnection({
      providerKind: "slack",
      displayName: "Encrypted Slack",
      bridgeMode: "webhook",
      secrets: { signingSecret: secret },
    });

    const raw = storage.getDatabase().prepare(`
      SELECT c.secret_json, s.ciphertext, s.secret_keys_json
      FROM chat_provider_connections c
      JOIN chat_provider_connection_secrets s ON s.provider_connection_id = c.id
      WHERE c.id = ?
    `).get(created.id) as { secret_json: string | null; ciphertext: Buffer; secret_keys_json: string };
    expect(raw.secret_json).toBeNull();
    expect(raw.ciphertext.toString("utf8")).not.toContain(secret);
    expect(raw.secret_keys_json).toBe('["signingSecret"]');
    expect(JSON.stringify(repository.getConnection(created.id))).not.toContain(secret);
    expect((await service.resolveConnection(created.id)).secrets).toEqual({ signingSecret: secret });

    service.updateVerification(created.id, "verified", { endpoint: "ok", authorization: secret });
    expect(repository.getConnection(created.id)).toMatchObject({ verificationStatus: "verified", secretVersion: 1 });
    expect(repository.getConnection(created.id)?.verificationDetails).toEqual({ endpoint: "ok", authorization: "[REDACTED]" });

    const rotated = await service.updateConnection(created.id, { secrets: { signingSecret: "rotated-secret" } });
    expect(rotated).toMatchObject({ verificationStatus: "unverified", verificationDetails: null, secretVersion: 2 });
    expect((await service.resolveConnection(created.id)).secrets).toEqual({ signingSecret: "rotated-secret" });

    const partiallyRotated = await service.updateConnection(created.id, { secrets: { botToken: "new-bot-token" } });
    expect((await service.resolveConnection(created.id)).secrets).toEqual({
      signingSecret: "rotated-secret",
      botToken: "new-bot-token",
    });
  });

  it("leaves legacy plaintext intact while key custody is unavailable", async () => {
    const { storage, repository } = await createRepository();
    const connection = repository.createConnection({ providerKind: "telegram", displayName: "Legacy", bridgeMode: "webhook" });
    const legacy = '{"botToken":"legacy-token"}';
    storage.getDatabase().prepare("UPDATE chat_provider_connections SET secret_json = ? WHERE id = ?").run(legacy, connection.id);
    const unavailable = createKeyProvider(false);

    const result = await new ChatProviderSecretService(repository, unavailable).migrateLegacySecrets();

    expect(result).toMatchObject({ status: "blocked", migrated: 0, pending: 1 });
    expect(result.reason).toContain("fixture key unavailable");
    expect(readLegacy(storage, connection.id)).toBe(legacy);
    expect(repository.getEnvelope(connection.id)).toBeNull();
  });

  it("creates and clears an envelope in the same CAS transaction as metadata", async () => {
    const { repository } = await createRepository();
    const service = new ChatProviderSecretService(repository, createKeyProvider());
    const created = await service.createConnection({
      providerKind: "telegram",
      displayName: "Unconfigured connector",
      bridgeMode: "webhook",
    });
    service.updateVerification(created.id, "verified", { endpoint: "ready" });

    const configured = await service.updateConnection(created.id, {
      displayName: "Configured connector",
      setup: { webhookUrl: "https://example.test/telegram" },
      secrets: { botToken: "configured-token" },
    });
    expect(configured).toMatchObject({
      displayName: "Configured connector",
      setup: { webhookUrl: "https://example.test/telegram" },
      verificationStatus: "unverified",
      secretVersion: 1,
    });
    expect(repository.getEnvelope(created.id)).not.toBeNull();

    const cleared = await service.updateConnection(created.id, {
      displayName: "Cleared connector",
      secrets: null,
    });
    expect(cleared).toMatchObject({
      displayName: "Cleared connector",
      verificationStatus: "unverified",
      secretVersion: 2,
    });
    expect(repository.getEnvelope(created.id)).toBeNull();
  });

  it("allows only one concurrent metadata and secret update to win the expected-version CAS", async () => {
    const { repository } = await createRepository();
    const service = new ChatProviderSecretService(repository, createKeyProvider());
    const connection = await service.createConnection({
      providerKind: "slack",
      displayName: "CAS baseline",
      secrets: { signingSecret: "baseline-secret" },
    });

    const results = await Promise.allSettled([
      service.updateConnection(connection.id, {
        displayName: "CAS winner A",
        secrets: { signingSecret: "secret-a" },
      }),
      service.updateConnection(connection.id, {
        displayName: "CAS winner B",
        secrets: { signingSecret: "secret-b" },
      }),
    ]);

    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.updateConnection>>> => (
      result.status === "fulfilled"
    ));
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ name: "ChatProviderConcurrentModificationError" });
    expect(repository.getConnection(connection.id)).toMatchObject({
      displayName: fulfilled[0].value.displayName,
      secretVersion: 2,
    });
    const resolved = await service.resolveConnection(connection.id);
    expect(resolved.secrets).toEqual({
      signingSecret: fulfilled[0].value.displayName === "CAS winner A" ? "secret-a" : "secret-b",
    });
  });

  it("rolls back metadata, verification, version, legacy plaintext, and envelope when envelope creation fails", async () => {
    const { storage, repository } = await createRepository();
    const service = new ChatProviderSecretService(repository, createKeyProvider());
    const connection = await service.createConnection({
      providerKind: "slack",
      displayName: "Create rollback",
      bridgeMode: "webhook",
      setup: { eventsUrl: "https://example.test/original" },
    });
    service.updateVerification(connection.id, "verified", { endpoint: "original" });
    storage.getDatabase().prepare("UPDATE chat_provider_connections SET secret_json = ? WHERE id = ?")
      .run('{"signingSecret":"legacy-create"}', connection.id);
    const before = readAtomicSnapshot(storage, connection.id);
    storage.getDatabase().exec(`
      CREATE TRIGGER fail_chat_provider_secret_create
      BEFORE INSERT ON chat_provider_connection_secrets
      BEGIN
        SELECT RAISE(ABORT, 'injected envelope creation failure');
      END
    `);

    await expect(service.updateConnection(connection.id, {
      displayName: "Must roll back",
      status: "disabled",
      setup: { eventsUrl: "https://example.test/changed" },
      secrets: { signingSecret: "new-create-secret" },
    })).rejects.toThrow("injected envelope creation failure");

    expect(readAtomicSnapshot(storage, connection.id)).toEqual(before);
  });

  it("rolls back metadata and the existing envelope when envelope replacement fails", async () => {
    const { storage, repository } = await createRepository();
    const service = new ChatProviderSecretService(repository, createKeyProvider());
    const connection = await service.createConnection({
      providerKind: "discord",
      displayName: "Replace rollback",
      bridgeMode: "webhook",
      setup: { gatewayUrl: "https://example.test/original" },
      secrets: { botToken: "original-token" },
    });
    service.updateVerification(connection.id, "verified", { endpoint: "original" });
    storage.getDatabase().prepare("UPDATE chat_provider_connections SET secret_json = ? WHERE id = ?")
      .run('{"botToken":"legacy-replace"}', connection.id);
    const before = readAtomicSnapshot(storage, connection.id);
    storage.getDatabase().exec(`
      CREATE TRIGGER fail_chat_provider_secret_replace
      BEFORE INSERT ON chat_provider_connection_secrets
      BEGIN
        SELECT RAISE(ABORT, 'injected envelope replacement failure');
      END
    `);

    await expect(service.updateConnection(connection.id, {
      displayName: "Must roll back",
      enabled: false,
      setup: { gatewayUrl: "https://example.test/changed" },
      secrets: { botToken: "replacement-token" },
    })).rejects.toThrow("injected envelope replacement failure");

    expect(readAtomicSnapshot(storage, connection.id)).toEqual(before);
    expect((await service.resolveConnection(connection.id)).secrets).toEqual({ botToken: "original-token" });
  });

  it("rolls back metadata and the existing envelope when envelope clearing fails", async () => {
    const { storage, repository } = await createRepository();
    const service = new ChatProviderSecretService(repository, createKeyProvider());
    const connection = await service.createConnection({
      providerKind: "telegram",
      displayName: "Clear rollback",
      bridgeMode: "webhook",
      secrets: { botToken: "original-token" },
    });
    service.updateVerification(connection.id, "verified", { endpoint: "original" });
    storage.getDatabase().prepare("UPDATE chat_provider_connections SET secret_json = ? WHERE id = ?")
      .run('{"botToken":"legacy-clear"}', connection.id);
    const before = readAtomicSnapshot(storage, connection.id);
    storage.getDatabase().exec(`
      CREATE TRIGGER fail_chat_provider_secret_clear
      BEFORE DELETE ON chat_provider_connection_secrets
      BEGIN
        SELECT RAISE(ABORT, 'injected envelope clear failure');
      END
    `);

    await expect(service.updateConnection(connection.id, {
      displayName: "Must roll back",
      secrets: null,
    })).rejects.toThrow("injected envelope clear failure");

    expect(readAtomicSnapshot(storage, connection.id)).toEqual(before);
    expect((await service.resolveConnection(connection.id)).secrets).toEqual({ botToken: "original-token" });
  });

  it("commits each legacy seal atomically, resumes after a partial failure, and is idempotent", async () => {
    const { storage, repository } = await createRepository();
    const first = repository.createConnection({ providerKind: "discord", displayName: "Legacy one" });
    const second = repository.createConnection({ providerKind: "discord", displayName: "Legacy two" });
    storage.getDatabase().prepare("UPDATE chat_provider_connections SET secret_json = ? WHERE id = ?")
      .run('{"botToken":"first-secret"}', first.id);
    storage.getDatabase().prepare("UPDATE chat_provider_connections SET secret_json = ? WHERE id = ?")
      .run('{"botToken":"second-secret"}', second.id);
    let activeReads = 0;
    let failSecond = true;
    const provider = createKeyProvider(true, () => {
      activeReads += 1;
      if (failSecond && activeReads === 2) throw new Error("fixture encryption interruption");
    });
    const service = new ChatProviderSecretService(repository, provider);

    const partial = await service.migrateLegacySecrets();
    expect(partial).toMatchObject({ status: "partial", migrated: 1, pending: 1 });
    expect(readLegacy(storage, first.id)).toBeNull();
    expect(readLegacy(storage, second.id)).toBe('{"botToken":"second-secret"}');
    expect(repository.getEnvelope(first.id)).not.toBeNull();
    expect(repository.getEnvelope(second.id)).toBeNull();

    failSecond = false;
    const resumed = await service.migrateLegacySecrets();
    expect(resumed).toMatchObject({ status: "ready", migrated: 1, pending: 0 });
    expect(readLegacy(storage, second.id)).toBeNull();
    expect((await service.resolveConnection(second.id)).secrets).toEqual({ botToken: "second-secret" });
    await expect(service.migrateLegacySecrets()).resolves.toEqual({ status: "ready", migrated: 0, pending: 0, failures: [] });
  });
});

async function createRepository(): Promise<{ storage: AppDbStorage; repository: ChatProviderRepository }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-secret-"));
  directories.push(directory);
  const storage = new AppDbStorage(path.join(directory, "app.db"));
  storages.push(storage);
  return { storage, repository: new ChatProviderRepository(storage) };
}

function createKeyProvider(available = true, beforeActiveRead?: () => void): KeyProvider {
  const rootKey = Buffer.alloc(32, 17);
  return {
    providerName: "fixture-key-provider",
    health: async () => ({
      available,
      secure: true,
      provider: "fixture-key-provider",
      keyId: available ? "fixture-root" : null,
      keyVersion: available ? 1 : null,
      reason: available ? undefined : "fixture key unavailable",
    }),
    getActiveKey: async () => {
      beforeActiveRead?.();
      return { key: Buffer.from(rootKey), keyId: "fixture-root", version: 1 };
    },
    getKey: async () => ({ key: Buffer.from(rootKey), keyId: "fixture-root", version: 1 }),
  };
}

function readLegacy(storage: AppDbStorage, connectionId: string): string | null {
  const row = storage.getDatabase().prepare("SELECT secret_json FROM chat_provider_connections WHERE id = ?")
    .get(connectionId) as { secret_json: string | null };
  return row.secret_json;
}

function readAtomicSnapshot(storage: AppDbStorage, connectionId: string): Record<string, unknown> {
  const connection = storage.getDatabase().prepare(`
    SELECT display_name, bridge_mode, status, enabled, setup_json, secret_json,
           verification_status, verification_details_json, verified_at, secret_version, updated_at
    FROM chat_provider_connections
    WHERE id = ?
  `).get(connectionId) as Record<string, unknown>;
  const envelope = storage.getDatabase().prepare(`
    SELECT hex(ciphertext) AS ciphertext, hex(nonce) AS nonce, hex(auth_tag) AS auth_tag,
           hex(wrapped_data_key) AS wrapped_data_key, hex(wrap_nonce) AS wrap_nonce,
           hex(wrap_auth_tag) AS wrap_auth_tag, key_id, key_version, secret_keys_json, updated_at
    FROM chat_provider_connection_secrets
    WHERE provider_connection_id = ?
  `).get(connectionId) as Record<string, unknown> | undefined;
  return { connection, envelope: envelope ?? null };
}
