import type {
  ChatProviderBridgeSetupSchema,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectorHealth,
  ChatProviderConnectionRecord,
  ChatProviderKind,
  ChatProviderPublicDeliveryRecord,
  ChatProviderSetupDefinition,
  ChatProviderSetupHints,
  ChatProviderVerificationOutcome,
  CreateChatProviderChannelBindingInput,
  CreateChatProviderConnectionInput,
  UpdateChatProviderChannelBindingInput,
  UpdateChatProviderConnectionInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export type DashboardChatProviderSetupDefinition = ChatProviderSetupDefinition;
export type DashboardChatProviderBridgeSetupSchema = ChatProviderBridgeSetupSchema & { setupHints?: ChatProviderSetupHints };
export type { ChatProviderSetupHints };

export interface DashboardChatProviderConnectionRecord extends ChatProviderConnectionRecord {
  ingressUrl: string;
  setupHints: ChatProviderSetupHints;
}

export interface FetchChatProviderConnectionsOptions {
  providerKind?: ChatProviderKind;
  enabledOnly?: boolean;
}

export interface FetchChatProviderChannelBindingsOptions {
  providerConnectionId?: string;
  projectId?: string;
  externalChannelId?: string;
  enabledOnly?: boolean;
}

export interface FetchChatProviderDeliveriesOptions {
  providerConnectionId?: string;
  channelBindingId?: string;
  externalChannelId?: string;
  direction?: "inbound" | "outbound";
  status?: ChatProviderPublicDeliveryRecord["status"];
  limit?: number;
}

const buildQuery = (params: Record<string, string | boolean | number | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
};

export const fetchChatProviderSetupDefinitions = async (): Promise<DashboardChatProviderSetupDefinition[]> => {
  const response = await fetchJson<{ providers: DashboardChatProviderSetupDefinition[] }>("/api/chat-providers/setup-definitions");
  return response.providers;
};

export const fetchChatProviderConnections = async (
  options: FetchChatProviderConnectionsOptions = {},
): Promise<DashboardChatProviderConnectionRecord[]> => {
  const response = await fetchJson<{ connections: DashboardChatProviderConnectionRecord[] }>(
    `/api/chat-providers/connections${buildQuery({
      providerKind: options.providerKind,
      enabledOnly: options.enabledOnly,
    })}`,
  );
  return response.connections;
};

export const fetchChatProviderConnection = async (
  connectionId: string,
): Promise<DashboardChatProviderConnectionRecord> => (
  fetchJson<DashboardChatProviderConnectionRecord>(`/api/chat-providers/connections/${encodeURIComponent(connectionId)}`)
);

export const createChatProviderConnection = async (
  input: CreateChatProviderConnectionInput,
): Promise<DashboardChatProviderConnectionRecord> => {
  return fetchJson<DashboardChatProviderConnectionRecord>("/api/chat-providers/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateChatProviderConnection = async (
  connectionId: string,
  input: UpdateChatProviderConnectionInput,
): Promise<DashboardChatProviderConnectionRecord> => {
  return fetchJson<DashboardChatProviderConnectionRecord>(`/api/chat-providers/connections/${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteChatProviderConnection = async (connectionId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/chat-providers/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
  });
};

export const fetchChatProviderChannelBindings = async (
  options: FetchChatProviderChannelBindingsOptions = {},
): Promise<ChatProviderChannelBindingRecord[]> => {
  const response = await fetchJson<{ bindings: ChatProviderChannelBindingRecord[] }>(
    `/api/chat-providers/channel-bindings${buildQuery({
      providerConnectionId: options.providerConnectionId,
      projectId: options.projectId,
      externalChannelId: options.externalChannelId,
      enabledOnly: options.enabledOnly,
    })}`,
  );
  return response.bindings;
};

export const createChatProviderChannelBinding = async (
  input: CreateChatProviderChannelBindingInput,
): Promise<ChatProviderChannelBindingRecord> => {
  return fetchJson<ChatProviderChannelBindingRecord>("/api/chat-providers/channel-bindings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateChatProviderChannelBinding = async (
  bindingId: string,
  input: UpdateChatProviderChannelBindingInput,
): Promise<ChatProviderChannelBindingRecord> => {
  return fetchJson<ChatProviderChannelBindingRecord>(`/api/chat-providers/channel-bindings/${encodeURIComponent(bindingId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteChatProviderChannelBinding = async (bindingId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/chat-providers/channel-bindings/${encodeURIComponent(bindingId)}`, {
    method: "DELETE",
  });
};

export const fetchChatProviderConnectionDeliveries = async (
  connectionId: string,
  limit = 25,
): Promise<ChatProviderPublicDeliveryRecord[]> => {
  const response = await fetchJson<{ deliveries: ChatProviderPublicDeliveryRecord[] }>(
    `/api/chat-providers/connections/${encodeURIComponent(connectionId)}/delivery-status${buildQuery({ limit })}`,
  );
  return response.deliveries;
};

export const fetchChatProviderBindingDeliveries = async (
  bindingId: string,
  limit = 25,
): Promise<ChatProviderPublicDeliveryRecord[]> => {
  const response = await fetchJson<{ deliveries: ChatProviderPublicDeliveryRecord[] }>(
    `/api/chat-providers/channel-bindings/${encodeURIComponent(bindingId)}/delivery-status${buildQuery({ limit })}`,
  );
  return response.deliveries;
};

export const verifyChatProviderConnection = async (
  connectionId: string,
): Promise<ChatProviderVerificationOutcome> => (
  fetchJson<ChatProviderVerificationOutcome>(`/api/chat-providers/connections/${encodeURIComponent(connectionId)}/verify`, {
    method: "POST",
  })
);

export const fetchChatProviderHealth = async (): Promise<ChatProviderConnectorHealth> => (
  fetchJson<ChatProviderConnectorHealth>("/api/chat-providers/health")
);

export const fetchChatProviderDeliveries = async (
  options: FetchChatProviderDeliveriesOptions = {},
): Promise<ChatProviderPublicDeliveryRecord[]> => {
  const response = await fetchJson<{ deliveries: ChatProviderPublicDeliveryRecord[] }>(
    `/api/chat-providers/deliveries${buildQuery({
      providerConnectionId: options.providerConnectionId,
      channelBindingId: options.channelBindingId,
      externalChannelId: options.externalChannelId,
      direction: options.direction,
      status: options.status,
      limit: options.limit,
    })}`,
  );
  return response.deliveries;
};

export const fetchChatProviderDelivery = async (
  deliveryId: string,
): Promise<ChatProviderPublicDeliveryRecord> => (
  fetchJson<ChatProviderPublicDeliveryRecord>(`/api/chat-providers/deliveries/${encodeURIComponent(deliveryId)}`)
);

export const retryChatProviderDelivery = async (
  deliveryId: string,
): Promise<ChatProviderPublicDeliveryRecord> => (
  fetchJson<ChatProviderPublicDeliveryRecord>(`/api/chat-providers/deliveries/${encodeURIComponent(deliveryId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approval: { confirmed: true } }),
  })
);

export const cancelChatProviderDelivery = async (
  deliveryId: string,
): Promise<ChatProviderPublicDeliveryRecord> => (
  fetchJson<ChatProviderPublicDeliveryRecord>(`/api/chat-providers/deliveries/${encodeURIComponent(deliveryId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approval: { confirmed: true } }),
  })
);
