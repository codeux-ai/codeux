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
  it("parses worker-host runtime role", () => {
    expect(parseRuntimeRoleArg(["node", "index.js", "--runtime-role", "worker-host"])).toBe("worker_host");
    expect(parseRuntimeRoleArg(["node", "index.js", "--runtime-role=worker_host"])).toBe("worker_host");
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

  it("loads from .sprint-os/settings.json", async () => {
    const settingsDir = path.join(tempDir, ".sprint-os");
    await fs.mkdir(settingsDir);
    await fs.writeFile(
      path.join(settingsDir, "settings.json"), 
      JSON.stringify({ julesApiKey: "file-key" })
    );
    expect(apiKeyLoader(tempDir)).toBe("file-key");
  });

  it("prioritizes env over file", async () => {
    process.env.JULES_API_KEY = "env-key";
    const settingsDir = path.join(tempDir, ".sprint-os");
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
    const config = loadAppConfig(["node", "index.js", "--api-key", "cli-key"], tempDir);
    expect(config.apiKey).toBe("cli-key");
    expect(config.apiKeyArg).toBe("cli-key");
    expect(config.dashboardPort).toBe(4444);
    expect(config.runtimeRole).toBe("project_manager");
    expect(config.dashboardEnabled).toBe(true);
  });

  it("assembles full config from env when CLI arg is missing", () => {
    process.env.JULES_API_KEY = "env-key";
    process.env.DASHBOARD_PORT = "8888";
    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.apiKey).toBe("env-key");
    expect(config.dashboardPort).toBe(8888);
  });

  it("disables dashboard and local project-manager registration in worker-host mode", () => {
    const config = loadAppConfig(["node", "index.js", "--runtime-role", "worker-host"], tempDir);
    expect(config.runtimeRole).toBe("worker_host");
    expect(config.dashboardEnabled).toBe(false);
  });

  it("supports explicit headless project-manager mode", () => {
    const config = loadAppConfig(["node", "index.js", "--headless"], tempDir);
    expect(config.runtimeRole).toBe("project_manager");
    expect(config.dashboardEnabled).toBe(false);
  });
});
