import type { SettingsCredentialReference } from "../../../contracts/app-types.js";

const CREDENTIAL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

/** Accepts only the stable, non-secret settings reference contract. */
export function sanitizeSettingsCredentialReference(value: unknown): SettingsCredentialReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const credentialId = typeof input.credentialId === "string" ? input.credentialId.trim() : "";
  if (!CREDENTIAL_ID_PATTERN.test(credentialId) || input.capability !== "read") return null;
  return { credentialId, capability: "read" };
}

const SECRET_SETTING_KEY = /^(?:apiKey|apiToken|apiSecret|githubToken|gitlabToken|[a-zA-Z0-9]+ApiKey)$/;

/** Clones an arbitrary sparse settings payload while removing legacy secret text. */
export function redactSettingsCredentialValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => redactSettingsCredentialValues(entry)) as T;
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_SETTING_KEY.test(key)) {
      output[key] = "";
    } else if (key.endsWith("CredentialRef")) {
      output[key] = sanitizeSettingsCredentialReference(nested);
    } else {
      output[key] = redactSettingsCredentialValues(nested);
    }
  }
  return output as T;
}
