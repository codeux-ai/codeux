import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const stat = vi.fn();
const readdir = vi.fn();

vi.mock("../../../src/shared/subprocess/command-runner.js", () => ({
  commandRunner: { run: (...a: unknown[]) => run(...a) },
}));

vi.mock("fs/promises", () => ({
  stat: (...a: unknown[]) => stat(...a),
  readdir: (...a: unknown[]) => readdir(...a),
}));

import { getOnboardingRuntimeReadiness } from "../../../src/services/onboarding-readiness-service.js";
import type { SystemSettings } from "../../../src/contracts/settings-scope-types.js";

function makeSettings(overrides?: Partial<{ providers: Record<string, unknown>; cliWorkflow: Record<string, unknown> }>): SystemSettings {
  return {
    integrations: { providers: overrides?.providers ?? {} },
    defaults: { cliWorkflow: overrides?.cliWorkflow ?? {} },
  } as unknown as SystemSettings;
}

const ok = (stdout = "ok") => ({ ok: true, code: 0, stdout, stderr: "" });
const fail = (stderr = "missing") => ({ ok: false, code: 1, stdout: "", stderr });

// Each test advances the system clock past the 6s readiness cache TTL so the
// module-level cache from a previous test does not leak in.
let clock = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  clock += 1_000_000;
  vi.setSystemTime(clock);
  run.mockReset();
  stat.mockReset();
  readdir.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getOnboardingRuntimeReadiness", () => {
  it("reports a ready cluster and checks the daemon when docker + git are present", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "docker" && args[0] === "--version") return ok("Docker 25");
      if (cmd === "docker" && args[0] === "info") return ok('"25.0"');
      if (cmd === "git") return ok("git 2.43");
      return fail();
    });
    stat.mockRejectedValue(new Error("nope"));
    readdir.mockRejectedValue(new Error("nope"));

    const result = await getOnboardingRuntimeReadiness(makeSettings());

    expect(result.cluster.status).toBe("ready");
    const ids = result.dependencies.map((d) => d.id);
    expect(ids).toEqual(["docker-cli", "docker-daemon", "git-cli"]);
    expect(result.dependencies.every((d) => d.status === "ready")).toBe(true);
    // The daemon check is only invoked when the CLI is present.
    expect(run).toHaveBeenCalledWith("docker", ["info", "--format", "{{json .ServerVersion}}"], expect.anything());
  });

  it("marks the cluster not ready and skips the daemon probe when the docker CLI is missing", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "docker") return fail("docker not found");
      if (cmd === "git") return ok("git 2.43");
      return fail();
    });
    stat.mockRejectedValue(new Error("nope"));
    readdir.mockRejectedValue(new Error("nope"));

    const result = await getOnboardingRuntimeReadiness(makeSettings());

    expect(result.cluster.status).toBe("not_ready");
    const daemon = result.dependencies.find((d) => d.id === "docker-daemon");
    expect(daemon?.status).toBe("missing");
    expect(daemon?.detail).toMatch(/Skipping daemon connection test/);
    // info probe never runs because the CLI check failed.
    expect(run).not.toHaveBeenCalledWith("docker", ["info", "--format", "{{json .ServerVersion}}"], expect.anything());
  });

  it("detects provider auth files via the relevant-file candidates", async () => {
    run.mockResolvedValue(ok());
    stat.mockImplementation(async (full: string) => {
      if (full.includes("credentials.json")) return { isFile: () => true, isDirectory: () => false };
      throw new Error("missing");
    });
    readdir.mockRejectedValue(new Error("nope"));

    const result = await getOnboardingRuntimeReadiness(makeSettings());

    const claude = result.providers.find((p) => p.provider === "claude-code");
    expect(claude?.available).toBe(true);
    expect(claude?.detectedFiles).toContain("credentials.json");
    expect(claude?.description).toMatch(/local auth was detected/);
  });

  it("falls back to a directory listing when no known candidate files exist", async () => {
    run.mockResolvedValue(ok());
    stat.mockRejectedValue(new Error("missing"));
    readdir.mockImplementation(async (dir: string) => {
      if (dir.includes(".gemini")) return [".DS_Store", "a.json", "b.json", "c.json", "d.json", "e.json"];
      return [];
    });

    const result = await getOnboardingRuntimeReadiness(makeSettings());

    const gemini = result.providers.find((p) => p.provider === "gemini");
    expect(gemini?.available).toBe(true);
    // The fallback caps the listing at four entries.
    expect(gemini?.detectedFiles).toHaveLength(4);
    expect(gemini?.detectedFiles).not.toContain(".DS_Store");
  });

  it("honors per-instance auth path and mount settings", async () => {
    run.mockResolvedValue(ok());
    stat.mockImplementation(async (full: string) => {
      if (full.startsWith("/custom/codex")) return { isFile: () => true, isDirectory: () => false };
      throw new Error("missing");
    });
    readdir.mockRejectedValue(new Error("nope"));

    const settings = makeSettings({
      providers: {
        codexInstance: { provider: "codex", authPath: "/custom/codex", mountAuth: true },
      },
    });
    const result = await getOnboardingRuntimeReadiness(settings);

    const codex = result.providers.find((p) => p.provider === "codex");
    expect(codex?.authPath).toBe("/custom/codex");
    expect(codex?.mountEnabled).toBe(true);
    expect(codex?.available).toBe(true);
  });

  it("treats the cliWorkflow mount flag as enabling the mount", async () => {
    run.mockResolvedValue(ok());
    stat.mockRejectedValue(new Error("missing"));
    readdir.mockRejectedValue(new Error("nope"));

    const settings = makeSettings({ cliWorkflow: { containerMountQwenCodeAuth: true } });
    const result = await getOnboardingRuntimeReadiness(settings);

    const qwen = result.providers.find((p) => p.provider === "qwen-code");
    expect(qwen?.mountEnabled).toBe(true);
    expect(qwen?.available).toBe(false);
    expect(qwen?.description).toMatch(/was not detected/);
  });

  it("serves the cached readiness within the TTL without re-running checks", async () => {
    run.mockResolvedValue(ok());
    stat.mockRejectedValue(new Error("missing"));
    readdir.mockRejectedValue(new Error("nope"));

    const first = await getOnboardingRuntimeReadiness(makeSettings());
    const callsAfterFirst = run.mock.calls.length;

    vi.setSystemTime(clock + 2000); // still inside the 6s TTL
    const second = await getOnboardingRuntimeReadiness(makeSettings());

    expect(second).toBe(first);
    expect(run.mock.calls.length).toBe(callsAfterFirst);
  });
});
