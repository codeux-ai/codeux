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
let tempHome: string;

beforeEach(async () => {
  process.env = { ...originalEnv };
  delete process.env.DASHBOARD_PORT;
  delete process.env.JULES_API_KEY;
  delete process.env.JULES_KEY;
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
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-home-"));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.CODE_UX_HOME = path.join(tempHome, ".code-ux");
  process.chdir(tempDir);
});

afterEach(async () => {
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  if (tempHome) {
    await fs.rm(tempHome, { recursive: true, force: true });
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

  it("auto-generates and persists a user MCP HTTP auth token", async () => {
    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpAuthToken).toMatch(/^cux_mcp_[A-Za-z0-9_-]{43}$/);

    const securityPath = path.join(tempHome, ".code-ux", "security.json");
    const persisted = JSON.parse(await fs.readFile(securityPath, "utf-8")) as { mcpHttpAuthToken?: string };
    expect(persisted.mcpHttpAuthToken).toBe(config.mcpHttpAuthToken);

    if (process.platform !== "win32") {
      const mode = (await fs.stat(securityPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("reuses the persisted user MCP HTTP auth token on later startups", async () => {
    const securityDir = path.join(tempHome, ".code-ux");
    await fs.mkdir(securityDir, { recursive: true });
    await fs.writeFile(path.join(securityDir, "security.json"), JSON.stringify({ mcpHttpAuthToken: "stored-token" }));

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpAuthToken).toBe("stored-token");
  });

  it("does not create a user MCP HTTP auth token when the HTTP gateway is disabled", async () => {
    const config = loadAppConfig(["node", "index.js", "--no-mcp-https"], tempDir);
    expect(config.mcpHttpEnabled).toBe(false);
    expect(config.mcpHttpAuthToken).toBeNull();
    await expect(fs.stat(path.join(tempHome, ".code-ux", "security.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses a loopback default MCP bind on non-Docker Desktop platforms", () => {
    const needsContainerReachableDefault = process.platform === "win32"
      || process.platform === "darwin"
      || os.release().toLowerCase().includes("microsoft");

    if (needsContainerReachableDefault) {
      return;
    }

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe("127.0.0.1");
    expect(config.mcpHttpAuthToken).toMatch(/^cux_mcp_/);
  });

  it("auto-generates auth for a container-reachable default MCP bind on Docker Desktop platforms", () => {
    const needsContainerReachableDefault = process.platform === "win32"
      || process.platform === "darwin"
      || os.release().toLowerCase().includes("microsoft");

    if (!needsContainerReachableDefault) {
      return;
    }

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe("0.0.0.0");
    expect(config.mcpHttpAuthToken).toMatch(/^cux_mcp_/);
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
    expect(config.dashboardEnabled).toBe(false);
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
      "secret-token",
    ], tempDir);

    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpPort).toBe(5555);
    expect(config.mcpHttpHost).toBe("127.0.0.1");
    expect(config.mcpHttpPath).toBe("/remote-mcp");
    expect(config.mcpHttpAuthToken).toBe("secret-token");
  });

  it("enables MCP HTTP worker gateway from env", () => {
    process.env.MCP_HTTPS_ENABLED = "true";
    process.env.MCP_HTTPS_PORT = "7777";
    process.env.MCP_HTTPS_HOST = "localhost";
    process.env.MCP_HTTPS_PATH = "/workers";
    process.env.MCP_HTTPS_AUTH_TOKEN = "env-token";

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpPort).toBe(7777);
    expect(config.mcpHttpHost).toBe("localhost");
    expect(config.mcpHttpPath).toBe("/workers");
    expect(config.mcpHttpAuthToken).toBe("env-token");
  });

  it.each(["0.0.0.0", "::", "192.168.1.10"])("auto-generates MCP HTTP auth token for non-loopback binding %s", (host) => {
    const config = loadAppConfig([
      "node",
      "index.js",
      "--mcp-https",
      "--mcp-https-port",
      "5555",
      "--mcp-https-host",
      host,
    ], tempDir);

    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe(host);
    expect(config.mcpHttpAuthToken).toMatch(/^cux_mcp_/);
  });

  it.each(["127.0.0.1", "localhost", "::1"])("uses generated auth for loopback MCP HTTP binding %s", (host) => {
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
    expect(config.mcpHttpAuthToken).toMatch(/^cux_mcp_/);
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
      "secret-token",
    ], tempDir);

    expect(config.mcpHttpEnabled).toBe(true);
    expect(config.mcpHttpHost).toBe("0.0.0.0");
    expect(config.mcpHttpAuthToken).toBe("secret-token");
  });
});
