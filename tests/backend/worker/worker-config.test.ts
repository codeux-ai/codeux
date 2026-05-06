import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../../../src/worker/worker-config.js";

describe("loadWorkerConfig", () => {
  it("builds worker-host server defaults", () => {
    const config = loadWorkerConfig(["node", "worker.js"]);

    expect(config.connectionKey).toContain("worker:");
    expect(config.displayName).toContain("Code UX Worker");
    expect(config.serverCommand).toBe(process.execPath);
    expect(config.serverArgs).toContain("--runtime-role");
    expect(config.serverArgs).toContain("worker-host");
    expect(config.controlPlaneUrl).toBeUndefined();
    expect(config.controlPlaneAuthToken).toBeUndefined();
  });

  it("parses explicit worker flags", () => {
    const config = loadWorkerConfig([
      "node",
      "worker.js",
      "--connection-key",
      "worker-1",
      "--display-name=CI Worker",
      "--project-id",
      "project-1",
      "--sprint-id",
      "sprint-1",
      "--dispatch-poll-interval-ms",
      "2000",
      "--session-poll-interval-ms",
      "3000",
      "--server-command",
      "node",
      "--server-arg",
      "dist/index.js",
      "--server-arg=--runtime-role",
      "--server-arg",
      "worker-host",
      "--server-cwd",
      "/tmp/code-ux",
    ]);

    expect(config.connectionKey).toBe("worker-1");
    expect(config.displayName).toBe("CI Worker");
    expect(config.projectId).toBe("project-1");
    expect(config.projectIds).toEqual(["project-1"]);
    expect(config.activeProjectIds).toEqual([]);
    expect(config.sprintId).toBe("sprint-1");
    expect(config.listenTimeoutSeconds).toBe(30);
    expect(config.listenPollIntervalMs).toBe(1000);
    expect(config.dispatchPollIntervalMs).toBe(2000);
    expect(config.sessionPollIntervalMs).toBe(3000);
    expect(config.serverCommand).toBe("node");
    expect(config.serverArgs).toEqual(["dist/index.js", "--runtime-role", "worker-host"]);
    expect(config.serverCwd).toBe("/tmp/code-ux");
  });

  it("parses remote control-plane flags without changing local executor defaults", () => {
    const config = loadWorkerConfig([
      "node",
      "worker.js",
      "--server-url",
      "http://10.0.0.12:5555/mcp",
      "--auth-token",
      "remote-secret",
    ]);

    expect(config.controlPlaneUrl).toBe("http://10.0.0.12:5555/mcp");
    expect(config.controlPlaneAuthToken).toBe("remote-secret");
    expect(config.serverCommand).toBe(process.execPath);
    expect(config.serverArgs).toContain("--runtime-role");
    expect(config.serverArgs).toContain("worker-host");
  });

  it("parses multi-project worker flags", () => {
    const config = loadWorkerConfig([
      "node",
      "worker.js",
      "--project-id",
      "project-1",
      "--project-id",
      "project-2",
      "--active-project-id",
      "project-2",
    ]);

    expect(config.projectId).toBe("project-1");
    expect(config.projectIds).toEqual(["project-1", "project-2"]);
    expect(config.activeProjectIds).toEqual(["project-2"]);
  });
});
