import { readFile, stat } from "node:fs/promises";
import type { CredentialBackendHealth } from "../../contracts/automation-credential-types.js";
import { KeyProviderUnavailableError, type KeyMaterial, type KeyProvider } from "../../services/credentials/key-provider.js";

export class MountedKeyFileProvider implements KeyProvider {
  readonly providerName = "mounted-key-file";
  constructor(private readonly filePath: string | undefined, private readonly keyId = "mounted-root", private readonly version = 1) {}

  async health(): Promise<CredentialBackendHealth> {
    try {
      const material = await this.read();
      material.key.fill(0);
      return { available: true, secure: true, provider: this.providerName, keyId: this.keyId, keyVersion: this.version };
    } catch (error) {
      const reason=error instanceof Error ? error.message : String(error);
      return { available: false, secure: !reason.includes("insecure permissions"), provider: this.providerName, keyId: null, keyVersion: null, reason };
    }
  }

  getActiveKey(): Promise<KeyMaterial> { return this.read(); }
  async getKey(keyId: string, version: number): Promise<KeyMaterial> {
    if (keyId !== this.keyId || version !== this.version) throw new KeyProviderUnavailableError("Requested root key version is unavailable.");
    return this.read();
  }

  private async read(): Promise<KeyMaterial> {
    if (!this.filePath) throw new KeyProviderUnavailableError("No mounted credential key file is configured.");
    try { const info=await stat(this.filePath); if ((info.mode & 0o077) !== 0) throw new KeyProviderUnavailableError("Mounted credential key file has insecure permissions; expected owner-only access."); }
    catch (error) { if (error instanceof KeyProviderUnavailableError) throw error; throw new KeyProviderUnavailableError("Mounted credential key file is unavailable."); }
    let raw: Buffer;
    try { raw = await readFile(this.filePath); } catch { throw new KeyProviderUnavailableError("Mounted credential key file is unavailable."); }
    const trimmed = raw.toString("utf8").trim();
    raw.fill(0);
    const key = /^[a-f\d]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
    if (key.length !== 32) { key.fill(0); throw new KeyProviderUnavailableError("Mounted credential key must decode to exactly 32 bytes."); }
    return { key, keyId: this.keyId, version: this.version };
  }
}
