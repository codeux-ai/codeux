import type {
  ClusterSettingsSyncErrorDetails,
  ClusterSettingsSyncRequest,
  ClusterSettingsSyncResult,
  ClusterSettingsSyncScope,
} from "../contracts/cluster-types.js";
import type { ManageSettingsArgs } from "../contracts/internal-management-types.js";
import type {
  ProjectSettings,
  SystemClusterConnectionSettings,
  SystemProviderCredentialSettings,
  SystemSettings,
} from "../contracts/settings-scope-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { redactText } from "../shared/security/redaction.js";
import { ClusterServerClient } from "./cluster-server-client.js";

export interface ClusterSettingsSyncServiceDeps {
  settingsRepository: SettingsRepository;
  logger?: Logger;
  createClient?: (args: { remoteUrl: string; bearerToken: string; logger?: Logger }) => Pick<ClusterServerClient, "listTools" | "callManageSettings" | "close">;
  resolveBearerToken?: (connection: SystemClusterConnectionSettings) => string | undefined | Promise<string | undefined>;
}

interface SyncPatch {
  scope: ClusterSettingsSyncScope;
  args: ManageSettingsArgs;
}

export class ClusterSettingsSyncService {
  private readonly settingsRepository: SettingsRepository;
  private readonly logger?: Logger;
  private readonly createClient: NonNullable<ClusterSettingsSyncServiceDeps["createClient"]>;
  private readonly resolveBearerToken?: ClusterSettingsSyncServiceDeps["resolveBearerToken"];

  constructor(deps: ClusterSettingsSyncServiceDeps) {
    this.settingsRepository = deps.settingsRepository;
    this.logger = deps.logger;
    this.createClient = deps.createClient ?? ((args) => new ClusterServerClient(args));
    this.resolveBearerToken = deps.resolveBearerToken;
  }

  async syncSettings(request: ClusterSettingsSyncRequest = {}): Promise<ClusterSettingsSyncResult> {
    const systemSettings = this.settingsRepository.getSystemSettings();
    const connection = this.selectConnection(systemSettings, request.connectionId);
    const changedSettingsScope = this.buildChangedSettingsScope(connection);
    const baseResult = {
      remoteUrl: connection.url,
      connectionId: connection.id,
      changedSettingsScope,
    };
    const secrets = this.collectSecrets(systemSettings, request.bearerToken);

    try {
      const bearerToken = await this.getBearerToken(connection, request);
      if (!bearerToken) {
        throw new Error(`Missing bearer token for cluster connection '${connection.id}'.`);
      }
      secrets.add(bearerToken);

      if (changedSettingsScope.length === 0) {
        this.logger?.info("Cluster settings sync skipped because all sync policy flags are disabled.", {
          logPurpose: "settings",
          remoteUrl: connection.url,
          connectionId: connection.id,
          changedSettingsScope,
        });
        return {
          ...baseResult,
          approvalRequired: false,
          applied: false,
        };
      }

      const patches = this.buildSyncPatches(systemSettings, connection, request.approval?.confirmed === true);
      const client = this.createClient({ remoteUrl: connection.url, bearerToken, logger: this.logger });
      try {
        const tools = await client.listTools();
        if (!tools.tools.some((tool) => tool.name === "manage_settings")) {
          throw new Error("Remote Code UX server does not expose manage_settings.");
        }

        let approvalRequired = false;
        let approvalMessage: string | undefined;
        let applied = true;

        for (const patch of patches) {
          const response = await client.callManageSettings(patch.args);
          if (response.envelope.approvalRequired) {
            approvalRequired = true;
            approvalMessage = response.envelope.approvalMessage;
            applied = false;
          }
        }

        this.logger?.info("Cluster settings sync completed.", {
          logPurpose: "settings",
          remoteUrl: connection.url,
          connectionId: connection.id,
          changedSettingsScope,
          approvalRequired,
        });

        return {
          ...baseResult,
          approvalRequired,
          ...(approvalMessage ? { approvalMessage: this.sanitizeText(approvalMessage, secrets) } : {}),
          applied,
        };
      } finally {
        await client.close();
      }
    } catch (error) {
      const sanitizedError = this.sanitizeError(error, secrets);
      this.logger?.warn("Cluster settings sync failed.", {
        logPurpose: "settings",
        remoteUrl: connection.url,
        connectionId: connection.id,
        changedSettingsScope,
        error: sanitizedError,
      });
      return {
        ...baseResult,
        approvalRequired: false,
        applied: false,
        error: sanitizedError,
      };
    }
  }

