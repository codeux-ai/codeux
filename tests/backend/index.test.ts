import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { main } from "../../src/index.js";
import { JulesAgentServer } from "../../src/server/jules-agent-server.js";
import { loadAppConfig } from "../../src/config/app-config.js";

vi.mock("../../src/server/jules-agent-server.js", () => {
  return {
    JulesAgentServer: vi.fn().mockImplementation(function() {
      return {
        run: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

vi.mock("../../src/config/app-config.js", () => {
  return {
    loadAppConfig: vi.fn().mockReturnValue({ mockConfig: true }),
  };
});

describe("index.ts main function", () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should output help and exit with 0 when --help is provided", async () => {
    await expect(main(["node", "script", "--help"])).rejects.toThrow("process.exit called");

    expect(consoleLogSpy).toHaveBeenCalledWith("Code UX MCP Server");
    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(JulesAgentServer).not.toHaveBeenCalled();
  });

  it("should output help and exit with 0 when -h is provided", async () => {
    await expect(main(["node", "script", "-h"])).rejects.toThrow("process.exit called");

    expect(consoleLogSpy).toHaveBeenCalledWith("Code UX MCP Server");
    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(JulesAgentServer).not.toHaveBeenCalled();
  });

  it("should instantiate the server and call run() for normal execution", async () => {
    await main(["node", "script"]);

    expect(loadAppConfig).toHaveBeenCalled();
    expect(JulesAgentServer).toHaveBeenCalled();
    const mockServerInstance = vi.mocked(JulesAgentServer).mock.results[0].value;
    expect(mockServerInstance.run).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("should catch errors thrown by server.run() and exit with 1", async () => {
    const error = new Error("Server crash");
    vi.mocked(JulesAgentServer).mockImplementationOnce(function() {
      return {
        run: vi.fn().mockRejectedValueOnce(error),
      } as any;
    });

    await expect(main(["node", "script"])).rejects.toThrow("process.exit called");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Fatal error starting server:", error);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
