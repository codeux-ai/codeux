import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemClusterConnectionSettings, SystemSettings } from "../../../src/contracts/settings-scope-types.js";
import { buildDefaultSystemSettings } from "../../../src/services/settings-resolution-service.js";
import { ClusterServerClient } from "../../../src/services/cluster-server-client.js";
import { ClusterSettingsSyncService } from "../../../src/services/cluster-settings-sync-service.js";
import type { SettingsRepository } from "../../../src/repositories/settings-repository.js";

const sdkMocks = vi.hoisted(() => {
  const connect = vi.fn();
  const request = vi.fn();
  const close = vi.fn();
  const clientConstructor = vi.fn(function Client() {
    return { connect, request };
  });
  const transportConstructor = vi.fn(function StreamableHTTPClientTransport() {
    return { close };
  });
  return { connect, request, close, clientConstructor, transportConstructor };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdkMocks.clientConstructor,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: sdkMocks.transportConstructor,
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolResultSchema: {},
  ListToolsResultSchema: {},
}));

const createConnection = (
  overrides: Partial<SystemClusterConnectionSettings> = {},
): SystemClusterConnectionSettings => ({
  id: "primary",
  displayName: "Primary remote",
  url: "https://remote.example.com/mcp",
  enabled: true,
  bearerTokenRef: "cluster-token",
  syncPolicy: {
    systemSettings: false,
    providerSettings: false,
    localAuthArtifacts: false,
  },
  ...overrides,
  syncPolicy: {
    systemSettings: false,
    providerSettings: false,
    localAuthArtifacts: false,
    ...overrides.syncPolicy,
  },
});

const createSystemSettings = (connection: SystemClusterConnectionSettings): SystemSettings => {
  const settings = buildDefaultSystemSettings();
  settings.runtime.dashboardPort = 5555;
  settings.integrations.githubToken = "github-secret-token";
  settings.integrations.jira.apiToken = "jira-secret-token";
  settings.integrations.providers.gemini = {
    ...settings.integrations.providers.gemini,
    apiKey: "provider-secret-token",
    mountAuth: true,
    authPath: "/home/user/.gemini",
    authType: "localAuth",
  };
  settings.cluster.connections = [connection];
  return settings;
};

const createSettingsRepository = (settings: SystemSettings): SettingsRepository => ({
  getSystemSettings: vi.fn(() => settings),
} as unknown as SettingsRepository);

const createLogger = () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
};

const createMockClient = () => ({
  listTools: vi.fn(async () => ({ tools: [{ name: "manage_settings" }] })),
  callManageSettings: vi.fn(async () => ({
    envelope: { result: { settings: {} } },
    raw: { content: [{ type: "text", text: "{\"result\":{}}" }] },
  })),
  close: vi.fn(async () => undefined),
});

describe("ClusterServerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.close.mockResolvedValue(undefined);
  });

  it("connects to Streamable HTTP with a bearer authorization header and lists tools", async () => {
    sdkMocks.request.mockResolvedValueOnce({ tools: [{ name: "manage_settings" }] });

    const client = new ClusterServerClient({
      remoteUrl: "https://remote.example.com/mcp",
      bearerToken: "remote-bearer-token",
    });

    const result = await client.listTools();
    await client.close();

    expect(result.tools[0]?.name).toBe("manage_settings");
    expect(sdkMocks.transportConstructor).toHaveBeenCalledWith(
      new URL("https://remote.example.com/mcp"),
      {
        requestInit: {
          headers: {
            Authorization: "Bearer remote-bearer-token",
          },
        },
      },
    );
    expect(sdkMocks.connect).toHaveBeenCalledTimes(1);
    expect(sdkMocks.request).toHaveBeenCalledWith({ method: "tools/list", params: {} }, {});
    expect(sdkMocks.close).toHaveBeenCalledTimes(1);
  });
});

