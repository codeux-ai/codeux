import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DockerAssetPruneService } from "../../../src/services/docker-asset-prune-service.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

describe("DockerAssetPruneService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prunes stale workspace volumes and cached setup images on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => [
        { id: "cli-codex-active", state: "RUNNING", provider: "codex", repoPath: "/repo/a", updateTime: "" },
      ]),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls") {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-active",
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      if (args[0] === "image" && args[1] === "ls") {
        return {
          ok: true,
          stdout: [
            "code-ux-setup-cache:abc123",
            "node:24-bookworm",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      return {
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
      } as any;
    });

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedWorkspaceVolumes).toEqual(["code-ux-repo-aaaaaaaaaaaa-cli-codex-stale"]);
    expect(result.prunedSetupImages).toEqual(["code-ux-setup-cache:abc123"]);
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["volume", "rm", "-f", "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale"], expect.any(String));
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["image", "rm", "-f", "code-ux-setup-cache:abc123"], expect.any(String));
  });
});
