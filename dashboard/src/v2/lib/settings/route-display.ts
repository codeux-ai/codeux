import type { InvocationRoutingId, ProjectSettings, ProviderConfigId } from "../../../types.js";

type InvocationRoute = ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId];

export function resolveRouteDisplayProviderPool(
  route: InvocationRoute,
  primaryProviderId: ProviderConfigId | null,
  providers: ProjectSettings["aiProvider"]["providers"],
): ProviderConfigId[] {
  if (route.strategy === "MANUAL") {
    return primaryProviderId ? [primaryProviderId] : [];
  }

  if (route.allowedProviders.length > 0) {
    return route.allowedProviders.filter((providerConfigId) => providers[providerConfigId]);
  }

  return primaryProviderId ? [primaryProviderId] : [];
}
