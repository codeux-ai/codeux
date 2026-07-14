import { describe, expect, it } from "vitest";
import type { DashboardChatProviderConnectionRecord, DashboardChatProviderSetupDefinition } from "../../../../lib/chat-provider-api.js";
import {
  buildSecretUpdate,
  createConnectionDraft,
  getExternalChannelLabel,
  hasMaterialConnectionEdits,
  requiresConnectionChangeConfirmation,
  validateConnectionDraft,
} from "../chat-connector-models.js";

const definition: DashboardChatProviderSetupDefinition = {
  kind: "slack",
  label: "Slack",
  defaultBridgeMode: "official_api",
  ingressUrlTemplate: "/api/chat-providers/ingress/{connectionId}",
  bridgeModes: [{
    mode: "official_api",
    label: "Slack Events and Web APIs",
    integration: "official_api",
    setupFields: [{ key: "workspaceId", label: "Workspace ID", type: "string", required: true }],
    secretFields: [
      { key: "signingSecret", label: "Signing secret", required: true },
      { key: "botToken", label: "Bot token", required: true },
    ],
    setupHints: { bridgeModeLabel: "Slack Events and Web APIs", integration: "official_api", requiredSetupFields: ["workspaceId"], requiredSecretFields: ["signingSecret", "botToken"] },
  }],
  officialDocumentation: [{ label: "Slack API", url: "https://api.slack.com/" }],
  limitations: [],
};

const connection: DashboardChatProviderConnectionRecord = {
  id: "connection-1", providerKind: "slack", displayName: "Slack", bridgeMode: "official_api", status: "active", enabled: true,
  setup: { workspaceId: "T123" },
  credentials: [
    { key: "signingSecret", label: "Signing secret", configured: true, redactedValue: "••••" },
    { key: "botToken", label: "Bot token", configured: true, redactedValue: "••••" },
  ],
  verificationStatus: "verified", verificationDetails: null, verifiedAt: "2026-01-01T00:00:00.000Z", secretVersion: 2,
  ingressUrl: "/api/chat-providers/ingress/connection-1",
  setupHints: { bridgeModeLabel: "Slack Events and Web APIs", integration: "official_api", requiredSetupFields: ["workspaceId"], requiredSecretFields: ["signingSecret", "botToken"] },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("chat connector editor models", () => {
  it("preserves blank write-only secrets and validates stored required credentials", () => {
    const draft = createConnectionDraft(connection, definition);
    expect(buildSecretUpdate(draft, definition)).toBeUndefined();
    expect(validateConnectionDraft(connection, definition, draft)).toEqual([]);
  });

  it("marks material edits stale and confirms secret replacement", () => {
    const draft = createConnectionDraft(connection, definition);
    draft.secrets.botToken = "replacement-token";
    expect(hasMaterialConnectionEdits(connection, draft)).toBe(true);
    expect(requiresConnectionChangeConfirmation(connection, definition, draft)).toEqual({ required: true, reasons: ["stored credentials"] });
    expect(buildSecretUpdate(draft, definition)).toEqual({ botToken: "replacement-token" });
  });

  it("uses provider-specific channel identifiers", () => {
    expect(getExternalChannelLabel("discord")).toBe("Discord channel ID");
    expect(getExternalChannelLabel("microsoft-teams")).toBe("Teams conversation ID");
  });
});
