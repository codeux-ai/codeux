import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalMcpCliConfigService } from "../../../src/services/local-mcp-cli-config-service.js";

let tempHome: string;
const originalTestHome = process.env.CODE_UX_TEST_HOME;

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-mcp-"));
  process.env.CODE_UX_TEST_HOME = tempHome;
});

afterEach(async () => {
  if (originalTestHome === undefined) {
    delete process.env.CODE_UX_TEST_HOME;
  } else {
    process.env.CODE_UX_TEST_HOME = originalTestHome;
  }
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe("LocalMcpCliConfigService", () => {
  const conn = {
    url: "http://127.0.0.1:4445/mcp",
    authToken: "secret-token",
  };

  it("installs Codex MCP config with bearer auth while preserving existing TOML", async () => {
    const service = new LocalMcpCliConfigService();
    const configPath = path.join(tempHome, ".codex", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "model = \"gpt-5\"\n", "utf-8");

    const result = await service.installProvider("codex", conn);
    const content = await fs.readFile(configPath, "utf-8");

    expect(result).toEqual({ provider: "codex", configPath, installed: true });
    expect(content).toContain("model = \"gpt-5\"");
    expect(content).toContain("[mcp_servers.code-ux]");
    expect(content).toContain('url = "http://127.0.0.1:4445/mcp"');
    expect(content).toContain('"Authorization" = "Bearer secret-token"');
  });

  it("installs OpenCode MCP config without dropping existing settings", async () => {
    const service = new LocalMcpCliConfigService();
    const configPath = path.join(tempHome, ".config", "opencode", "opencode.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ model: "anthropic/claude", mcp: { docs: { type: "remote", url: "https://docs.test/mcp" } } }), "utf-8");

    await service.installProvider("opencode", conn);
    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
      model?: string;
      mcp?: Record<string, unknown>;
    };

    expect(parsed.model).toBe("anthropic/claude");
    expect(parsed.mcp?.docs).toEqual({ type: "remote", url: "https://docs.test/mcp" });
    expect(parsed.mcp?.code_ux).toEqual({
      type: "remote",
      url: "http://127.0.0.1:4445/mcp",
      enabled: true,
      headers: { Authorization: "Bearer secret-token" },
    });
  });
});
