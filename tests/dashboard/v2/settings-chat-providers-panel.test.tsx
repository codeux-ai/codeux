/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsIntegrationsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsIntegrationsPanel.js";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderMessageDeliveryRecord,
  ChatProviderKind,
} from "../../../dashboard/src/v2/types.js";
import type {
  DashboardChatProviderConnectionRecord,
  DashboardChatProviderSetupDefinition,
} from "../../../dashboard/src/v2/lib/chat-provider-api.js";

vi.mock("gsap", () => {
  const applyStyles = (target: unknown, props: Record<string, unknown>) => {
    if (!(target instanceof HTMLElement)) return;
    for (const [key, value] of Object.entries(props)) {
      (target.style as CSSStyleDeclaration & Record<string, string>)[key] = String(value);
    }
  };

  return {
    default: {
      context: vi.fn((callback: () => void) => {
        callback();
        return { revert: vi.fn() };
      }),
      set: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      to: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      fromTo: vi.fn((target: unknown, _from: Record<string, unknown>, to: Record<string, unknown>) => applyStyles(target, to)),
      timeline: vi.fn(() => {
        const timeline = {
          to: (target: unknown, props: Record<string, unknown>) => {
            applyStyles(target, props);
            if (typeof props.onComplete === "function") props.onComplete();
            return timeline;
          },
        };
        return timeline;
      }),
    },
  };
});

const providerDefinitions: DashboardChatProviderSetupDefinition[] = [
  "whatsapp",
  "imessage",
  "telegram",
  "slack",
  "microsoft-teams",
  "discord",
].map((kind) => ({
  kind: kind as ChatProviderKind,
  label: kind === "microsoft-teams" ? "Microsoft Teams" : kind === "imessage" ? "iMessage" : kind.charAt(0).toUpperCase() + kind.slice(1),
  defaultBridgeMode: kind === "discord" ? "webhook" : "managed_bridge",
  ingressUrlTemplate: "http://localhost/api/chat-providers/ingress/{connectionId}",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Managed bridge",
      integration: "managed_core",
      setupFields: [
        { key: "workspaceId", label: "Connector workspace", type: "string", required: false },
      ],
      secretFields: [
        { key: "bridgeApiKey", label: "Bridge API key", required: true },
      ],
    },
    {
      mode: "webhook",
      label: "Webhook bridge",
      integration: "webhook",
      setupFields: [
        { key: "eventsUrl", label: "Events webhook URL", type: "url", required: true },
      ],
      secretFields: [
        { key: "signingSecret", label: "Signing secret", required: true },
      ],
    },
  ],
}));

