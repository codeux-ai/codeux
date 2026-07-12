import type {
  DashboardSettings,
  ProviderConfigId,
  ProviderSettings,
} from "../../contracts/app-types.js";
import type { JulesApiClient } from "../../integrations/jules-api-client.js";

function resolveJulesProvider(
  settings: DashboardSettings,
  providerConfigId?: ProviderConfigId | null,
): ProviderSettings | null {
  if (providerConfigId) {
    const provider = settings.aiProvider.providers[providerConfigId];
    if (provider?.provider === "jules") return provider;
  }
  return Object.values(settings.aiProvider.providers).find((provider) => (
    provider.provider === "jules" && provider.enabled
  )) ?? Object.values(settings.aiProvider.providers).find((provider) => provider.provider === "jules") ?? null;
}

/**
 * Installs only broker reference metadata in async request context. The Jules
 * client resolves the value independently for every HTTP attempt.
 */
export async function withJulesSettingsCredentialContext<T>(args: {
  julesApi: JulesApiClient;
  settings: DashboardSettings;
  projectId?: string | null;
  providerConfigId?: ProviderConfigId | null;
  consumer: string;
  workspaceId?: string;
}, consumer: () => T | Promise<T>): Promise<T> {
  const provider = resolveJulesProvider(args.settings, args.providerConfigId);
  const reference = provider?.apiKeyCredentialRef;
  if (!reference) return await consumer();

  const projectId = args.projectId?.trim();
  if (!projectId) {
    throw new Error("Broker-resolved Jules credentials require an active project scope.");
  }
  return await args.julesApi.withCredentialContext({
    projectId,
    reference,
    consumer: args.consumer,
    workspaceId: args.workspaceId,
  }, consumer);
}
