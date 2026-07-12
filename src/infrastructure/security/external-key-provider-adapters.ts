import type { CredentialBackendHealth } from "../../contracts/automation-credential-types.js";
import { KeyProviderUnavailableError, type KeyMaterial, type KeyProvider } from "../../services/credentials/key-provider.js";

export interface ExternalKeyServiceClient {
  health(): Promise<{ available: boolean; reason?: string }>;
  activeKey(): Promise<KeyMaterial>;
  key(keyId: string, version: number): Promise<KeyMaterial>;
}

export class ExternalKeyProviderAdapter implements KeyProvider {
  constructor(readonly providerName: "vault" | "kms", private readonly client?: ExternalKeyServiceClient) {}
  async health(): Promise<CredentialBackendHealth> {
    if (!this.client) return { available: false, secure: true, provider: this.providerName, keyId: null, keyVersion: null, reason: `${this.providerName} integration is not configured.` };
    const health = await this.client.health();
    return { available: health.available, secure: true, provider: this.providerName, keyId: null, keyVersion: null, reason: health.reason };
  }
  getActiveKey(): Promise<KeyMaterial> { if (!this.client) throw new KeyProviderUnavailableError(`${this.providerName} integration is unavailable.`); return this.client.activeKey(); }
  getKey(keyId: string, version: number): Promise<KeyMaterial> { if (!this.client) throw new KeyProviderUnavailableError(`${this.providerName} integration is unavailable.`); return this.client.key(keyId, version); }
}

export class VaultKeyProviderAdapter extends ExternalKeyProviderAdapter { constructor(client?: ExternalKeyServiceClient) { super("vault", client); } }
export class KmsKeyProviderAdapter extends ExternalKeyProviderAdapter { constructor(client?: ExternalKeyServiceClient) { super("kms", client); } }
