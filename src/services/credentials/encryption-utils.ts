import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyMaterial } from "./key-provider.js";
import type { SecretContext, StoredSecretEnvelope } from "./secret-store.js";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;

function aad(context: SecretContext, purpose: "credential" | "data-key"): Buffer {
  return Buffer.from(JSON.stringify({
    credentialId: context.credentialId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    purpose,
    schema: 1,
  }), "utf8");
}

function encrypt(key: Buffer, plaintext: Buffer, associatedData: Buffer): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function decrypt(key: Buffer, ciphertext: Buffer, nonce: Buffer, authTag: Buffer, associatedData: Buffer): Buffer {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAAD(associatedData);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptEnvelope(context: SecretContext, plaintext: Buffer, rootKey: KeyMaterial): StoredSecretEnvelope {
  const dataKey = randomBytes(32);
  try {
    const payload = encrypt(dataKey, plaintext, aad(context, "credential"));
    const wrapped = encrypt(rootKey.key, dataKey, aad(context, "data-key"));
    return {
      credentialId: context.credentialId,
      ciphertext: payload.ciphertext,
      nonce: payload.nonce,
      authTag: payload.authTag,
      wrappedDataKey: wrapped.ciphertext,
      wrapNonce: wrapped.nonce,
      wrapAuthTag: wrapped.authTag,
      keyId: rootKey.keyId,
      keyVersion: rootKey.version,
    };
  } finally {
    dataKey.fill(0);
  }
}

export function decryptEnvelope(context: SecretContext, envelope: StoredSecretEnvelope, rootKey: KeyMaterial): Buffer {
  const dataKey = decrypt(rootKey.key, envelope.wrappedDataKey, envelope.wrapNonce, envelope.wrapAuthTag, aad(context, "data-key"));
  try {
    return decrypt(dataKey, envelope.ciphertext, envelope.nonce, envelope.authTag, aad(context, "credential"));
  } finally {
    dataKey.fill(0);
  }
}
