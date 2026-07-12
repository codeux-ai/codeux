import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElectronCredentialKeyPersistence } from "../../../src/electron/credential-key-persistence.js";
import { ElectronSafeStorageKeyProvider } from "../../../src/infrastructure/security/electron-safe-storage-key-provider.js";
import { KmsKeyProviderAdapter } from "../../../src/infrastructure/security/external-key-provider-adapters.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "credential-key-provider-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("credential key providers", () => {
  it("strictly validates mounted key files", async () => {
    const dir = await tempDir();
    const validPath = join(dir, "valid.key");
    await writeFile(validPath, Buffer.alloc(32, 3).toString("base64"), { mode: 0o600 });
    await expect(new MountedKeyFileProvider(validPath).health()).resolves.toMatchObject({ available: true, secure: true });
    const unpaddedPath = join(dir, "valid-unpadded.key");
    await writeFile(unpaddedPath, Buffer.alloc(32, 4).toString("base64").replace(/=$/, ""), { mode: 0o600 });
    await expect(new MountedKeyFileProvider(unpaddedPath).health()).resolves.toMatchObject({ available: true, secure: true });

    const malformedPath = join(dir, "malformed.key");
    await writeFile(malformedPath, `${"A".repeat(43)}!`, { mode: 0o600 });
    await expect(new MountedKeyFileProvider(malformedPath).health()).resolves.toMatchObject({ available: false });

    const oversizedPath = join(dir, "oversized.key");
    await writeFile(oversizedPath, "A".repeat(300), { mode: 0o600 });
    await expect(new MountedKeyFileProvider(oversizedPath).health()).resolves.toMatchObject({ available: false });

    await expect(new MountedKeyFileProvider(dir).health()).resolves.toMatchObject({ available: false });
  });

  it("serializes Electron root-key initialization and returns independent key buffers", async () => {
    let protectedValue: Buffer | null = null;
    const writeIfAbsent = vi.fn(async (value: Buffer) => {
      await Promise.resolve();
      if (protectedValue) return false;
      protectedValue = Buffer.from(value);
      return true;
    });
    const persistence = {
      read: vi.fn(async () => protectedValue ? Buffer.from(protectedValue) : null),
      writeIfAbsent,
    };
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8"),
    };
    const provider = new ElectronSafeStorageKeyProvider(safeStorage, persistence);
    const keys = await Promise.all(Array.from({ length: 16 }, () => provider.getActiveKey()));
    expect(writeIfAbsent).toHaveBeenCalledTimes(1);
    expect(keys.every((material) => material.key.equals(keys[0]!.key))).toBe(true);
    keys[0]!.key.fill(0);
    expect(keys[1]!.key.equals(Buffer.alloc(32))).toBe(false);
    keys.forEach((material) => material.key.fill(0));
  });

  it("reports active external key identity and rejects mismatched versions", async () => {
    const client = {
      health: vi.fn(async () => ({ available: true })),
      activeKey: vi.fn(async () => ({ key: Buffer.alloc(32, 5), keyId: "kms-root", version: 4 })),
      key: vi.fn(async () => ({ key: Buffer.alloc(32, 5), keyId: "kms-root", version: 4 })),
    };
    const provider = new KmsKeyProviderAdapter(client);
    await expect(provider.health()).resolves.toMatchObject({ available: true, secure: true, keyId: "kms-root", keyVersion: 4 });
    const key = await provider.getKey("kms-root", 4);
    expect(key.key).toHaveLength(32);
    key.key.fill(0);
    await expect(provider.getKey("kms-root", 3)).rejects.toThrow(/different root-key version/);
  });

  it("writes Electron protected-key blobs atomically with owner-only permissions", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "nested", "credential-root-key.bin");
    const persistence = new ElectronCredentialKeyPersistence(filePath);
    const protectedValue = Buffer.from("os-protected-value");
    await expect(persistence.writeIfAbsent(protectedValue)).resolves.toBe(true);
    await expect(persistence.writeIfAbsent(Buffer.from("different-protected-value"))).resolves.toBe(false);
    await expect(persistence.read()).resolves.toEqual(protectedValue);
    const info = await stat(filePath);
    expect(info.mode & 0o077).toBe(0);
  });

  it("keeps one recoverable Electron key across competing provider instances", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "credential-root-key.bin");
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      decryptString: (value: Buffer) => value.toString("utf8"),
    };
    const first = new ElectronSafeStorageKeyProvider(safeStorage, new ElectronCredentialKeyPersistence(filePath));
    const second = new ElectronSafeStorageKeyProvider(safeStorage, new ElectronCredentialKeyPersistence(filePath));
    const [firstKey, secondKey] = await Promise.all([first.getActiveKey(), second.getActiveKey()]);
    expect(firstKey.key.equals(secondKey.key)).toBe(true);
    firstKey.key.fill(0);
    secondKey.key.fill(0);
  });
});
