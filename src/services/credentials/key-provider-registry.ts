import type { KeyProvider } from "./key-provider.js";

let processKeyProvider: KeyProvider | null = null;

/** Configures a host-specific provider before dependency construction (for example Electron safeStorage). */
export function setProcessCredentialKeyProvider(provider: KeyProvider): void {
  if (processKeyProvider) throw new Error("The process credential key provider is already configured.");
  processKeyProvider = provider;
}

export function getProcessCredentialKeyProvider(): KeyProvider | null {
  return processKeyProvider;
}