const slackConnection: DashboardChatProviderConnectionRecord = {
  id: "conn-slack",
  providerKind: "slack",
  displayName: "Slack Bridge",
  bridgeMode: "managed_bridge",
  status: "active",
  enabled: true,
  setup: { workspaceId: "workspace-1" },
  credentials: [
    { key: "bridgeApiKey", label: "Bridge API key", configured: true, redactedValue: "••••••••" },
  ],
  ingressUrl: "http://localhost/api/chat-providers/ingress/conn-slack",
  setupHints: {
    bridgeModeLabel: "Managed bridge",
    integration: "managed_core",
    requiredSetupFields: [],
    requiredSecretFields: ["bridgeApiKey"],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const slackBinding: ChatProviderChannelBindingRecord = {
  id: "binding-slack",
  providerConnectionId: "conn-slack",
  providerKind: "slack",
  externalChannelId: "C123",
  externalChannelName: "engineering",
  externalChannelMetadata: null,
  projectId: "project-1",
  agentPresetId: "pm-agent",
  routingHints: { projectSelectorPrefix: "/project", projectSelector: "engineering" },
  enabled: true,
  inboundEnabled: true,
  outboundEnabled: true,
  suppressRichWidgets: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const failedDelivery: ChatProviderMessageDeliveryRecord = {
  id: "delivery-failed",
  providerConnectionId: "conn-slack",
  providerKind: "slack",
  channelBindingId: "binding-slack",
  externalChannelId: "C123",
  externalMessageId: null,
  direction: "outbound",
  status: "failed",
  attemptCount: 2,
  lastError: "Bearer xoxb-12345678901234567890123456789012 failed",
  conversationThreadId: null,
  conversationMessageId: "message-1",
  payload: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createState = (selectedIntegration: string | null) => ({
  activeScope: "system",
  selectedProject: { id: "project-1", name: "Project One" },
  projects: [
    { id: "project-1", name: "Project One" },
    { id: "project-2", name: "Project Two" },
  ],
  projectAgentPresetOptions: [
    { value: "pm-agent", label: "Project Manager" },
  ],
  editableSettings: {
    cliWorkflow: {
      executionMode: "DOCKER",
      containerMountGithubAuth: false,
      containerGithubAuthPath: "~/.config/gh",
      containerMountGitConfig: true,
    },
    git: {
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintBranchScheme: "feature/sprint{sprint}",
      autoCreatePr: true,
    },
  },
  systemSettings: {
    integrations: {
      providers: {},
      githubToken: "",
      gitlabToken: "",
    },
  },
  projectSources: {},
  selectedIntegration,
  setSelectedIntegration: vi.fn(),
  integrations: [
    { id: "whatsapp", label: "WhatsApp", description: "WhatsApp bridge" },
    { id: "imessage", label: "iMessage", description: "iMessage bridge" },
    { id: "telegram", label: "Telegram", description: "Telegram bridge" },
    { id: "slack", label: "Slack", description: "Slack bridge" },
    { id: "microsoft-teams", label: "Microsoft Teams", description: "Teams bridge" },
    { id: "discord", label: "Discord", description: "Discord bridge" },
  ],
  importingHints: false,
  externalHints: { resolved: {} },
  handleImportHints: vi.fn(),
  updateEditableSettings: vi.fn(),
  updateSystem: vi.fn(),
  updateProject: vi.fn(),
  chatProviders: {
    definitions: providerDefinitions,
    connections: [slackConnection],
    bindings: [slackBinding],
    deliveriesByConnection: { "conn-slack": [failedDelivery] },
    loading: false,
    savingId: null,
    error: null,
    load: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    createBinding: vi.fn(),
    updateBinding: vi.fn(),
    deleteBinding: vi.fn(),
  },
});

describe("SettingsIntegrationsPanel chat connectors", () => {
  afterEach(() => {
    cleanup();
  });

  it("surfaces all chat connectors in the Chat Connectors integration group", async () => {
    const state = createState(null);
    render(<SettingsIntegrationsPanel state={state as any} />);

    await waitFor(() => expect(screen.getByText("CHAT CONNECTORS")).not.toBeNull());
    for (const label of ["WhatsApp", "iMessage", "Telegram", "Slack", "Microsoft Teams", "Discord"]) {
      expect(screen.getByText(label)).not.toBeNull();
    }
    expect(screen.getByText("1 connections")).not.toBeNull();
    expect(screen.getByText("1 channels")).not.toBeNull();
    expect(screen.getByText("Replies on")).not.toBeNull();
  });

  it("renders secure setup, binding, ambiguity, and delivery controls for a provider", async () => {
    const state = createState("slack");
    render(<SettingsIntegrationsPanel state={state as any} />);

    await waitFor(() => expect(screen.getByText("Slack Connector")).not.toBeNull());
    expect(screen.getByText("Slack setup guidance")).not.toBeNull();
    expect((screen.getByLabelText("Slack Bridge display name") as HTMLInputElement).value).toBe("Slack Bridge");
    expect(screen.getByRole("radiogroup", { name: "Slack Bridge bridge mode" })).not.toBeNull();
    expect((screen.getByLabelText("Slack Bridge ingress URL") as HTMLInputElement).value).toBe("http://localhost/api/chat-providers/ingress/conn-slack");
    expect((screen.getByLabelText("Slack Bridge Bridge API key") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/configured\. Enter a replacement only when rotating it\./i)).not.toBeNull();

    expect(screen.getByText("Shared-channel routing")).not.toBeNull();
    expect((screen.getByLabelText("C123 project selector prefix") as HTMLInputElement).value).toBe("/project");
    expect((screen.getByLabelText("C123 routing hint") as HTMLInputElement).value).toBe("engineering");
    expect(screen.getByLabelText("C123 Suppress rich widgets").getAttribute("aria-checked")).toBe("true");

    expect(screen.getByText("Retryable")).not.toBeNull();
    expect(screen.getByText(/Bearer \[redacted\] failed/)).not.toBeNull();
    expect(screen.queryByText(/xoxb-12345678901234567890123456789012/)).toBeNull();

    const binding = screen.getByText("C123").closest("div")!.parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(binding).getByRole("button", { name: "Save" }));
    expect(state.chatProviders.updateBinding).toHaveBeenCalledWith("binding-slack", expect.objectContaining({
      projectId: "project-1",
      routingHints: { projectSelectorPrefix: "/project", projectSelector: "engineering" },
      suppressRichWidgets: true,
    }));
  });
});
