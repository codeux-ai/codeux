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
  /** Encrypts a value without persisting it so callers can commit it atomically with metadata. */
  seal(context: SecretContext, plaintext: Buffer): Promise<StoredSecretEnvelope>;
  get(context: SecretContext): Promise<Buffer>;
}
