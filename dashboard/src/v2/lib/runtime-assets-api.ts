import type { ProviderId, ProviderToolStatus, RuntimeAssetsStatus } from "../../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchRuntimeAssetsStatus = async (): Promise<RuntimeAssetsStatus> => (
  await fetchJson<RuntimeAssetsStatus>("/api/runtime-assets/status", { cache: "no-store" })
);

export const prepareProviderTool = async (provider: ProviderId): Promise<ProviderToolStatus> => (
  await fetchJson<ProviderToolStatus>(`/api/provider-tools/${encodeURIComponent(provider)}/prepare`, {
    method: "POST",
  })
);

