import type { SettingsCredentialReference } from "../../contracts/app-types.js";
import type { CredentialBroker } from "./credential-broker.js";

export interface SettingsCredentialRuntimeContext {
  projectId: string;
  consumer: string;
  workspaceId?: string;
}

export interface NamedSettingsCredentialReference {
  name: string;
  reference: unknown;
  consumer: string;
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

  /**
   * Resolves several references for one execution boundary while keeping every
   * broker-owned buffer alive only for the duration of the final callback.
   */
  async withCredentials<T>(
    references: NamedSettingsCredentialReference[],
    context: Omit<SettingsCredentialRuntimeContext, "consumer">,
    consumer: (secrets: ReadonlyMap<string, Buffer>) => T | Promise<T>,
  ): Promise<T> {
    const resolved = new Map<string, Buffer>();
    const visit = async (index: number): Promise<T> => {
      const item = references[index];
      if (!item) return await consumer(resolved);
      if (!item.name.trim() || resolved.has(item.name)) {
        throw new MalformedSettingsCredentialReferenceError();
      }
      return await this.withCredential(item.reference, {
        ...context,
        consumer: item.consumer,
      }, async (secret) => {
        resolved.set(item.name, secret);
        try {
          return await visit(index + 1);
        } finally {
          resolved.delete(item.name);
        }
      });
    };
    return await visit(0);
  }
}
