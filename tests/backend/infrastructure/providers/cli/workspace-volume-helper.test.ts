import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceVolumeHelperPool,
  type WorkspaceSidecarExecOptions,
} from "../../../../../src/infrastructure/providers/cli/workspace-volume-helper.js";
import type {
  HelperCommandRunner,
  HelperRunnerOptions,
} from "../../../../../src/infrastructure/providers/cli/docker-helper-pool.js";
import { getRuntimeOwnerLabel } from "../../../../../src/shared/config/runtime-owner.js";

type Call = { command: string; args: string[]; options?: HelperRunnerOptions };
type RunnerResult = { ok: boolean; code?: number; stdout?: string; stderr?: string };

function makeRunner(
  overrides?: (call: Call) => RunnerResult | Promise<RunnerResult> | undefined,
): { runner: HelperCommandRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: HelperCommandRunner = vi.fn(async (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    const custom = overrides?.(call);
    if (custom) {
      const resolved = await custom;
      return {
        ok: resolved.ok,
        code: resolved.code ?? (resolved.ok ? 0 : 1),
        stdout: resolved.stdout ?? "",
        stderr: resolved.stderr ?? "",
      };
    }
    if (args[0] === "run" && args.includes("-d")) {
      return { ok: true, code: 0, stdout: "helper-container-id\n", stderr: "" };
    }
    if (args[0] === "exec") {
      return { ok: true, code: 0, stdout: "file-contents", stderr: "" };
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  });
  return { runner, calls };
}

describe("WorkspaceVolumeHelperPool", () => {
  const pools: WorkspaceVolumeHelperPool[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("starts one secure Git-capable sidecar per volume and reuses it", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    const a = await pool.exec("vol-1", ["cat", "/workspace/a.txt"]);
    const b = await pool.exec("vol-1", ["git", "status", "--short"]);

    expect(a.stdout).toBe("file-contents");
    expect(b.stdout).toBe("file-contents");
    const createCalls = calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"));
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].args).toContain("alpine/git");
    expect(createCalls[0].args).toContain(getRuntimeOwnerLabel());
    expect(createCalls[0].args).toEqual(expect.arrayContaining([
      "--network",
      "none",
      "--security-opt",
      "no-new-privileges",
      "--label",
      "code-ux.managed=true",
      "--mount",
      "type=tmpfs,target=/git",
      "--mount",
      "type=tmpfs,target=/tmp/code-ux-home,tmpfs-mode=1777,tmpfs-size=1048576",
    ]));
    expect(createCalls[0].args).not.toContain("-p");
    expect(createCalls[0].args).not.toContain("--publish");

    const execCalls = calls.filter((call) => call.args[0] === "exec");
    expect(execCalls).toHaveLength(2);
    expect(execCalls[0].args).toEqual(["exec", "helper-container-id", "cat", "/workspace/a.txt"]);
    expect(execCalls[1].args).toEqual(["exec", "helper-container-id", "git", "status", "--short"]);
  });

  it("keeps separate helpers per workspace volume", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    await Promise.all([
      pool.exec("vol-a", ["cat", "x"]),
      pool.exec("vol-b", ["cat", "x"]),
    ]);

    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("evicts an idle workspace sidecar before exceeding its configured capacity", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner, "alpine/git", { maxContainers: 1 });
    pools.push(pool);

    await pool.exec("vol-a", ["cat", "x"]);
    await pool.exec("vol-b", ["cat", "x"]);

    const createIndexes = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.args[0] === "run" && call.args.includes("-d"))
      .map(({ index }) => index);
    expect(createIndexes).toHaveLength(2);
    const firstRemovalIndex = calls.findIndex((call, index) => (
      index > createIndexes[0] && call.args[0] === "rm" && call.args.includes("helper-container-id")
    ));
    expect(firstRemovalIndex).toBeGreaterThan(createIndexes[0]);
    expect(firstRemovalIndex).toBeLessThan(createIndexes[1]);
  });

  it("keeps a reserved workspace helper across commands while excess work waits", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner, "alpine/git", { maxContainers: 1 });
    pools.push(pool);
    const releaseReservation = pool.reserve("vol-a");

    await pool.exec("vol-a", ["git", "status"]);
    const waiting = pool.exec("vol-b", ["git", "status"]);
    await Promise.resolve();
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(1);

    await pool.exec("vol-a", ["git", "rev-parse", "HEAD"]);
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(1);
    releaseReservation();

    await expect(waiting).resolves.toMatchObject({ ok: true });
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("applies stdin, process controls, identity, workdir, and filtered environment per command", async () => {
    vi.stubEnv("OPENAI_API_KEY", "ambient-provider-secret");
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);
    const abortController = new AbortController();
    const onStdoutLine = vi.fn();
    const onStderrLine = vi.fn();
    const options: WorkspaceSidecarExecOptions = {
      stdinFile: "/tmp/paths.list",
      signal: abortController.signal,
      trimOutput: false,
      maxStdoutChars: 1234,
      onStdoutLine,
      onStderrLine,
      user: "1000:1001",
      workdir: "/workspace/subdir",
      environment: {
        GIT_CONFIG_COUNT: "1",
        GITHUB_TOKEN: "project-a-token",
        EMPTY_VALUE: "",
        OMITTED_VALUE: undefined,
      },
    };

    await pool.exec("vol-1", ["git", "hash-object", "--stdin"], undefined, options);
    await pool.exec("vol-1", ["git", "status"], undefined, {
      environment: { GITHUB_TOKEN: "project-b-token" },
    });

    const [first, second] = calls.filter((call) => call.args[0] === "exec");
    expect(first.args).toEqual([
      "exec",
      "-i",
      "--workdir",
      "/workspace/subdir",
      "--user",
      "1000:1001",
      "--env",
      "GIT_CONFIG_COUNT=1",
      "--env",
      "GITHUB_TOKEN=project-a-token",
      "helper-container-id",
      "git",
      "hash-object",
      "--stdin",
    ]);
    expect(first.args.join(" ")).not.toContain("ambient-provider-secret");
    expect(first.args).not.toContain("EMPTY_VALUE=");
    expect(first.options).toEqual({
      stdinFile: "/tmp/paths.list",
      signal: abortController.signal,
      trimOutput: false,
      maxStdoutChars: 1234,
      onStdoutLine,
      onStderrLine,
    });
    expect(second.args).toContain("GITHUB_TOKEN=project-b-token");
    expect(second.args).not.toContain("GITHUB_TOKEN=project-a-token");
    expect(second.args).not.toContain("--user");
    expect(second.args).not.toContain("--workdir");
  });

  it("rejects unsafe command, mount, environment, user, and workdir inputs before Docker", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    await expect(pool.exec("vol,readonly", ["cat", "x"])).rejects.toThrow(/volume name/);
    await expect(pool.exec("vol-1", [])).rejects.toThrow(/executable/);
    await expect(pool.exec("vol-1", ["cat", "bad\0arg"])).rejects.toThrow(/null bytes/);
    await expect(pool.exec("vol-1", ["git", "status"], undefined, {
      environment: { "BAD-NAME": "value" },
    })).rejects.toThrow(/environment name/);
    await expect(pool.exec("vol-1", ["git", "status"], undefined, {
      environment: { GOOD_NAME: "bad\0value" },
    })).rejects.toThrow(/environment value/);
    await expect(pool.exec("vol-1", ["git", "status"], undefined, {
      user: "--privileged",
    })).rejects.toThrow(/sidecar user/);
    await expect(pool.exec("vol-1", ["git", "status"], undefined, {
      workdir: "relative/path",
    })).rejects.toThrow(/absolute container path/);
    await expect(pool.exec("vol-1", ["git", "status"], undefined, {
      workdir: "/workspace/../../etc",
    })).rejects.toThrow(/mounted workspace/);
    await expect(pool.exec("vol-1", ["git", "status"], undefined, {
      workdir: "/code-ux-runtime-home",
    })).rejects.toThrow(/mounted workspace/);
    expect(calls).toHaveLength(0);
  });

  it("recreates one shared replacement when concurrent commands observe a missing generation", async () => {
    let createCount = 0;
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "run" && args.includes("-d")) {
        createCount += 1;
        return { ok: true, stdout: `cid-${createCount}\n` };
      }
      if (args[0] === "exec" && args.includes("cid-1")) {
        return { ok: false, stderr: "Error: No such container: cid-1" };
      }
      if (args[0] === "exec") {
        return { ok: true, stdout: "recovered" };
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    const [a, b] = await Promise.all([
      pool.exec("vol-1", ["git", "status"]),
      pool.exec("vol-1", ["cat", "x"]),
    ]);

    expect(a).toMatchObject({ ok: true, stdout: "recovered" });
    expect(b).toMatchObject({ ok: true, stdout: "recovered" });
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("falls back to an equivalent secure one-shot command when creation fails", async () => {
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "run" && args.includes("-d")) {
        return { ok: false, stderr: "cannot create container" };
      }
      if (args[0] === "run" && args.includes("--rm")) {
        return { ok: true, stdout: "fallback-output" };
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);
    const controller = new AbortController();

    const result = await pool.exec("vol-1", ["git", "hash-object", "--stdin"], "vol-1-runtime", {
      stdinFile: "/tmp/input",
      signal: controller.signal,
      trimOutput: false,
      user: "1000:1000",
      workdir: "/code-ux-runtime-home",
      environment: { GIT_CONFIG_COUNT: "1" },
    });

    expect(result).toMatchObject({ ok: true, stdout: "fallback-output" });
    const fallback = calls.find((call) => call.args[0] === "run" && call.args.includes("--rm"));
    expect(fallback).toBeDefined();
    expect(fallback?.args).toEqual(expect.arrayContaining([
      "--network",
      "none",
      "--security-opt",
      "no-new-privileges",
      "--mount",
      "type=tmpfs,target=/git",
      "--mount",
      "type=tmpfs,target=/tmp/code-ux-home,tmpfs-mode=1777,tmpfs-size=1048576",
      "--entrypoint",
      "git",
      "alpine/git",
      "hash-object",
      "--stdin",
      "-i",
      "--user",
      "1000:1000",
      "--workdir",
      "/code-ux-runtime-home",
      "--env",
      "GIT_CONFIG_COUNT=1",
    ]));
    expect(fallback?.args.join(" ")).toContain("source=vol-1-runtime,target=/code-ux-runtime-home");
    expect(fallback?.args).not.toContain("--publish");
    expect(fallback?.options).toMatchObject({
      stdinFile: "/tmp/input",
      signal: controller.signal,
      trimOutput: false,
    });
  });

  it("falls back once when the replacement helper also stops", async () => {
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "exec") {
        return { ok: false, stderr: `Error response from daemon: container ${args[1]} is not running` };
      }
      if (args[0] === "run" && args.includes("--rm")) {
        return { ok: true, stdout: "fallback-after-retry" };
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    const result = await pool.exec("vol-1", ["cat", "x"]);

    expect(result).toMatchObject({ ok: true, stdout: "fallback-after-retry" });
    expect(calls.filter((call) => call.args[0] === "exec")).toHaveLength(2);
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("--rm"))).toHaveLength(1);
  });

  it("does not repeat a command when the host runner throws", async () => {
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "exec") {
        return Promise.reject(new Error("host runner disconnected"));
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    await expect(pool.exec("vol-1", ["git", "update-ref", "refs/heads/x", "abc"])).rejects.toThrow(
      /host runner disconnected/,
    );
    expect(calls.filter((call) => call.args[0] === "exec")).toHaveLength(1);
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("--rm"))).toHaveLength(0);
  });

  it("mounts the runtime volume and allows a runtime-scoped workdir", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    await pool.exec(
      "vol-1",
      ["cat", "session.jsonl"],
      "vol-1-runtime",
      { workdir: "/code-ux-runtime-home/.codex" },
    );

    const createCall = calls.find((call) => call.args[0] === "run" && call.args.includes("-d"));
    expect(createCall?.args.join(" ")).toContain("source=vol-1,target=/workspace");
    expect(createCall?.args.join(" ")).toContain("source=vol-1-runtime,target=/code-ux-runtime-home");
    expect(calls.find((call) => call.args[0] === "exec")?.args).toEqual(expect.arrayContaining([
      "--workdir",
      "/code-ux-runtime-home/.codex",
    ]));
  });

  it("drains an in-flight command before release, preserves volumes, and fences new commands", async () => {
    let finishFirst: ((result: RunnerResult) => void) | null = null;
    let execCount = 0;
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "exec") {
        execCount += 1;
        if (execCount === 1) {
          return new Promise((resolve) => {
            finishFirst = resolve;
          });
        }
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);

    const first = pool.exec("vol-1", ["git", "status"], "vol-1-runtime");
    await vi.waitFor(() => expect(finishFirst).not.toBeNull());
    const releaseA = pool.releaseVolume("vol-1");
    const releaseB = pool.releaseVolume("vol-1");
    const next = pool.exec("vol-1", ["cat", "x"], "vol-1-runtime");
    await Promise.resolve();

    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(1);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("helper-container-id"))).toBe(false);

    finishFirst?.({ ok: true, stdout: "first" });
    await expect(first).resolves.toMatchObject({ ok: true, stdout: "first" });
    await Promise.all([releaseA, releaseB]);
    await expect(next).resolves.toMatchObject({ ok: true });

    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("helper-container-id"))).toBe(true);
    expect(calls.some((call) => call.args[0] === "volume")).toBe(false);
  });

  it("reaps an idle sidecar after the configured bounded lifetime", async () => {
    vi.useFakeTimers();
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner, "alpine/git", {
      idleTtlMs: 100,
      reapIntervalMs: 25,
    });
    pools.push(pool);

    await pool.exec("vol-1", ["cat", "x"]);
    await vi.advanceTimersByTimeAsync(99);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("helper-container-id"))).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("helper-container-id"))).toBe(true);

    await pool.exec("vol-1", ["cat", "x"]);
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("makes shutdown idempotent and rejects later commands without falling back", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner);
    pools.push(pool);
    await pool.exec("vol-1", ["cat", "x"]);

    await Promise.all([pool.shutdown(), pool.shutdown()]);
    const callCount = calls.length;
    await expect(pool.exec("vol-1", ["cat", "x"])).rejects.toThrow(/shutting down/);
    expect(calls).toHaveLength(callCount);
  });
});
