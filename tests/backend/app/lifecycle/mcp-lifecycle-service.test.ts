import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootMcpTransport, resolveMcpStdioMode, type BootMcpTransportDeps } from "../../../../src/app/lifecycle/mcp-lifecycle-service.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CODE_UX_VERSION } from "../../../../src/shared/config/code-ux-paths.js";

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: vi.fn(),
  };
});

describe("mcp-lifecycle-service", () => {
  let mockDeps: BootMcpTransportDeps;
  const originalEnableMcpStdio = process.env.CODE_UX_ENABLE_MCP_STDIO;
  const originalDisableMcpStdio = process.env.CODE_UX_DISABLE_MCP_STDIO;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODE_UX_ENABLE_MCP_STDIO = "1";
    delete process.env.CODE_UX_DISABLE_MCP_STDIO;

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

  afterEach(() => {
    if (originalEnableMcpStdio === undefined) {
      delete process.env.CODE_UX_ENABLE_MCP_STDIO;
    } else {
      process.env.CODE_UX_ENABLE_MCP_STDIO = originalEnableMcpStdio;
    }
    if (originalDisableMcpStdio === undefined) {
      delete process.env.CODE_UX_DISABLE_MCP_STDIO;
    } else {
      process.env.CODE_UX_DISABLE_MCP_STDIO = originalDisableMcpStdio;
    }
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

  describe("resolveMcpStdioMode", () => {
    it("keeps daemon stdin disabled when stdin is a character device such as /dev/null", () => {
      const mode = resolveMcpStdioMode(
        { fd: 0, isTTY: false },
        {},
        () => ({
          isFIFO: () => false,
          isSocket: () => false,
        } as any),
      );

      expect(mode).toEqual({ enabled: null, reason: "stdin is not an MCP pipe" });
    });

    it("enables stdio for pipe-backed MCP launches", () => {
      const mode = resolveMcpStdioMode(
        { fd: 0, isTTY: false },
        {},
        () => ({
          isFIFO: () => true,
          isSocket: () => false,
        } as any),
      );

      expect(mode).toEqual({ enabled: true, reason: "stdin is a pipe/socket" });
    });

    it("supports explicit enable and disable environment overrides", () => {
      expect(resolveMcpStdioMode({ isTTY: true }, { CODE_UX_ENABLE_MCP_STDIO: "1" }, () => {
        throw new Error("not reached");
      })).toEqual({ enabled: true, reason: "enabled_by_environment" });

      expect(resolveMcpStdioMode({ isTTY: false }, { CODE_UX_DISABLE_MCP_STDIO: "1", CODE_UX_ENABLE_MCP_STDIO: "1" }, () => {
        throw new Error("not reached");
      })).toEqual({ enabled: false, reason: "disabled_by_environment" });
    });
  });
});
