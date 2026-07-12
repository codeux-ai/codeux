export interface SecretContext {
  credentialId: string;
  projectId: string;
  workspaceId: string;
}

export interface StoredSecretEnvelope {
  credentialId: string;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  wrapNonce: Buffer;
  wrapAuthTag: Buffer;
  keyId: string;
  keyVersion: number;
}

export interface SecretStore {
  put(context: SecretContext, plaintext: Buffer): Promise<StoredSecretEnvelope>;
  get(context: SecretContext): Promise<Buffer>;
  delete(credentialId: string): Promise<void>;
}