  private selectConnection(settings: SystemSettings, connectionId?: string): SystemClusterConnectionSettings {
    const connections = settings.cluster.connections.filter((connection) => connection.enabled);
    const connection = connectionId
      ? settings.cluster.connections.find((candidate) => candidate.id === connectionId)
      : connections[0];

    if (!connection) {
      throw new Error(connectionId
        ? `Cluster connection '${connectionId}' was not found.`
        : "No enabled cluster connection is configured.");
    }
    if (!connection.enabled) {
      throw new Error(`Cluster connection '${connection.id}' is disabled.`);
    }
    return connection;
  }

  private async getBearerToken(
    connection: SystemClusterConnectionSettings,
    request: ClusterSettingsSyncRequest,
  ): Promise<string | undefined> {
    const direct = typeof request.bearerToken === "string" ? request.bearerToken.trim() : "";
    if (direct) {
      return direct;
    }
    const resolved = await this.resolveBearerToken?.(connection);
    return typeof resolved === "string" ? resolved.trim() || undefined : undefined;
  }

  private buildChangedSettingsScope(connection: SystemClusterConnectionSettings): ClusterSettingsSyncScope[] {
    const scopes: ClusterSettingsSyncScope[] = [];
    if (connection.syncPolicy.systemSettings) {
      scopes.push("runtime", "defaults", "mcpTools", "customMcpServers", "modelPricing");
    }
    if (connection.syncPolicy.providerSettings) {
      scopes.push("providerSettings");
    }
    return scopes;
  }

  private buildSyncPatches(
    settings: SystemSettings,
    connection: SystemClusterConnectionSettings,
    confirmed: boolean,
  ): SyncPatch[] {
    const patches: SyncPatch[] = [];
    const approval = { confirmed };

    if (connection.syncPolicy.systemSettings) {
      patches.push(
        this.createPatch("runtime", "runtime", settings.runtime, approval),
        this.createPatch("defaults", "defaults", sanitizeProjectDefaultsForClusterSync(settings.defaults), approval),
        this.createPatch("mcpTools", "mcpTools", settings.mcpTools.map((tool) => ({ ...tool })), approval),
        this.createPatch("customMcpServers", "customMcpServers", settings.customMcpServers.map((server) => ({ ...server })), approval),
        this.createPatch("modelPricing", "modelPricing", { overrides: { ...settings.modelPricing.overrides } }, approval),
      );
    }

    if (connection.syncPolicy.providerSettings) {
      patches.push(this.createPatch(
        "providerSettings",
        "integrations.providers",
        Object.fromEntries(
          Object.entries(settings.integrations.providers).map(([id, provider]) => [
            id,
            sanitizeProviderForClusterSync(provider),
          ]),
        ),
        approval,
      ));
    }

    return patches;
  }

  private createPatch(
    scope: ClusterSettingsSyncScope,
    path: string,
    value: unknown,
    approval: { confirmed: boolean },
  ): SyncPatch {
    return {
      scope,
      args: {
        action: "patch_system_setting",
        path,
        value,
        approval,
      },
    };
  }

  private collectSecrets(settings: SystemSettings, bearerToken?: string): Set<string> {
    const secrets = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === "string" && value.length >= 6) {
        secrets.add(value);
      }
    };
    add(bearerToken);
    add(settings.integrations.githubToken);
    add(settings.integrations.gitlabToken);
    add(settings.integrations.jira.apiToken);
    for (const provider of Object.values(settings.integrations.providers)) {
      add(provider.apiKey);
      add(provider.authPath);
    }
    return secrets;
  }

  private sanitizeError(error: unknown, secrets: Set<string>): ClusterSettingsSyncErrorDetails {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: this.sanitizeText(error.message, secrets),
        ...(error.stack ? { stack: this.sanitizeText(error.stack, secrets) } : {}),
      };
    }
    return { message: this.sanitizeText(String(error), secrets) };
  }

  private sanitizeText(value: string, secrets: Set<string>): string {
    let sanitized = redactText(value);
    for (const secret of secrets) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
    return sanitized;
  }
}

function sanitizeProjectDefaultsForClusterSync(defaults: ProjectSettings): ProjectSettings {
  return {
    ...defaults,
    git: {
      ...defaults.git,
      githubToken: "",
      gitlabToken: "",
    },
    jira: {
      ...defaults.jira,
      apiToken: "",
    },
  };
}

function sanitizeProviderForClusterSync(provider: SystemProviderCredentialSettings): SystemProviderCredentialSettings {
  const sanitized: SystemProviderCredentialSettings = {
    ...provider,
    mountAuth: false,
    authPath: "",
  };
  delete sanitized.lastLoginAt;
  if (provider.apiKey) {
    sanitized.authType = "apiKey";
  } else {
    delete sanitized.authType;
  }
  return sanitized;
}
