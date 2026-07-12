import type { SettingsCredentialReference } from "../../contracts/app-types.js";
import type { CredentialBroker } from "./credential-broker.js";

export interface SettingsCredentialRuntimeContext {
  projectId: string;
  consumer: string;
  workspaceId?: string;
}

export class MalformedSettingsCredentialReferenceError extends Error {
  constructor() {
    super("The settings credential reference is malformed.");
    this.name = "MalformedSettingsCredentialReferenceError";
  }
}

function validateReference(value: unknown): SettingsCredentialReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MalformedSettingsCredentialReferenceError();
  }
  const input = value as Record<string, unknown>;
  const credentialId = typeof input.credentialId === "string" ? input.credentialId.trim() : "";
  if (!credentialId || credentialId.length > 256 || input.capability !== "read") {
    throw new MalformedSettingsCredentialReferenceError();
  }
  return { credentialId, capability: "read" };
}

/** Resolves a settings reference only inside a bounded runtime callback. */
export class SettingsCredentialResolver {
  constructor(private readonly broker: CredentialBroker) {}

  async withCredential<T>(
    referenceValue: unknown,
    context: SettingsCredentialRuntimeContext,
    consumer: (secret: Buffer) => T | Promise<T>,
  ): Promise<T> {
    const reference = validateReference(referenceValue);
    const projectId = context.projectId.trim();
    const bindingKey = `settings:${context.consumer.trim()}`;
    if (!projectId || !context.consumer.trim()) throw new MalformedSettingsCredentialReferenceError();
    return this.broker.withResolvedCredentialId({
      projectId,
      credentialId: reference.credentialId,
      capability: reference.capability,
      bindingKey,
      workspaceId: context.workspaceId?.trim() || projectId,
    }, consumer);
  }
}
