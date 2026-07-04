import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveDispatchRegistry } from "../../../src/services/active-dispatch-registry.js";
import { ShutdownContainerService } from "../../../src/services/shutdown-container-service.js";

const dockerPsLine = (input: { id: string; names: string; labels: string }) => JSON.stringify({
  ID: input.id,
  Names: input.names,
  Labels: input.labels,
});

describe("ShutdownContainerService", () => {
  let commandRunner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    commandRunner = vi.fn();
  });

  it("requests active dispatch stops and kills running Code UX containers", async () => {
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    const requestStop = vi.fn().mockResolvedValue({ accepted: true });
    activeDispatchRegistry.register({
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      sessionId: "session-1",
      executorType: "docker_cli",
      requestStop,
    });
    commandRunner.mockImplementation(async (_command, args) => {
      if (args[0] === "ps") {
        return {
          stdout: [
            dockerPsLine({ id: "container-1", names: "code-ux-codex-session-1", labels: "code-ux.session-id=session-1" }),
            dockerPsLine({ id: "container-2", names: "unrelated", labels: "com.example.owner=test" }),
            dockerPsLine({ id: "container-3", names: "code-ux-login", labels: "code-ux.login=true" }),
            dockerPsLine({ id: "container-4", names: "code-ux-vol-helper-workspace", labels: "code-ux.helper=volume" }),
            dockerPsLine({ id: "container-5", names: "code-ux-git-helper-project", labels: "" }),
          ].join("\n"),
        };
      }
      return { stdout: "" };
    });

    const service = new ShutdownContainerService({ activeDispatchRegistry, commandRunner });
    const result = await service.stopRunningContainers("test shutdown");

    expect(result).toEqual({
      requestedDispatchStops: 1,
      killedContainerIds: ["container-1", "container-3", "container-4", "container-5"],
    });
    expect(requestStop).toHaveBeenCalledWith("test shutdown");
    expect(commandRunner).toHaveBeenCalledWith("docker", ["kill", "container-1"], process.cwd());
    expect(commandRunner).toHaveBeenCalledWith("docker", ["kill", "container-3"], process.cwd());
    expect(commandRunner).toHaveBeenCalledWith("docker", ["kill", "container-4"], process.cwd());
    expect(commandRunner).toHaveBeenCalledWith("docker", ["kill", "container-5"], process.cwd());
    expect(commandRunner).not.toHaveBeenCalledWith("docker", ["kill", "container-2"], process.cwd());
  });

  it("continues killing containers when a dispatch stop hook rejects", async () => {
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    activeDispatchRegistry.register({
      dispatchId: "dispatch-1",
      sessionId: "session-1",
      executorType: "docker_cli",
      requestStop: vi.fn().mockRejectedValue(new Error("abort failed")),
    });
    commandRunner.mockImplementation(async (_command, args) => {
      if (args[0] === "ps") {
        return {
          stdout: dockerPsLine({ id: "container-1", names: "code-ux-codex-session-1", labels: "code-ux.session-id=session-1" }),
        };
      }
      return { stdout: "" };
    });

    const logger = { warn: vi.fn(), info: vi.fn() };
    const service = new ShutdownContainerService({ activeDispatchRegistry, logger: logger as any, commandRunner });
    const result = await service.stopRunningContainers();

    expect(result.killedContainerIds).toEqual(["container-1"]);
    expect(logger.warn).toHaveBeenCalledWith("Failed to request active dispatch stop during shutdown", expect.objectContaining({
      dispatchId: "dispatch-1",
    }));
  });
});
