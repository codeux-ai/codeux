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
  write(value: Buffer): Promise<void>;
}

export class ElectronSafeStorageKeyProvider implements KeyProvider {
  readonly providerName = "electron-safe-storage";
  constructor(private readonly safeStorage: ElectronSafeStorageBoundary, private readonly persistence: ProtectedKeyPersistence, private readonly keyId = "electron-root", private readonly version = 1) {}

  async health(): Promise<CredentialBackendHealth> {
    if (!this.safeStorage.isEncryptionAvailable()) return { available: false, secure: false, provider: this.providerName, keyId: null, keyVersion: null, reason: "OS secure storage is unavailable." };
    try { const key = await this.getActiveKey(); key.key.fill(0); return { available: true, secure: true, provider: this.providerName, keyId: this.keyId, keyVersion: this.version }; }
    catch (error) { return { available: false, secure: false, provider: this.providerName, keyId: null, keyVersion: null, reason: error instanceof Error ? error.message : String(error) }; }
  }

  async getActiveKey(): Promise<KeyMaterial> {
    if (!this.safeStorage.isEncryptionAvailable()) throw new KeyProviderUnavailableError("OS secure storage is unavailable.");
    let protectedValue = await this.persistence.read();
    if (!protectedValue) {
      const generated = randomBytes(32);
      try { protectedValue = this.safeStorage.encryptString(generated.toString("base64")); await this.persistence.write(protectedValue); }
      finally { generated.fill(0); }
    }
    const key = Buffer.from(this.safeStorage.decryptString(protectedValue), "base64");
    if (key.length !== 32) { key.fill(0); throw new KeyProviderUnavailableError("Protected credential root key is invalid."); }
    return { key, keyId: this.keyId, version: this.version };
  }

  async getKey(keyId: string, version: number): Promise<KeyMaterial> {
    if (keyId !== this.keyId || version !== this.version) throw new KeyProviderUnavailableError("Requested OS-protected key version is unavailable.");
    return this.getActiveKey();
  }
}
