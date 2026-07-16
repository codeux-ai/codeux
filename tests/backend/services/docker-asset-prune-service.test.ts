import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DockerAssetPruneService } from "../../../src/services/docker-asset-prune-service.js";
import { getRuntimeOwnerLabel } from "../../../src/shared/config/runtime-owner.js";

import * as fs from "fs/promises";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(new Error("missing")),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe("DockerAssetPruneService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockRejectedValue(new Error("missing"));
  });

  it("scopes every startup Docker scan to the current runtime state home", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;
    vi.mocked(runCommandStrict).mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      code: 0,
    } as any);

    await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    const dockerCalls = vi.mocked(runCommandStrict).mock.calls.map((call) => call[1]);
    const ownerFilter = `label=${getRuntimeOwnerLabel()}`;
    const assetScans = dockerCalls.filter((args) => (
      (args[0] === "ps" && args.includes("label=code-ux.helper"))
      || (args[0] === "ps" && args.includes("label=code-ux.login=true"))
      || (args[0] === "ps" && args.includes("label=code-ux.command"))
      || (args[0] === "volume" && args[1] === "ls")
    ));
    expect(assetScans.length).toBeGreaterThanOrEqual(6);
    expect(assetScans.every((args) => args.includes(ownerFilter))).toBe(true);
  });

  it("removes owner-scoped provider containers left in running or created state", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => ({
      ok: true,
      stdout: args[0] === "ps" && args.includes("label=code-ux.command")
        ? "provider-running\nprovider-created\n"
        : "",
      stderr: "",
      code: 0,
    } as any));

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedProviderContainers).toEqual(["provider-running", "provider-created"]);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "provider-running", "provider-created"],
      expect.any(String),
      process.env,
      { timeout: 10_000 },
    );
    expect(vi.mocked(runCommandStrict).mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        "docker",
        expect.arrayContaining([
          "ps",
          "-aq",
          "label=code-ux.managed=true",
          "label=code-ux.command",
          `label=${getRuntimeOwnerLabel()}`,
        ]),
      ]),
    ]));
  });

  it("prunes stale workspace volumes while preserving cached setup images on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => [
        { id: "cli-codex-active", state: "RUNNING", provider: "codex", repoPath: "/repo/a", updateTime: "" },
      ]),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace=true")) {
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
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace-runtime=true")) {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-active-runtime",
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale-runtime",
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

    expect(result.prunedWorkspaceVolumes).toEqual([
      "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale",
      "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale-runtime",
    ]);
    expect(result.prunedSetupImages).toEqual([]);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      [
        "volume",
        "rm",
        "-f",
        "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale",
        "code-ux-repo-aaaaaaaaaaaa-cli-codex-stale-runtime",
      ],
      expect.any(String),
      process.env,
      { timeout: 10_000 },
    );
    expect(runCommandStrict).not.toHaveBeenCalledWith("docker", ["image", "rm", "-f", expect.any(String)], expect.any(String), process.env, { timeout: 10_000 });
  });

  it("preserves failed tracked CLI workspace volumes so startup retries can resume them", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => [
        { id: "cli-codex-interrupted", state: "FAILED", provider: "codex", repoPath: "/repo/a", updateTime: "" },
      ]),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace=true")) {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-interrupted",
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-orphaned",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace-runtime=true")) {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-interrupted-runtime",
            "code-ux-repo-aaaaaaaaaaaa-cli-codex-orphaned-runtime",
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

    expect(result.prunedWorkspaceVolumes).toEqual([
      "code-ux-repo-aaaaaaaaaaaa-cli-codex-orphaned",
      "code-ux-repo-aaaaaaaaaaaa-cli-codex-orphaned-runtime",
    ]);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      [
        "volume",
        "rm",
        "-f",
        "code-ux-repo-aaaaaaaaaaaa-cli-codex-orphaned",
        "code-ux-repo-aaaaaaaaaaaa-cli-codex-orphaned-runtime",
      ],
      expect.any(String),
      process.env,
      { timeout: 10_000 },
    );
  });

  it("preserves completed tracked CLI workspace volumes until explicit cleanup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => [
        { id: "cli-mockup-cli-completed", state: "COMPLETED", provider: "mockup-cli", repoPath: "/repo/a", updateTime: "" },
      ]),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace=true")) {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-completed",
            "code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-orphaned",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace-runtime=true")) {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-completed-runtime",
            "code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-orphaned-runtime",
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

    expect(result.prunedWorkspaceVolumes).toEqual([
      "code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-orphaned",
      "code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-orphaned-runtime",
    ]);
    expect(result.prunedWorkspaceVolumes).not.toContain("code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-completed");
    expect(result.prunedWorkspaceVolumes).not.toContain("code-ux-repo-aaaaaaaaaaaa-cli-mockup-cli-completed-runtime");
  });

  it("preserves sessions tracked during cleanup and newly created workspace volumes", async () => {
    const listTrackedCliSessions = vi.fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { id: "qa-review-live", state: "RUNNING", provider: "mockup-cli", repoPath: "/repo/a", updateTime: "" },
      ]);
    const sessionTracking = { listTrackedCliSessions } as unknown as SessionTrackingRepository;
    const now = Date.now();

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace=true")) {
        return {
          ok: true,
          stdout: [
            "code-ux-repo-aaaaaaaaaaaa-qa-review-live",
            "code-ux-repo-aaaaaaaaaaaa-qa-review-not-yet-tracked",
            "code-ux-repo-aaaaaaaaaaaa-old-orphan",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=code-ux.workspace-runtime=true")) {
        return { ok: true, stdout: "", stderr: "", code: 0 } as any;
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        return {
          ok: true,
          stdout: JSON.stringify([
            { Name: "code-ux-repo-aaaaaaaaaaaa-qa-review-live", CreatedAt: new Date(now - 60_000).toISOString() },
            { Name: "code-ux-repo-aaaaaaaaaaaa-qa-review-not-yet-tracked", CreatedAt: new Date(now - 60_000).toISOString() },
            { Name: "code-ux-repo-aaaaaaaaaaaa-old-orphan", CreatedAt: new Date(now - 60 * 60_000).toISOString() },
          ]),
          stderr: "",
          code: 0,
        } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(listTrackedCliSessions).toHaveBeenCalledTimes(2);
    expect(result.prunedWorkspaceVolumes).toEqual(["code-ux-repo-aaaaaaaaaaaa-old-orphan"]);
  });

  it("prunes orphaned login containers on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "ps" && args.includes("label=code-ux.login=true")) {
        return {
          ok: true,
          stdout: [
            "container-id-1",
            "container-id-2",
          ].join("\n"),
          stderr: "",
          code: 0,
        } as any;
      }
      if (args[0] === "rm" && args[1] === "-f") {
        return {
          ok: true,
          stdout: "container-deleted",
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

    expect(result.prunedLoginContainers).toEqual(["container-id-1", "container-id-2"]);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", "-v", "container-id-1", "container-id-2"],
      expect.any(String),
      process.env,
      { timeout: 10_000 },
    );
  });

  it("prunes temporary credentials directories on startup", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;

    const mockReaddir = vi.fn().mockResolvedValue([
      { isDirectory: () => true, name: "gemini-temp-session123" },
      { isDirectory: () => true, name: "claude-code" },
      { isDirectory: () => false, name: "gemini-temp-other" },
    ]);
    const mockRm = vi.fn().mockResolvedValue(undefined);

    vi.mocked(fs.readdir).mockImplementation(mockReaddir);
    vi.mocked(fs.rm).mockImplementation(mockRm);

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedTempCredentialsDirs).toEqual(["gemini-temp-session123"]);
    expect(fs.readdir).toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining("gemini-temp-session123"),
      { recursive: true, force: true }
    );
  });

  it("prunes stale Playwright browser volumes while preserving the active and newest versions", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;
    const createdAt = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const browserVolumes = ["browser-active", "browser-newest", "browser-previous", "browser-stale"];
    const dates: Record<string, string> = {
      "browser-active": createdAt(120),
      "browser-newest": createdAt(1),
      "browser-previous": createdAt(2),
      "browser-stale": createdAt(90),
    };
    vi.mocked(fs.readFile).mockImplementation(async (target) => {
      if (String(target).endsWith("playwright-browser.json")) {
        return JSON.stringify({ runtime: { volumeName: "browser-active" } });
      }
      throw new Error("missing");
    });
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=ai.codeux.asset=playwright-browser")) {
        return { ok: true, stdout: browserVolumes.join("\n"), stderr: "", code: 0 } as any;
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        return {
          ok: true,
          stdout: JSON.stringify(args.slice(2).map((name) => ({ Name: name, CreatedAt: dates[name] }))),
          stderr: "",
          code: 0,
        } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    const result = await new DockerAssetPruneService(sessionTracking).cleanupOnStartup();

    expect(result.prunedPlaywrightBrowserVolumes).toEqual(["browser-stale"]);
    expect(runCommandStrict).toHaveBeenCalledWith(
      "docker",
      ["volume", "rm", "-f", "browser-stale"],
      expect.any(String),
      process.env,
      { timeout: 10_000 },
    );
  });

  it("batches volume inspections and bounds concurrent Docker control-plane calls", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;
    const browserVolumes = Array.from({ length: 6 }, (_, index) => `browser-${index}`);
    let activeInspections = 0;
    let peakInspections = 0;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=ai.codeux.asset=playwright-browser")) {
        return { ok: true, stdout: browserVolumes.join("\n"), stderr: "", code: 0 } as any;
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        activeInspections += 1;
        peakInspections = Math.max(peakInspections, activeInspections);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeInspections -= 1;
        return {
          ok: true,
          stdout: JSON.stringify(args.slice(2).map((name) => ({
            Name: name,
            CreatedAt: new Date().toISOString(),
          }))),
          stderr: "",
          code: 0,
        } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    await new DockerAssetPruneService(sessionTracking, undefined, {
      dockerBatchSize: 2,
      dockerConcurrency: 2,
    }).cleanupOnStartup();

    const inspectionCalls = vi.mocked(runCommandStrict).mock.calls
      .map((call) => call[1])
      .filter((args) => args[0] === "volume" && args[1] === "inspect");
    expect(inspectionCalls).toHaveLength(3);
    expect(inspectionCalls.every((args) => args.slice(2).length === 2)).toBe(true);
    expect(peakInspections).toBe(2);
  });

  it("uses bounded per-volume inspection fallback when a batch races asset removal", async () => {
    const sessionTracking = {
      listTrackedCliSessions: vi.fn(() => []),
    } as unknown as SessionTrackingRepository;
    const browserVolumes = ["browser-newest", "browser-previous", "browser-stale", "browser-gone"];
    const dates: Record<string, string> = {
      "browser-newest": new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      "browser-previous": new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      "browser-stale": new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
    let activeIndividualInspections = 0;
    let peakIndividualInspections = 0;

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "volume" && args[1] === "ls" && args.includes("label=ai.codeux.asset=playwright-browser")) {
        return { ok: true, stdout: browserVolumes.join("\n"), stderr: "", code: 0 } as any;
      }
      if (args[0] === "volume" && args[1] === "inspect" && args.slice(2).length > 1) {
        return { ok: false, stdout: "", stderr: "volume disappeared", code: 1 } as any;
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        activeIndividualInspections += 1;
        peakIndividualInspections = Math.max(peakIndividualInspections, activeIndividualInspections);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeIndividualInspections -= 1;
        const name = args[2];
        if (name === "browser-gone") {
          return { ok: false, stdout: "", stderr: "missing", code: 1 } as any;
        }
        return {
          ok: true,
          stdout: JSON.stringify([{ Name: name, CreatedAt: dates[name] }]),
          stderr: "",
          code: 0,
        } as any;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    const result = await new DockerAssetPruneService(sessionTracking, undefined, {
      dockerBatchSize: 4,
      dockerConcurrency: 2,
    }).cleanupOnStartup();

    expect(result.prunedPlaywrightBrowserVolumes).toEqual(["browser-stale"]);
    expect(peakIndividualInspections).toBe(2);
  });

  it("joins overlapping startup cleanup requests into one sweep", async () => {
    const listTrackedCliSessions = vi.fn(() => []);
    const sessionTracking = { listTrackedCliSessions } as unknown as SessionTrackingRepository;
    let releaseHelperScan: (() => void) | undefined;
    const helperScanBlocked = new Promise<void>((resolve) => {
      releaseHelperScan = resolve;
    });

    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "ps" && args.includes("label=code-ux.helper")) {
        await helperScanBlocked;
      }
      return { ok: true, stdout: "", stderr: "", code: 0 } as any;
    });

    const service = new DockerAssetPruneService(sessionTracking);
    const firstCleanup = service.cleanupOnStartup();
    const secondCleanup = service.cleanupOnStartup();

    expect(secondCleanup).toBe(firstCleanup);
    expect(listTrackedCliSessions).toHaveBeenCalledTimes(1);
    releaseHelperScan?.();
    await Promise.all([firstCleanup, secondCleanup]);
    expect(listTrackedCliSessions).toHaveBeenCalledTimes(2);
  });
});
