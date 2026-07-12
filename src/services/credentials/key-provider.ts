import type { CredentialBackendHealth } from "../../contracts/automation-credential-types.js";

export interface KeyMaterial {
  key: Buffer;
  keyId: string;
  version: number;
}

export interface KeyProvider {
  readonly providerName: string;
  health(): Promise<CredentialBackendHealth>;
  getActiveKey(): Promise<KeyMaterial>;
  getKey(keyId: string, version: number): Promise<KeyMaterial>;
}

export class KeyProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyProviderUnavailableError";
  }
}
