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
