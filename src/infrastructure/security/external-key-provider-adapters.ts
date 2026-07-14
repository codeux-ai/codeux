import type { CredentialBackendHealth } from "../../contracts/automation-credential-types.js";
import { KeyProviderUnavailableError, type KeyMaterial, type KeyProvider } from "../../services/credentials/key-provider.js";

export interface ExternalKeyServiceClient {
  health(): Promise<{ available: boolean; reason?: string }>;
  /** Returned key bytes are caller-owned and will be zeroed after use. */
  activeKey(): Promise<KeyMaterial>;
  /** Returned key bytes are caller-owned and will be zeroed after use. */
  key(keyId: string, version: number): Promise<KeyMaterial>;
}

export class ExternalKeyProviderAdapter implements KeyProvider {
  constructor(readonly providerName: "vault" | "kms", private readonly client?: ExternalKeyServiceClient) {}
  async health(): Promise<CredentialBackendHealth> {
    if (!this.client) return { available: false, secure: true, provider: this.providerName, keyId: null, keyVersion: null, reason: `${this.providerName} integration is not configured.` };
    try {
      const health = await this.client.health();
      if (!health.available) return { available: false, secure: true, provider: this.providerName, keyId: null, keyVersion: null, reason: health.reason };
      const material = this.validate(await this.client.activeKey());
      try {
        return { available: true, secure: true, provider: this.providerName, keyId: material.keyId, keyVersion: material.version };
      } finally {
        material.key.fill(0);
      }
    } catch (error) {
      return { available: false, secure: true, provider: this.providerName, keyId: null, keyVersion: null, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  async getActiveKey(): Promise<KeyMaterial> {
    if (!this.client) throw new KeyProviderUnavailableError(`${this.providerName} integration is unavailable.`);
    return this.validate(await this.client.activeKey());
  }
  async getKey(keyId: string, version: number): Promise<KeyMaterial> {
    if (!this.client) throw new KeyProviderUnavailableError(`${this.providerName} integration is unavailable.`);
    return this.validate(await this.client.key(keyId, version), keyId, version);
  }

  private validate(material: KeyMaterial | null | undefined, expectedKeyId?: string, expectedVersion?: number): KeyMaterial {
    if (!material || !Buffer.isBuffer(material.key) || material.key.length !== 32) {
      material?.key?.fill?.(0);
      throw new KeyProviderUnavailableError(`${this.providerName} returned invalid root-key material.`);
    }
    if (!material.keyId || !Number.isSafeInteger(material.version) || material.version < 1) {
      material.key.fill(0);
      throw new KeyProviderUnavailableError(`${this.providerName} returned invalid root-key metadata.`);
    }
    if ((expectedKeyId !== undefined && material.keyId !== expectedKeyId) || (expectedVersion !== undefined && material.version !== expectedVersion)) {
      material.key.fill(0);
      throw new KeyProviderUnavailableError(`${this.providerName} returned a different root-key version than requested.`);
    }
    return material;
  }
}

export class VaultKeyProviderAdapter extends ExternalKeyProviderAdapter { constructor(client?: ExternalKeyServiceClient) { super("vault", client); } }
export class KmsKeyProviderAdapter extends ExternalKeyProviderAdapter { constructor(client?: ExternalKeyServiceClient) { super("kms", client); } }
