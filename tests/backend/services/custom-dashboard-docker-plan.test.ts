import { describe, expect, it } from "vitest";
import {
  buildCustomDashboardValidationDockerCreateArgs,
  buildCustomDashboardValidationDockerRunArgs,
  CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT,
} from "../../../src/services/custom-dashboard-docker-plan.js";

const baseArgs = {
  projectId: "project-1",
  dashboardId: "dashboard-1",
  revisionId: "revision-1",
  sessionId: "session-1",
  workspacePath: "/tmp/runtime/workspace",
  runtimeHomePath: "/tmp/runtime/home",
  userSpec: "1000:1000",
  resolvedImage: "node:24-bookworm",
  bootstrapScript: "exec \"$@\"",
};

function expectHardened(args: string[]): void {
  expect(args).toEqual(expect.arrayContaining([
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--cpus", "1",
    "--memory", "768m",
    "--memory-swap", "768m",
    "--pids-limit", "128",
    "--ulimit", "nofile=1024:1024",
    "--user", "1000:1000",
  ]));
  const mounts = args.filter((value) => value.startsWith("type=bind"));
  expect(mounts).toHaveLength(2);
  expect(mounts.join(" ")).not.toMatch(/credential|\.ssh|app\.db|\/home\//i);
  expect(args).not.toContain("--privileged");
}

describe("custom dashboard Docker plan", () => {
  it("hardens the bounded install/build container without credential mounts", () => {
    const args = buildCustomDashboardValidationDockerRunArgs({
      ...baseArgs,
      command: "npm install --ignore-scripts && npm run build --ignore-scripts",
    });
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expectHardened(args);
  });

  it("hardens the detached localhost-only preview container", () => {
    const args = buildCustomDashboardValidationDockerCreateArgs({
      ...baseArgs,
      hostPort: 4555,
      containerName: "code-ux-cdash-test",
      startCommand: "npm run start",
    });
    expect(args[0]).toBe("create");
    expect(args).toContain(`127.0.0.1:4555:${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT}`);
    expectHardened(args);
  });
});
