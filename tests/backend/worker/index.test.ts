import { describe, expect, it, vi } from "vitest";
import { main } from "../../../src/worker/index.js";
import { SprintOsWorker } from "../../../src/worker/sprint-os-worker.js";
import { loadWorkerConfig } from "../../../src/worker/worker-config.js";

vi.mock("../../../src/worker/sprint-os-worker.js", () => {
  const MockSprintOsWorker = vi.fn();
  MockSprintOsWorker.prototype.run = vi.fn().mockResolvedValue(undefined);
  return { SprintOsWorker: MockSprintOsWorker };
});

vi.mock("../../../src/worker/worker-config.js");

describe("Worker CLI Index", () => {
  it("prints help message and returns when --help is passed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["node", "script", "--help"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Sprint OS Worker"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: sprint-os-worker [options]"));

    expect(loadWorkerConfig).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it("loads config, initializes worker, and runs it", async () => {
    const mockConfig = { connectionKey: "test-key" };
    vi.mocked(loadWorkerConfig).mockReturnValue(mockConfig as any);

    // Provide generic non-help args
    await main(["node", "script", "--connection-key", "test-key"]);

    expect(loadWorkerConfig).toHaveBeenCalledWith(["node", "script", "--connection-key", "test-key"]);
    expect(SprintOsWorker).toHaveBeenCalledWith(mockConfig);
  });
});