describe("ClusterSettingsSyncService", () => {
  it("rejects sync when no bearer token is available", async () => {
    const settings = createSystemSettings(createConnection({
      syncPolicy: { systemSettings: true, providerSettings: false, localAuthArtifacts: false },
    }));
    const createClient = vi.fn(createMockClient);
    const service = new ClusterSettingsSyncService({
      settingsRepository: createSettingsRepository(settings),
      createClient,
    });

    const result = await service.syncSettings({ connectionId: "primary" });

    expect(result.error?.message).toContain("Missing bearer token");
    expect(result.applied).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns approval-required state for an initial unconfirmed settings sync", async () => {
    const settings = createSystemSettings(createConnection({
      syncPolicy: { systemSettings: true, providerSettings: false, localAuthArtifacts: false },
    }));
    const mockClient = createMockClient();
    mockClient.callManageSettings.mockResolvedValue({
      envelope: {
        approvalRequired: true,
        approvalMessage: "Ask the user to confirm this exact settings change.",
      },
      raw: { content: [{ type: "text", text: "{\"approvalRequired\":true}" }] },
    });
    const service = new ClusterSettingsSyncService({
      settingsRepository: createSettingsRepository(settings),
      createClient: vi.fn(() => mockClient),
    });

    const result = await service.syncSettings({ connectionId: "primary", bearerToken: "remote-bearer-token" });

    expect(result.approvalRequired).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.changedSettingsScope).toEqual(["runtime", "defaults", "mcpTools", "customMcpServers", "modelPricing"]);
    expect(mockClient.callManageSettings).toHaveBeenCalled();
    expect(mockClient.callManageSettings.mock.calls[0]?.[0]).toMatchObject({
      action: "patch_system_setting",
      path: "runtime",
      approval: { confirmed: false },
    });
    expect(mockClient.close).toHaveBeenCalledTimes(1);
  });

  it("sends confirmed approval calls for provider sync and strips local auth paths when artifact sync is disabled", async () => {
    const settings = createSystemSettings(createConnection({
      syncPolicy: { systemSettings: false, providerSettings: true, localAuthArtifacts: false },
    }));
    const mockClient = createMockClient();
    const service = new ClusterSettingsSyncService({
      settingsRepository: createSettingsRepository(settings),
      createClient: vi.fn(() => mockClient),
    });

    const result = await service.syncSettings({
      connectionId: "primary",
      bearerToken: "remote-bearer-token",
      approval: { confirmed: true },
    });

    expect(result.error).toBeUndefined();
    expect(result.applied).toBe(true);
    expect(result.approvalRequired).toBe(false);
    expect(result.changedSettingsScope).toEqual(["providerSettings"]);

    const call = mockClient.callManageSettings.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      action: "patch_system_setting",
      path: "integrations.providers",
      approval: { confirmed: true },
    });
    const providers = call?.value as SystemSettings["integrations"]["providers"];
    expect(providers.gemini.apiKey).toBe("provider-secret-token");
    expect(providers.gemini.mountAuth).toBe(false);
    expect(providers.gemini.authPath).toBe("");
    expect(providers.gemini.authType).toBe("apiKey");
  });

  it("skips remote calls when all sync flags are disabled", async () => {
    const settings = createSystemSettings(createConnection());
    const createClient = vi.fn(createMockClient);
    const service = new ClusterSettingsSyncService({
      settingsRepository: createSettingsRepository(settings),
      createClient,
    });

    const result = await service.syncSettings({ connectionId: "primary", bearerToken: "remote-bearer-token" });

    expect(result).toMatchObject({
      remoteUrl: "https://remote.example.com/mcp",
      connectionId: "primary",
      changedSettingsScope: [],
      approvalRequired: false,
      applied: false,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns sanitized remote tool errors without leaking bearer or provider secrets", async () => {
    const bearerToken = "remote-bearer-token";
    const settings = createSystemSettings(createConnection({
      syncPolicy: { systemSettings: false, providerSettings: true, localAuthArtifacts: false },
    }));
    const mockClient = createMockClient();
    mockClient.callManageSettings.mockRejectedValue(new Error(
      `Authorization: Bearer ${bearerToken}; provider apiKey provider-secret-token failed`,
    ));
    const logger = createLogger();
    const service = new ClusterSettingsSyncService({
      settingsRepository: createSettingsRepository(settings),
      createClient: vi.fn(() => mockClient),
      logger,
    });

    const result = await service.syncSettings({ connectionId: "primary", bearerToken });

    expect(result.applied).toBe(false);
    expect(result.error?.message).toContain("Authorization: Bearer [REDACTED]");
    expect(result.error?.message).not.toContain(bearerToken);
    expect(result.error?.message).not.toContain("provider-secret-token");
    expect(logger.warn.mock.calls[0]?.[1]?.error.message).not.toContain(bearerToken);
    expect(logger.warn.mock.calls[0]?.[1]?.error.message).not.toContain("provider-secret-token");
    expect(mockClient.close).toHaveBeenCalledTimes(1);
  });

  it("reports remote tool errors returned through the MCP call envelope", async () => {
    const settings = createSystemSettings(createConnection({
      syncPolicy: { systemSettings: true, providerSettings: false, localAuthArtifacts: false },
    }));
    const mockClient = createMockClient();
    mockClient.listTools.mockResolvedValue({ tools: [{ name: "something_else" }] });
    const service = new ClusterSettingsSyncService({
      settingsRepository: createSettingsRepository(settings),
      createClient: vi.fn(() => mockClient),
    });

    const result = await service.syncSettings({ connectionId: "primary", bearerToken: "remote-bearer-token" });

    expect(result.applied).toBe(false);
    expect(result.error?.message).toContain("does not expose manage_settings");
    expect(mockClient.callManageSettings).not.toHaveBeenCalled();
    expect(mockClient.close).toHaveBeenCalledTimes(1);
  });
});
