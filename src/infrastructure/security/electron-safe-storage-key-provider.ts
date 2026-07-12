import { randomBytes } from "node:crypto";
import type { CredentialBackendHealth } from "../../contracts/automation-credential-types.js";
import { KeyProviderUnavailableError, type KeyMaterial, type KeyProvider } from "../../services/credentials/key-provider.js";

export interface ElectronSafeStorageBoundary {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface ProtectedKeyPersistence {
  read(): Promise<Buffer | null>;
  /** Atomically installs the value only when no protected key exists yet. */
  writeIfAbsent(value: Buffer): Promise<boolean>;
}

export class ElectronSafeStorageKeyProvider implements KeyProvider {
  readonly providerName = "electron-safe-storage";
  private initialization: Promise<void> | null = null;
  constructor(private readonly safeStorage: ElectronSafeStorageBoundary, private readonly persistence: ProtectedKeyPersistence, private readonly keyId = "electron-root", private readonly version = 1) {}

  async health(): Promise<CredentialBackendHealth> {
    if (!this.safeStorage.isEncryptionAvailable()) return { available: false, secure: false, provider: this.providerName, keyId: null, keyVersion: null, reason: "OS secure storage is unavailable." };
    try { const key = await this.getActiveKey(); key.key.fill(0); return { available: true, secure: true, provider: this.providerName, keyId: this.keyId, keyVersion: this.version }; }
    catch (error) { return { available: false, secure: false, provider: this.providerName, keyId: null, keyVersion: null, reason: error instanceof Error ? error.message : String(error) }; }
  }

  async getActiveKey(): Promise<KeyMaterial> {
    if (!this.safeStorage.isEncryptionAvailable()) throw new KeyProviderUnavailableError("OS secure storage is unavailable.");
    await this.ensureInitialized();
    const protectedValue = await this.persistence.read();
    if (!protectedValue) throw new KeyProviderUnavailableError("Protected credential root key disappeared after initialization.");
    const encoded = this.safeStorage.decryptString(protectedValue);
    const key = /^[a-zA-Z0-9+/]{43}=$/.test(encoded) ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
    if (key.length !== 32) { key.fill(0); throw new KeyProviderUnavailableError("Protected credential root key is invalid."); }
    return { key, keyId: this.keyId, version: this.version };
  }

  async getKey(keyId: string, version: number): Promise<KeyMaterial> {
    if (keyId !== this.keyId || version !== this.version) throw new KeyProviderUnavailableError("Requested OS-protected key version is unavailable.");
    return this.getActiveKey();
  }

  private async ensureInitialized(): Promise<void> {
    if (await this.persistence.read()) return;
    if (!this.initialization) {
      this.initialization = this.initialize().finally(() => {
        this.initialization = null;
      });
    }
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    if (await this.persistence.read()) return;
    const generated = randomBytes(32);
    try {
      const protectedValue = this.safeStorage.encryptString(generated.toString("base64"));
      await this.persistence.writeIfAbsent(protectedValue);
    } finally {
      generated.fill(0);
    }
  }
}
