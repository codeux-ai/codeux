import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveDispatchRegistry } from "../../../src/services/active-dispatch-registry.js";
import { ShutdownContainerService } from "../../../src/services/shutdown-container-service.js";
import { getRuntimeOwnerLabel } from "../../../src/shared/config/runtime-owner.js";

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

  it("requests active dispatch stops and removes Code UX containers in every state", async () => {
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
            dockerPsLine({ id: "container-1", names: "code-ux-codex-session-1", labels: `code-ux.session-id=session-1,${getRuntimeOwnerLabel()}` }),
            dockerPsLine({ id: "container-2", names: "unrelated", labels: "com.example.owner=test" }),
            dockerPsLine({ id: "container-3", names: "code-ux-login", labels: `code-ux.login=true,${getRuntimeOwnerLabel()}` }),
            dockerPsLine({ id: "container-4", names: "code-ux-vol-helper-workspace", labels: `code-ux.helper=volume,${getRuntimeOwnerLabel()}` }),
            dockerPsLine({ id: "container-5", names: "code-ux-git-helper-project", labels: getRuntimeOwnerLabel() }),
            dockerPsLine({ id: "container-foreign", names: "code-ux-git-helper-foreign", labels: "code-ux.helper=git,code-ux.runtime-owner=another-runtime" }),
            dockerPsLine({ id: "container-legacy", names: "code-ux-git-helper-legacy", labels: "code-ux.helper=git" }),
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
    expect(commandRunner).toHaveBeenCalledWith("docker", ["ps", "-a", "--format", "{{json .}}"], process.cwd());
    expect(commandRunner).toHaveBeenCalledWith("docker", [
      "rm", "-f", "-v", "container-1", "container-3", "container-4", "container-5",
    ], process.cwd());
    expect(commandRunner.mock.calls.flatMap((call) => call[1])).not.toContain("container-2");
    expect(commandRunner.mock.calls.flatMap((call) => call[1])).not.toContain("container-foreign");
    expect(commandRunner.mock.calls.flatMap((call) => call[1])).not.toContain("container-legacy");
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
          stdout: dockerPsLine({ id: "container-1", names: "code-ux-codex-session-1", labels: `code-ux.session-id=session-1,${getRuntimeOwnerLabel()}` }),
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

  it("can cancel dispatches before draining helpers without requesting duplicate stops", async () => {
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    const requestStop = vi.fn().mockResolvedValue({ accepted: true });
    activeDispatchRegistry.register({
      dispatchId: "dispatch-1",
      sessionId: "session-1",
      executorType: "docker_cli",
      requestStop,
    });
    commandRunner.mockImplementation(async (_command, args) => ({
      stdout: args[0] === "ps"
        ? dockerPsLine({
          id: "container-1",
          names: "code-ux-codex-session-1",
          labels: `code-ux.session-id=session-1,${getRuntimeOwnerLabel()}`,
        })
        : "",
    }));
    const service = new ShutdownContainerService({ activeDispatchRegistry, commandRunner });

    const requestedDispatchStops = await service.requestActiveDispatchStops("ordered shutdown");
    const result = await service.stopRemainingContainers(requestedDispatchStops);

    expect(requestStop).toHaveBeenCalledTimes(1);
    expect(requestStop).toHaveBeenCalledWith("ordered shutdown");
    expect(result).toEqual({ requestedDispatchStops: 1, killedContainerIds: ["container-1"] });
  });

  it("bounds large shutdown waves into parallel-safe Docker removal batches", async () => {
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    const containers = Array.from({ length: 19 }, (_, index) => ({
      id: `container-${index + 1}`,
      names: `code-ux-provider-${index + 1}`,
      labels: `code-ux.managed=true,${getRuntimeOwnerLabel()}`,
    }));
    commandRunner.mockImplementation(async (_command, args) => ({
      stdout: args[0] === "ps" ? containers.map(dockerPsLine).join("\n") : "",
    }));

    const result = await new ShutdownContainerService({
      activeDispatchRegistry,
      commandRunner,
    }).stopRunningContainers();

    const removalCalls = commandRunner.mock.calls.filter((call) => call[1][0] === "rm");
    expect(removalCalls).toHaveLength(3);
    expect(removalCalls.every((call) => call[1].slice(3).length <= 8)).toBe(true);
    expect(result.killedContainerIds).toEqual(containers.map((container) => container.id));
  });

  it("treats concurrent container disappearance as idempotent cleanup", async () => {
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    commandRunner.mockImplementation(async (_command, args) => {
      if (args[0] === "ps") {
        return {
          stdout: dockerPsLine({
            id: "container-raced",
            names: "code-ux-codex-raced",
            labels: `code-ux.managed=true,${getRuntimeOwnerLabel()}`,
          }),
        };
      }
      throw new Error("Error response from daemon: No such container: container-raced");
    });
    const logger = { warn: vi.fn(), info: vi.fn() };

    const result = await new ShutdownContainerService({
      activeDispatchRegistry,
      logger: logger as any,
      commandRunner,
    }).stopRunningContainers();

    expect(result.killedContainerIds).toEqual(["container-raced"]);
    expect(logger.warn).not.toHaveBeenCalledWith(
      "Failed to kill Code UX container during shutdown",
      expect.anything(),
    );
  });
});
