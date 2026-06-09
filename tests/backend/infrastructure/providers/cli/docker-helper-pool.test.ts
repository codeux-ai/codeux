import { describe, expect, it, vi } from "vitest";
import { DockerHelperContainerPool } from "../../../../../src/infrastructure/providers/cli/docker-helper-pool.js";

type Call = { command: string; args: string[] };

function makePool(overrides?: (call: Call) => { ok: boolean; stdout?: string; stderr?: string } | undefined) {
  const calls: Call[] = [];
  const runner = vi.fn(async (command: string, args: string[]) => {
    calls.push({ command, args });
    const custom = overrides?.({ command, args });
    if (custom) {
      return { ok: custom.ok, code: custom.ok ? 0 : 1, stdout: custom.stdout ?? "", stderr: custom.stderr ?? "" };
    }
    if (args[0] === "run" && args.includes("-d")) {
      return { ok: true, code: 0, stdout: "cid\n", stderr: "" };
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  });
  const pool = new DockerHelperContainerPool({
    nameFor: (key) => `helper-${key}`,
    buildCreateArgs: (_key, name) => ["run", "-d", "--name", name, "img"],
  }, runner as any);
  return { pool, calls, runner };
}

describe("DockerHelperContainerPool", () => {
  it("creates a container once per key and reuses it", async () => {
    const { pool, calls } = makePool();
    const id1 = await pool.ensure("k1");
    const id2 = await pool.ensure("k1");
    expect(id1).toBe("cid");
    expect(id2).toBe("cid");
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(1);
    // Created with the deterministic name from nameFor.
    expect(creates[0].args).toEqual(["run", "-d", "--name", "helper-k1", "img"]);
  });

  it("dedupes concurrent ensures into a single create", async () => {
    const { pool, calls } = makePool();
    const [a, b] = await Promise.all([pool.ensure("k1"), pool.ensure("k1")]);
    expect(a).toBe(b);
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(1);
  });

  it("recreates after invalidate", async () => {
    const { pool, calls } = makePool();
    await pool.ensure("k1");
    pool.invalidate("k1");
    await pool.ensure("k1");
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(2);
  });

  it("release removes the container by deterministic name", async () => {
    const { pool, calls } = makePool();
    await pool.ensure("k1");
    await pool.release("k1");
    const removals = calls.filter((c) => c.args[0] === "rm" && c.args.includes("helper-k1"));
    expect(removals.length).toBeGreaterThanOrEqual(1);
    // After release the next ensure creates a fresh container.
    await pool.ensure("k1");
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(2);
  });

  it("shutdown removes all tracked containers", async () => {
    const { pool, calls } = makePool();
    await pool.ensure("k1");
    await pool.ensure("k2");
    await pool.shutdown();
    const removals = calls.filter((c) => c.args[0] === "rm" && c.args.includes("-f") && c.args.includes("cid"));
    expect(removals.length).toBeGreaterThanOrEqual(2);
  });

  it("isContainerGone detects missing containers", () => {
    const { pool } = makePool();
    expect(pool.isContainerGone({ ok: false, code: 1, stdout: "", stderr: "Error: No such container: cid" })).toBe(true);
    expect(pool.isContainerGone({ ok: false, code: 1, stdout: "", stderr: "fatal: something else" })).toBe(false);
  });
});
