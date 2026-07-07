import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { 
  loadAppConfig, 
  apiKeyLoader, 
  dashboardPortLoader, 
  hasHeadlessArg,
  parseApiKeyArg,
  parseRuntimeRoleArg,
} from "../../../src/config/app-config.js";

const originalEnv = { ...process.env };
const originalCwd = process.cwd();
let tempDir: string;

beforeEach(async () => {
  process.env = { ...originalEnv };
  delete process.env.DASHBOARD_PORT;
  delete process.env.JULES_API_KEY;
  delete process.env.JULES_KEY;
  delete process.env.CODE_UX_SERVER_MODE;
  delete process.env.MCP_HTTP_ENABLED;
  delete process.env.MCP_HTTP_PORT;
  delete process.env.MCP_HTTP_HOST;
  delete process.env.MCP_HTTP_PATH;
  delete process.env.MCP_HTTP_AUTH_TOKEN;
  delete process.env.MCP_HTTPS_ENABLED;
  delete process.env.MCP_HTTPS_PORT;
  delete process.env.MCP_HTTPS_HOST;
  delete process.env.MCP_HTTPS_PATH;
  delete process.env.MCP_HTTPS_AUTH_TOKEN;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-app-config-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe("parseApiKeyArg", () => {
  it("parses --api-key=VALUE", () => {
    expect(parseApiKeyArg(["node", "index.js", "--api-key=test-key"])).toBe("test-key");
  });

  it("parses --api-key VALUE", () => {
    expect(parseApiKeyArg(["node", "index.js", "--api-key", "test-key"])).toBe("test-key");
  });

  it("returns null if --api-key is missing value", () => {
    expect(parseApiKeyArg(["node", "index.js", "--api-key"])).toBeNull();
  });

  it("returns null if --api-key is followed by another flag", () => {
    expect(parseApiKeyArg(["node", "index.js", "--api-key", "--other-flag"])).toBeNull();
  });
});

describe("runtime flags", () => {
  it("always resolves to the single project_manager runtime role", () => {
    expect(parseRuntimeRoleArg(["node", "index.js", "--runtime-role", "worker-host"])).toBe("project_manager");
    expect(parseRuntimeRoleArg(["node", "index.js", "--runtime-role=worker_host"])).toBe("project_manager");
    expect(parseRuntimeRoleArg(["node", "index.js", "--runtime-role", "project-manager"])).toBe("project_manager");
  });

  it("defaults runtime role to project_manager", () => {
    expect(parseRuntimeRoleArg(["node", "index.js"])).toBe("project_manager");
  });

  it("detects headless flags", () => {
    expect(hasHeadlessArg(["node", "index.js", "--headless"])).toBe(true);
    expect(hasHeadlessArg(["node", "index.js", "--no-dashboard"])).toBe(true);
    expect(hasHeadlessArg(["node", "index.js"])).toBe(false);
  });
});

describe("apiKeyLoader", () => {
  it("uses JULES_API_KEY from env", () => {
    process.env.JULES_API_KEY = "env-key";
    expect(apiKeyLoader(tempDir)).toBe("env-key");
  });

  it("uses JULES_KEY from env if JULES_API_KEY is missing", () => {
    process.env.JULES_KEY = "legacy-env-key";
    expect(apiKeyLoader(tempDir)).toBe("legacy-env-key");
  });

  it("loads from .code-ux/settings.json", async () => {
    const settingsDir = path.join(tempDir, ".code-ux");
    await fs.mkdir(settingsDir);
    await fs.writeFile(
      path.join(settingsDir, "settings.json"), 
      JSON.stringify({ julesApiKey: "file-key" })
    );
    expect(apiKeyLoader(tempDir)).toBe("file-key");
  });

  it("prioritizes env over file", async () => {
    process.env.JULES_API_KEY = "env-key";
    const settingsDir = path.join(tempDir, ".code-ux");
    await fs.mkdir(settingsDir);
    await fs.writeFile(
      path.join(settingsDir, "settings.json"), 
      JSON.stringify({ julesApiKey: "file-key" })
    );
    expect(apiKeyLoader(tempDir)).toBe("env-key");
  });
});

describe("dashboardPortLoader", () => {
  it("uses DASHBOARD_PORT from env", () => {
    process.env.DASHBOARD_PORT = "5000";
    expect(dashboardPortLoader(tempDir)).toBe(5000);
  });

  it("loads from config.json", async () => {
    await fs.writeFile(
      path.join(tempDir, "config.json"), 
      JSON.stringify({ dashboardPort: 6000 })
    );
    expect(dashboardPortLoader(tempDir)).toBe(6000);
  });

  it("supports nested dashboard.port in config.json", async () => {
    await fs.writeFile(
      path.join(tempDir, "config.json"), 
      JSON.stringify({ dashboard: { port: 7000 } })
    );
    expect(dashboardPortLoader(tempDir)).toBe(7000);
  });

  it("falls back to 4444", () => {
    expect(dashboardPortLoader(tempDir)).toBe(4444);
  });
});

describe("loadAppConfig", () => {
  it("assembles full config with CLI arg precedence", () => {
    process.env.JULES_API_KEY = "env-key";
    const config = loadAppConfig(["node", "index.js", "--api-key", "cli-key", "--no-mcp-https"], tempDir);
    expect(config.apiKey).toBe("cli-key");
    expect(config.apiKeyArg).toBe("cli-key");
    expect(config.dashboardPort).toBe(4444);
    expect(config.runtimeRole).toBe("project_manager");
    expect(config.serverMode).toBe(false);
    expect(config.dashboardEnabled).toBe(true);
    expect(config.mcpHttpEnabled).toBe(false);
    expect(config.mcpHttpPort).toBeNull();
    expect(config.mcpHttpPath).toBe("/mcp");
  });

  it("assembles full config from env when CLI arg is missing", () => {
    process.env.JULES_API_KEY = "env-key";
    process.env.DASHBOARD_PORT = "8888";
    const config = loadAppConfig(["node", "index.js", "--no-mcp-https"], tempDir);
    expect(config.apiKey).toBe("env-key");
    expect(config.dashboardPort).toBe(8888);
  });

  it("uses a loopback default MCP bind without auth on non-Docker Desktop platforms", () => {
    const needsContainerReachableDefault = process.platform === "win32"
      || process.platform === "darwin"
      || os.release().toLowerCase().includes("microsoft");

    if (needsContainerReachableDefault) {
      return;
    }

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe("127.0.0.1");
    expect(config.mcpHttpAuthToken).toBeNull();
  });

  it("requires explicit auth for a container-reachable default MCP bind on Docker Desktop platforms", () => {
    const needsContainerReachableDefault = process.platform === "win32"
      || process.platform === "darwin"
      || os.release().toLowerCase().includes("microsoft");

    if (!needsContainerReachableDefault) {
      return;
    }

    expect(() => loadAppConfig(["node", "index.js"], tempDir)).toThrow("MCP HTTPS auth token is required");
  });

  it("ignores legacy worker-host runtime flags and keeps project-manager defaults", () => {
    const config = loadAppConfig(["node", "index.js", "--runtime-role", "worker-host", "--no-mcp-https"], tempDir);
    expect(config.runtimeRole).toBe("project_manager");
    expect(config.dashboardEnabled).toBe(true);
    expect(config.mcpHttpEnabled).toBe(false);
  });

  it("supports explicit headless project-manager mode", () => {
    const config = loadAppConfig(["node", "index.js", "--headless", "--no-mcp-https"], tempDir);
    expect(config.runtimeRole).toBe("project_manager");
    expect(config.serverMode).toBe(false);
    expect(config.dashboardEnabled).toBe(false);
    expect(config.mcpHttpEnabled).toBe(false);
  });

  it.each(["--server-mode", "--server"])("enables authenticated dashboard-free server mode with %s", (flag) => {
    const config = loadAppConfig([
      "node",
      "index.js",
      flag,
      "--mcp-https-host",
      "127.0.0.1",
      "--mcp-https-auth-token",
      "present",
    ], tempDir);

    expect(config.serverMode).toBe(true);
    expect(config.dashboardEnabled).toBe(false);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe("127.0.0.1");
    expect(config.mcpHttpAuthToken).toBe("present");
  });

  it("enables server mode from CODE_UX_SERVER_MODE=true", () => {
    process.env.CODE_UX_SERVER_MODE = "true";
    process.env.MCP_HTTPS_AUTH_TOKEN = "present";

    const config = loadAppConfig(["node", "index.js"], tempDir);

    expect(config.serverMode).toBe(true);
    expect(config.dashboardEnabled).toBe(false);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpAuthToken).toBe("present");
  });

  it("requires an MCP HTTPS auth token in server mode even on loopback", () => {
    expect(() => loadAppConfig([
      "node",
      "index.js",
      "--server-mode",
      "--mcp-https-host",
      "127.0.0.1",
    ], tempDir)).toThrow("Server mode requires an MCP HTTPS auth token");
  });

  it("rejects disabled MCP HTTPS transport in server mode", () => {
    expect(() => loadAppConfig([
      "node",
      "index.js",
      "--server-mode",
      "--no-mcp-https",
      "--mcp-https-auth-token",
      "present",
    ], tempDir)).toThrow("Server mode requires the MCP HTTPS transport to be enabled");
  });

  it("enables MCP HTTP worker gateway from CLI flags", () => {
    const config = loadAppConfig([
      "node",
      "index.js",
      "--mcp-https",
      "--mcp-https-port",
      "5555",
      "--mcp-https-host",
      "127.0.0.1",
      "--mcp-https-path",
      "remote-mcp",
      "--mcp-https-auth-token",
      "present",
    ], tempDir);

    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpPort).toBe(5555);
    expect(config.mcpHttpHost).toBe("127.0.0.1");
    expect(config.mcpHttpPath).toBe("/remote-mcp");
    expect(config.mcpHttpAuthToken).toBe("present");
  });

  it("enables MCP HTTP worker gateway from env", () => {
    process.env.MCP_HTTPS_ENABLED = "true";
    process.env.MCP_HTTPS_PORT = "7777";
    process.env.MCP_HTTPS_HOST = "localhost";
    process.env.MCP_HTTPS_PATH = "/workers";
    process.env.MCP_HTTPS_AUTH_TOKEN = "present";

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpPort).toBe(7777);
    expect(config.mcpHttpHost).toBe("localhost");
    expect(config.mcpHttpPath).toBe("/workers");
    expect(config.mcpHttpAuthToken).toBe("present");
  });

  it.each(["0.0.0.0", "::", "192.168.1.10"])("requires MCP HTTP auth token for non-loopback binding %s", (host) => {
    expect(() => loadAppConfig([
      "node",
      "index.js",
      "--mcp-https",
      "--mcp-https-port",
      "5555",
      "--mcp-https-host",
      host,
    ], tempDir)).toThrow("MCP HTTPS auth token is required");
  });

  it.each(["127.0.0.1", "localhost", "::1"])("allows unauthenticated loopback MCP HTTP binding %s", (host) => {
    const config = loadAppConfig([
      "node",
      "index.js",
      "--mcp-https-port",
      "5555",
      "--mcp-https-host",
      host,
    ], tempDir);

    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe(host);
    expect(config.mcpHttpAuthToken).toBeNull();
  });

  it("allows non-loopback MCP HTTP binding with an explicit auth token", () => {
    const config = loadAppConfig([
      "node",
      "index.js",
      "--mcp-https-port",
      "5555",
      "--mcp-https-host",
      "0.0.0.0",
      "--mcp-https-auth-token",
      "present",
    ], tempDir);

    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe("0.0.0.0");
    expect(config.mcpHttpAuthToken).toBe("present");
  });
});
