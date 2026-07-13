import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ElectronCredentialKeyPersistence } from "../../../src/electron/credential-key-persistence.js";
import { ElectronSafeStorageKeyProvider } from "../../../src/infrastructure/security/electron-safe-storage-key-provider.js";
import { KmsKeyProviderAdapter } from "../../../src/infrastructure/security/external-key-provider-adapters.js";
import { LocalFileKeyProvider } from "../../../src/infrastructure/security/local-file-key-provider.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";
import { selectCredentialKeyProvider } from "../../../src/services/credentials/key-provider-selection.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";
import { getLocalCredentialRootKeyPath } from "../../../src/shared/config/code-ux-paths.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "credential-key-provider-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("credential key providers", () => {
  it("constructs local root-key custody under the global Code UX home directory", () => {
    expect(getLocalCredentialRootKeyPath()).toBe(join(homedir(), ".code-ux", "security", "credential-root.key"));
  });

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

  it("provisions one owner-only local root key and reuses it across restarts", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "security", "credential-root.key");
    const selection = {
      appConfig: { serverMode: false, dashboardEnabled: true },
      security: { mode: "local" as const, remoteCredentialManagement: false },
      environment: {},
      processProvider: null,
      localFilePath: filePath,
    };

    const firstProvider = selectCredentialKeyProvider(selection);
    await expect(firstProvider.health()).resolves.toEqual({
      available: true,
      secure: true,
      provider: "local-file",
      keyId: "local-file-root",
      keyVersion: 1,
    });
    const first = await firstProvider.getActiveKey();
    const persisted = await readFile(filePath);
    expect(persisted).toHaveLength(32);
    expect(first.key.equals(persisted)).toBe(true);
    expect((await stat(dirname(filePath))).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    const restarted = await selectCredentialKeyProvider(selection).getActiveKey();
    expect(restarted.key.equals(first.key)).toBe(true);
    first.key.fill(0);
    restarted.key.fill(0);
    persisted.fill(0);
  });

  it("converges concurrent local provider initialization on one durable key", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "security", "credential-root.key");
    const providers = Array.from({ length: 16 }, () => new LocalFileKeyProvider(filePath));
    const materials = await Promise.all(providers.map((provider) => provider.getActiveKey()));

    expect(materials.every((material) => material.key.equals(materials[0]!.key))).toBe(true);
    const persisted = await readFile(filePath);
    expect(persisted.equals(materials[0]!.key)).toBe(true);
    materials.forEach((material) => material.key.fill(0));
    persisted.fill(0);
  });

  it("fails closed for malformed, permissive, and symbolic-link local key files", async () => {
    const dir = await tempDir();
    const malformedPath = join(dir, "malformed", "credential-root.key");
    await mkdir(dirname(malformedPath), { recursive: true, mode: 0o700 });
    await writeFile(malformedPath, Buffer.alloc(16, 7), { mode: 0o600 });
    const malformedHealth = await new LocalFileKeyProvider(malformedPath).health();
    expect(malformedHealth).toMatchObject({ available: false, secure: false, provider: "local-file" });
    expect(malformedHealth.reason).toMatch(/malformed/i);
    expect(malformedHealth.reason).not.toContain(dir);
    expect((await stat(malformedPath)).size).toBe(16);

    const permissivePath = join(dir, "permissive", "credential-root.key");
    await mkdir(dirname(permissivePath), { recursive: true, mode: 0o700 });
    await writeFile(permissivePath, Buffer.alloc(32, 8), { mode: 0o600 });
    await chmod(permissivePath, 0o644);
    await expect(new LocalFileKeyProvider(permissivePath).health()).resolves.toMatchObject({
      available: false,
      secure: false,
      reason: expect.stringMatching(/0600/),
    });
    expect((await stat(permissivePath)).mode & 0o777).toBe(0o644);

    const linkPath = join(dir, "linked", "credential-root.key");
    const targetPath = join(dir, "target.key");
    await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });
    await writeFile(targetPath, Buffer.alloc(32, 9), { mode: 0o600 });
    await symlink(targetPath, linkPath);
    await expect(new LocalFileKeyProvider(linkPath).health()).resolves.toMatchObject({
      available: false,
      secure: false,
      reason: expect.stringMatching(/symbolic link/),
    });
  });

  it("gives the Electron process provider precedence over environment configuration", () => {
    const electronProvider = {
      providerName: "electron-safe-storage",
      health: vi.fn(),
      getActiveKey: vi.fn(),
      getKey: vi.fn(),
    } as unknown as KeyProvider;
    const selected = selectCredentialKeyProvider({
      appConfig: { serverMode: false, dashboardEnabled: true },
      security: { mode: "local", remoteCredentialManagement: false },
      environment: { CODE_UX_CREDENTIAL_KEY_PROVIDER: "kms" },
      processProvider: electronProvider,
    });
    expect(selected).toBe(electronProvider);
  });

  it("gives supported environment providers precedence and rejects unsafe selections", () => {
    const base = {
      appConfig: { serverMode: false, dashboardEnabled: true },
      security: { mode: "local" as const, remoteCredentialManagement: false },
      processProvider: null,
    };
    expect(selectCredentialKeyProvider({
      ...base,
      environment: { CODE_UX_CREDENTIAL_KEY_PROVIDER: "kms" },
    }).providerName).toBe("kms");
    expect(selectCredentialKeyProvider({
      ...base,
      environment: { CODE_UX_CREDENTIAL_KEY_FILE: "/run/secrets/root-key" },
    }).providerName).toBe("mounted-key-file");
    expect(selectCredentialKeyProvider({
      ...base,
      environment: {
        CODE_UX_CREDENTIAL_KEY_PROVIDER: "mounted-key-file",
        CODE_UX_CREDENTIAL_KEY_FILE: "/run/secrets/root-key",
      },
    }).providerName).toBe("mounted-key-file");
    expect(() => selectCredentialKeyProvider({
      ...base,
      environment: { CODE_UX_CREDENTIAL_KEY_PROVIDER: "local-file" },
    })).toThrow(/not allowed/i);
    expect(() => selectCredentialKeyProvider({
      ...base,
      environment: { CODE_UX_CREDENTIAL_KEY_PROVIDER: "plaintext" },
    })).toThrow(/unsupported/i);
  });
});
