import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { loadAppConfig } from "../../../src/config/app-config.js";

const originalEnv = { ...process.env };
const originalCwd = process.cwd();
let tempDir: string;

beforeEach(async () => {
  process.env = { ...originalEnv };
  delete process.env.DASHBOARD_PORT;
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

describe("loadAppConfig dashboard port", () => {
  it("uses DASHBOARD_PORT from env when valid", () => {
    process.env.DASHBOARD_PORT = "4477";
    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.dashboardPort).toBe(4477);
  });

  it("uses config.json dashboardPort when env is missing", async () => {
    await fs.writeFile(path.join(tempDir, "config.json"), JSON.stringify({ dashboardPort: 4488 }), "utf-8");

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.dashboardPort).toBe(4488);
  });

  it("falls back to default 4444 for invalid env and config values", async () => {
    process.env.DASHBOARD_PORT = "-1";
    await fs.writeFile(path.join(tempDir, "config.json"), JSON.stringify({ dashboardPort: "bad" }), "utf-8");

    const config = loadAppConfig(["node", "index.js"], tempDir);
    expect(config.dashboardPort).toBe(4444);
  });
});
