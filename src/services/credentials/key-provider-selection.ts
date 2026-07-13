import type { AppConfig } from "../../config/app-config.js";
import type { HeadlessSecurityConfiguration } from "../../contracts/headless-security-types.js";
import { KmsKeyProviderAdapter, VaultKeyProviderAdapter } from "../../infrastructure/security/external-key-provider-adapters.js";
import { LocalFileKeyProvider } from "../../infrastructure/security/local-file-key-provider.js";
import { MountedKeyFileProvider } from "../../infrastructure/security/mounted-key-file-provider.js";
import { getLocalCredentialRootKeyPath } from "../../shared/config/code-ux-paths.js";
import { getProcessCredentialKeyProvider } from "./key-provider-registry.js";
import type { KeyProvider } from "./key-provider.js";

type RuntimeMode = Pick<AppConfig, "serverMode" | "dashboardEnabled">;
type SecurityMode = Pick<HeadlessSecurityConfiguration, "mode" | "remoteCredentialManagement">;

export interface KeyProviderSelectionOptions {
  appConfig: RuntimeMode;
  security: SecurityMode;
  environment?: NodeJS.ProcessEnv;
  processProvider?: KeyProvider | null;
  localFilePath?: string;
}

function dashboardHostIsLocal(hostValue: string | undefined): boolean {
  const value = hostValue?.trim();
  if (!value) return true;
  const normalized = value.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }
  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

function explicitEnvironmentProvider(environment: NodeJS.ProcessEnv): KeyProvider | null {
  const configured = environment.CODE_UX_CREDENTIAL_KEY_PROVIDER?.trim().toLowerCase();
  const mountedFile = environment.CODE_UX_CREDENTIAL_KEY_FILE?.trim() || undefined;

  if (!configured) return mountedFile ? new MountedKeyFileProvider(mountedFile) : null;
  if (configured === "mounted-key-file") return new MountedKeyFileProvider(mountedFile);
  if (configured === "vault") return new VaultKeyProviderAdapter();
  if (configured === "kms") return new KmsKeyProviderAdapter();
  if (configured === "local-file") {
    throw new Error(
      "CODE_UX_CREDENTIAL_KEY_PROVIDER=local-file is not allowed; local-file custody is selected automatically only for the trusted local dashboard runtime.",
    );
  }
  throw new Error(
    `Unsupported CODE_UX_CREDENTIAL_KEY_PROVIDER value. Use mounted-key-file, vault, or kms.`,
  );
}

export function selectCredentialKeyProvider(options: KeyProviderSelectionOptions): KeyProvider {
  const processProvider = options.processProvider === undefined
    ? getProcessCredentialKeyProvider()
    : options.processProvider;
  if (processProvider) return processProvider;

  const environment = options.environment ?? process.env;
  const configuredProvider = explicitEnvironmentProvider(environment);
  if (configuredProvider) return configuredProvider;

  const automaticLocalCustodyAllowed = !options.appConfig.serverMode
    && options.appConfig.dashboardEnabled
    && options.security.mode === "local"
    && !options.security.remoteCredentialManagement
    && dashboardHostIsLocal(environment.DASHBOARD_HOST);
  if (automaticLocalCustodyAllowed) {
    return new LocalFileKeyProvider(options.localFilePath ?? getLocalCredentialRootKeyPath());
  }

  return new MountedKeyFileProvider(undefined);
}
