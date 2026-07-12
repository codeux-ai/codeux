import type { KeyProvider } from "../../services/credentials/key-provider.js";
import type { SecretContext, SecretStore, StoredSecretEnvelope } from "../../services/credentials/secret-store.js";
import { decryptEnvelope, encryptEnvelope } from "../../services/credentials/encryption-utils.js";
import type { AutomationCredentialRepository } from "../../repositories/automation-credential-repository.js";

export class EncryptedSqliteSecretStore implements SecretStore {
  constructor(private readonly repository: AutomationCredentialRepository, private readonly keyProvider: KeyProvider) {}
  async seal(context: SecretContext, plaintext: Buffer): Promise<StoredSecretEnvelope> {
    const health = await this.keyProvider.health();
    if (!health.available || !health.secure) throw new Error(health.reason ?? "Secure key provider is unavailable.");
    const rootKey = await this.keyProvider.getActiveKey();
    try { return encryptEnvelope(context, plaintext, rootKey); }
    finally { rootKey.key.fill(0); }
  }
  async get(context: SecretContext): Promise<Buffer> {
    const envelope=this.repository.getEnvelope(context.credentialId); if (!envelope) throw new Error("Credential secret is unavailable.");
    const rootKey=await this.keyProvider.getKey(envelope.keyId,envelope.keyVersion);
    try { return decryptEnvelope(context,envelope,rootKey); } finally { rootKey.key.fill(0); }
  }
}
