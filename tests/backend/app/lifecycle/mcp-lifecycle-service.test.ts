import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootMcpTransport, type BootMcpTransportDeps } from "../../../../src/app/lifecycle/mcp-lifecycle-service.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: vi.fn(),
  };
});

describe("mcp-lifecycle-service", () => {
  let mockDeps: BootMcpTransportDeps;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDeps = {
      server: {
        connect: vi.fn(),
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      } as any,
      isJulesApiConfigured: vi.fn().mockReturnValue(true),
      getMissingJulesApiKeyInstruction: vi.fn().mockReturnValue("Missing key instructions"),
    };
  });

  describe("bootMcpTransport", () => {
    it("connects to transport and logs info when API key is configured", async () => {
      await bootMcpTransport(mockDeps);

      expect(mockDeps.isJulesApiConfigured).toHaveBeenCalled();
      expect(mockDeps.logger.warn).not.toHaveBeenCalled();

      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockDeps.server.connect).toHaveBeenCalled();

      expect(mockDeps.logger.info).toHaveBeenCalledWith(
        "Jules Subagents MCP server running on stdio",
        { version: "1.2.0" }
      );
    });

    it("logs warnings when API key is not configured", async () => {
      vi.mocked(mockDeps.isJulesApiConfigured).mockReturnValue(false);

      await bootMcpTransport(mockDeps);

      expect(mockDeps.logger.warn).toHaveBeenCalledWith(
        "Jules API key is not set. Jules-native tools are disabled; Gemini/Codex CLI providers can still run."
      );
      expect(mockDeps.logger.warn).toHaveBeenCalledWith("Missing key instructions");
      expect(mockDeps.getMissingJulesApiKeyInstruction).toHaveBeenCalled();

      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockDeps.server.connect).toHaveBeenCalled();
    });
  });
});
