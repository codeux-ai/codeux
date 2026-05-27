import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootMcpTransport, type BootMcpTransportDeps } from "../../../../src/app/lifecycle/mcp-lifecycle-service.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CODE_UX_VERSION } from "../../../../src/shared/config/code-ux-paths.js";

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
    };
  });

  describe("bootMcpTransport", () => {
    it("connects to transport and logs info", async () => {
      await bootMcpTransport(mockDeps);

      expect(mockDeps.logger.warn).not.toHaveBeenCalled();

      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockDeps.server.connect).toHaveBeenCalled();

      expect(mockDeps.logger.info).toHaveBeenCalledWith(
        "Code UX MCP server running on stdio",
        { version: CODE_UX_VERSION }
      );
    });

    it("does not warn when the Jules API key is not configured at startup", async () => {
      await bootMcpTransport(mockDeps);

      expect(mockDeps.logger.warn).not.toHaveBeenCalled();

      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockDeps.server.connect).toHaveBeenCalled();
    });
  });
});
