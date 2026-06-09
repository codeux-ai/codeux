import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceVolumeHelperPool } from "../../../../../src/infrastructure/providers/cli/workspace-volume-helper.js";

type Call = { command: string; args: string[] };

function makeRunner(overrides?: (call: Call) => { ok: boolean; stdout?: string; stderr?: string } | undefined) {
  const calls: Call[] = [];
  const runner = vi.fn(async (command: string, args: string[]) => {
    calls.push({ command, args });
    const custom = overrides?.({ command, args });
    if (custom) {
      return { ok: custom.ok, code: custom.ok ? 0 : 1, stdout: custom.stdout ?? "", stderr: custom.stderr ?? "" };
    }
    if (args[0] === "run" && args.includes("-d")) {
      return { ok: true, code: 0, stdout: "helper-container-id\n", stderr: "" };
    }
    if (args[0] === "exec") {
      return { ok: true, code: 0, stdout: "file-contents", stderr: "" };
    }
    // rm -f and anything else
    return { ok: true, code: 0, stdout: "", stderr: "" };
  });
  return { runner, calls };
}

describe("WorkspaceVolumeHelperPool", () => {
  const pools: WorkspaceVolumeHelperPool[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.shutdown()));
  });

  it("starts one persistent helper per volume and reuses it via docker exec", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner as any);
    pools.push(pool);

    const a = await pool.exec("vol-1", ["cat", "/workspace/a.txt"]);
    const b = await pool.exec("vol-1", ["sh", "-c", "echo hi"]);

    expect(a.stdout).toBe("file-contents");
    expect(b.stdout).toBe("file-contents");

    // Exactly one container was created (docker run -d) despite two operations.
    const createCalls = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].args).toContain("alpine:3.20");
    expect(createCalls[0].args.join(" ")).toContain("code-ux.helper=volume");

    // Both operations ran via `docker exec` into the same helper container id.
    const execCalls = calls.filter((c) => c.args[0] === "exec");
    expect(execCalls).toHaveLength(2);
    expect(execCalls[0].args).toEqual(["exec", "helper-container-id", "cat", "/workspace/a.txt"]);
    expect(execCalls[1].args).toEqual(["exec", "helper-container-id", "sh", "-c", "echo hi"]);
  });

  it("keeps separate helpers per volume", async () => {
    const { runner, calls } = makeRunner();
    const pool = new WorkspaceVolumeHelperPool(runner as any);
    pools.push(pool);

    await pool.exec("vol-a", ["cat", "x"]);
    await pool.exec("vol-b", ["cat", "x"]);

    const createCalls = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(createCalls).toHaveLength(2);
  });

  it("recreates the helper transparently when it has disappeared", async () => {
    let execCount = 0;
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "exec") {
        execCount += 1;
        if (execCount === 1) {
          return { ok: false, stderr: "Error: No such container: helper-container-id" };
        }
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner as any);
    pools.push(pool);

    await pool.exec("vol-1", ["cat", "x"]); // primes the helper
    const result = await pool.exec("vol-1", ["cat", "x"]); // helper vanished -> recreate + retry

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("file-contents");
    // Two creates: initial + recreate after the container went missing.
    const createCalls = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(createCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to docker run --rm when the helper cannot be created", async () => {
    const { runner, calls } = makeRunner(({ args }) => {
      if (args[0] === "run" && args.includes("-d")) {
        return { ok: false, stderr: "cannot create container" };
      }
      if (args[0] === "run" && args.includes("--rm")) {
        return { ok: true, stdout: "fallback-output" };
      }
      return undefined;
    });
    const pool = new WorkspaceVolumeHelperPool(runner as any);
    pools.push(pool);

    const result = await pool.exec("vol-1", ["cat", "x"]);

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("fallback-output");
    const fallbackCalls = calls.filter((c) => c.args[0] === "run" && c.args.includes("--rm"));
    expect(fallbackCalls).toHaveLength(1);
    expect(fallbackCalls[0].args).toEqual(expect.arrayContaining(["alpine:3.20", "cat", "x"]));
  });
});
