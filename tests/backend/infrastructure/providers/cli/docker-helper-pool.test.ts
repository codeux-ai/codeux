import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DockerHelperContainerPool,
  type HelperCommandRunner,
} from "../../../../../src/infrastructure/providers/cli/docker-helper-pool.js";

type Call = { command: string; args: string[] };
type RunnerResult = { ok: boolean; code?: number; stdout?: string; stderr?: string };

function makePool(
  overrides?: (call: Call) => RunnerResult | Promise<RunnerResult> | undefined,
  options: { maxContainers?: number } = {},
) {
  const calls: Call[] = [];
  const runner = vi.fn(async (command: string, args: string[]) => {
    calls.push({ command, args });
    const custom = overrides?.({ command, args });
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
      return { ok: true, code: 0, stdout: "cid\n", stderr: "" };
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  });
  const pool = new DockerHelperContainerPool({
    nameFor: (key) => `helper-${key}`,
    buildCreateArgs: (_key, name) => ["run", "-d", "--name", name, "img"],
    maxContainers: options.maxContainers,
  }, runner as HelperCommandRunner);
  return { pool, calls, runner };
}

describe("DockerHelperContainerPool", () => {
  const pools: DockerHelperContainerPool[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
    vi.useRealTimers();
  });

  it("creates a container once per key and reuses it", async () => {
    const { pool, calls } = makePool();
    pools.push(pool);
    const id1 = await pool.ensure("k1");
    const id2 = await pool.ensure("k1");
    expect(id1).toBe("cid");
    expect(id2).toBe("cid");
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(1);
    expect(calls.findIndex((call) => call.args[0] === "rm")).toBe(-1);
    // Created with the deterministic name from nameFor.
    expect(creates[0].args).toEqual(["run", "-d", "--name", "helper-k1", "img"]);
  });

  it("reclaims and retries once only after an explicit deterministic-name conflict", async () => {
    let createCount = 0;
    const { pool, calls } = makePool(({ args }) => {
      if (args[0] !== "run") {
        return undefined;
      }
      createCount += 1;
      return createCount === 1
        ? { ok: false, stderr: 'Conflict. The container name "/helper-k1" is already in use by container "old".' }
        : { ok: true, stdout: "replacement-cid\n" };
    });
    pools.push(pool);

    await expect(pool.ensure("k1")).resolves.toBe("replacement-cid");

    const lifecycleCalls = calls.filter((call) => call.args[0] === "run" || call.args[0] === "rm");
    expect(lifecycleCalls.map((call) => call.args[0])).toEqual(["run", "rm", "run"]);
    expect(lifecycleCalls[1].args).toEqual(["rm", "-f", "-v", "helper-k1"]);
  });

  it("does not remove or retry after a non-conflict create failure", async () => {
    const { pool, calls } = makePool(({ args }) => args[0] === "run"
      ? { ok: false, stderr: "daemon storage unavailable" }
      : undefined);
    pools.push(pool);

    await expect(pool.ensure("k1")).rejects.toThrow(/storage unavailable/);
    expect(calls.filter((call) => call.args[0] === "run")).toHaveLength(1);
    expect(calls.filter((call) => call.args[0] === "rm")).toHaveLength(0);
  });

  it("dedupes concurrent ensures into a single create", async () => {
    const { pool, calls } = makePool();
    pools.push(pool);
    const [a, b] = await Promise.all([pool.ensure("k1"), pool.ensure("k1")]);
    expect(a).toBe(b);
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(1);
  });

  it("bounds concurrent Docker helper lifecycle mutations across a wide start wave", async () => {
    let activeCreates = 0;
    let peakCreates = 0;
    let releaseCreates!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreates = resolve;
    });
    const { pool } = makePool(async ({ args }) => {
      if (args[0] !== "run" || !args.includes("-d")) {
        return undefined;
      }
      activeCreates += 1;
      peakCreates = Math.max(peakCreates, activeCreates);
      await createGate;
      activeCreates -= 1;
      return { ok: true, stdout: `cid-${peakCreates}\n` };
    });
    pools.push(pool);

    const starts = Array.from({ length: 12 }, (_, index) => pool.ensure(`k${index}`));
    await vi.waitFor(() => expect(activeCreates).toBe(4));
    releaseCreates();
    await Promise.all(starts);

    expect(peakCreates).toBe(4);
  });

  it("evicts the least-recently-used idle helper before admitting beyond capacity", async () => {
    const { pool, calls } = makePool(undefined, { maxContainers: 1 });
    pools.push(pool);

    await pool.ensure("k1");
    await pool.ensure("k2");

    const firstRemovalIndex = calls.findIndex((call) => call.args[0] === "rm" && call.args.includes("cid"));
    const secondCreateIndex = calls.findIndex((call) => call.args[0] === "run" && call.args.includes("helper-k2"));
    expect(firstRemovalIndex).toBeGreaterThanOrEqual(0);
    expect(secondCreateIndex).toBeGreaterThan(firstRemovalIndex);
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("waits for an active helper before admitting a distinct key at capacity", async () => {
    let finishFirst: (() => void) | null = null;
    const { pool, calls } = makePool(undefined, { maxContainers: 1 });
    pools.push(pool);

    const first = pool.withContainer("k1", async () => {
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    await vi.waitFor(() => expect(finishFirst).not.toBeNull());
    const second = pool.withContainer("k2", async () => "second");
    await Promise.resolve();
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(1);

    finishFirst?.();
    await first;
    await expect(second).resolves.toBe("second");
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("does not evict a workflow-reserved helper between commands", async () => {
    const { pool, calls } = makePool(undefined, { maxContainers: 1 });
    pools.push(pool);

    const releaseReservation = pool.reserve("k1");
    await pool.ensure("k1");
    const waiting = pool.ensure("k2");
    await Promise.resolve();

    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(1);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("helper-k1"))).toBe(false);

    releaseReservation();
    releaseReservation();
    await expect(waiting).resolves.toBe("cid");
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("does not reap a reserved helper until its workflow lease is released", async () => {
    vi.useFakeTimers();
    const { pool, calls } = makePool();
    pools.push(pool);
    const releaseReservation = pool.reserve("k1");
    await pool.ensure("k1");

    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("helper-k1"))).toBe(false);

    releaseReservation();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("cid"))).toBe(true);
  });

  it("recreates after invalidate", async () => {
    const { pool, calls } = makePool();
    pools.push(pool);
    await pool.ensure("k1");
    pool.invalidate("k1");
    await pool.ensure("k1");
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(2);
  });

  it("does not invalidate a replacement created for an older failed generation", async () => {
    let createCount = 0;
    let resolveReplacement: ((value: RunnerResult) => void) | null = null;
    const { pool, calls } = makePool(({ args }) => {
      if (args[0] !== "run" || !args.includes("-d")) {
        return undefined;
      }
      createCount += 1;
      if (createCount === 1) {
        return { ok: true, stdout: "cid-old\n" };
      }
      return new Promise((resolve) => {
        resolveReplacement = resolve;
      });
    });
    pools.push(pool);

    const oldId = await pool.ensure("k1");
    expect(pool.invalidate("k1", oldId)).toBe(true);
    const replacementPromise = pool.ensure("k1");
    await vi.waitFor(() => expect(resolveReplacement).not.toBeNull());

    expect(pool.invalidate("k1", oldId)).toBe(false);
    resolveReplacement?.({ ok: true, stdout: "cid-new\n" });
    await expect(replacementPromise).resolves.toBe("cid-new");
    await expect(pool.ensure("k1")).resolves.toBe("cid-new");

    const creates = calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"));
    expect(creates).toHaveLength(2);
  });

  it("release removes the container and image-declared anonymous volumes by exact id", async () => {
    const { pool, calls } = makePool();
    pools.push(pool);
    await pool.ensure("k1");
    await pool.release("k1");
    const removals = calls.filter((c) => c.args[0] === "rm" && c.args.includes("cid"));
    expect(removals.length).toBeGreaterThanOrEqual(1);
    expect(removals.every((call) => call.args.includes("-v"))).toBe(true);
    // After release the next ensure creates a fresh container.
    await pool.ensure("k1");
    const creates = calls.filter((c) => c.args[0] === "run" && c.args.includes("-d"));
    expect(creates).toHaveLength(2);
  });

  it("shutdown removes all tracked containers", async () => {
    const { pool, calls } = makePool();
    pools.push(pool);
    await pool.ensure("k1");
    await pool.ensure("k2");
    await pool.shutdown();
    const removals = calls.filter((c) => c.args[0] === "rm" && c.args.includes("-f") && c.args.includes("-v") && c.args.includes("cid"));
    expect(removals.length).toBeGreaterThanOrEqual(2);
  });

  it("shutdown removes a helper whose docker run is still in flight", async () => {
    let resolveCreate: ((value: { ok: boolean; code: number; stdout: string; stderr: string }) => void) | null = null;
    const { pool, calls } = makePool(({ args }) => {
      if (args[0] !== "run") {
        return undefined;
      }
      return new Promise((resolve) => {
        resolveCreate = resolve;
      });
    });
    pools.push(pool);

    const ensurePromise = pool.ensure("k1");
    await vi.waitFor(() => expect(resolveCreate).not.toBeNull());

    const shutdownPromise = pool.shutdown();
    resolveCreate?.({ ok: true, code: 0, stdout: "late-cid\n", stderr: "" });

    await expect(ensurePromise).rejects.toThrow(/released before startup completed/);
    await shutdownPromise;

    const removals = calls.filter((c) => c.args[0] === "rm" && c.args.includes("-f") && c.args.includes("-v"));
    expect(removals.some((call) => call.args.includes("helper-k1"))).toBe(true);
    expect(removals.some((call) => call.args.includes("late-cid"))).toBe(true);
  });

  it("isContainerGone detects missing containers", () => {
    const { pool } = makePool();
    pools.push(pool);
    expect(pool.isContainerGone({ ok: false, code: 1, stdout: "", stderr: "Error: No such container: cid" })).toBe(true);
    expect(pool.isContainerGone({ ok: false, code: 1, stdout: "", stderr: "fatal: something else" })).toBe(false);
  });

  it("pins an active command until release completes", async () => {
    let finishCommand: (() => void) | null = null;
    const { pool, calls } = makePool();
    pools.push(pool);

    const command = pool.withContainer("k1", async (id) => {
      expect(id).toBe("cid");
      await new Promise<void>((resolve) => {
        finishCommand = resolve;
      });
      return "done";
    });
    await vi.waitFor(() => expect(finishCommand).not.toBeNull());

    let released = false;
    const release = pool.release("k1").then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("cid"))).toBe(false);

    finishCommand?.();
    await expect(command).resolves.toBe("done");
    await release;
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("cid"))).toBe(true);
  });

  it("deduplicates concurrent releases and delays a new acquisition until draining finishes", async () => {
    let finishCommand: (() => void) | null = null;
    const { pool, calls } = makePool();
    pools.push(pool);

    const active = pool.withContainer("k1", async () => {
      await new Promise<void>((resolve) => {
        finishCommand = resolve;
      });
    });
    await vi.waitFor(() => expect(finishCommand).not.toBeNull());

    const releaseA = pool.release("k1");
    const releaseB = pool.release("k1");
    const next = pool.withContainer("k1", async (id) => id);
    await Promise.resolve();
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(1);

    finishCommand?.();
    await active;
    await Promise.all([releaseA, releaseB]);
    await expect(next).resolves.toBe("cid");
    expect(calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"))).toHaveLength(2);
  });

  it("does not reap a pinned command and reaps it after the idle TTL", async () => {
    vi.useFakeTimers();
    let finishCommand: (() => void) | null = null;
    const calls: Call[] = [];
    const runner = vi.fn(async (command: string, args: string[]) => {
      calls.push({ command, args });
      return args[0] === "run"
        ? { ok: true, code: 0, stdout: "cid\n", stderr: "" }
        : { ok: true, code: 0, stdout: "", stderr: "" };
    });
    const pool = new DockerHelperContainerPool({
      nameFor: (key) => `helper-${key}`,
      buildCreateArgs: (_key, name) => ["run", "-d", "--name", name, "img"],
      idleTtlMs: 100,
      reapIntervalMs: 25,
    }, runner as HelperCommandRunner);
    pools.push(pool);

    const active = pool.withContainer("k1", async () => {
      await new Promise<void>((resolve) => {
        finishCommand = resolve;
      });
    });
    await vi.waitFor(() => expect(finishCommand).not.toBeNull());
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("cid"))).toBe(false);

    finishCommand?.();
    await active;
    await vi.advanceTimersByTimeAsync(99);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("cid"))).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.some((call) => call.args[0] === "rm" && call.args.includes("cid"))).toBe(true);
  });

  it("rejects invalid lifecycle bounds and acquisitions after shutdown", async () => {
    expect(() => new DockerHelperContainerPool({
      nameFor: (key) => key,
      buildCreateArgs: () => [],
      idleTtlMs: -1,
    })).toThrow(/idle TTL/);
    expect(() => new DockerHelperContainerPool({
      nameFor: (key) => key,
      buildCreateArgs: () => [],
      reapIntervalMs: 0,
    })).toThrow(/reap interval/);
    expect(() => new DockerHelperContainerPool({
      nameFor: (key) => key,
      buildCreateArgs: () => [],
      maxContainers: 0,
    })).toThrow(/capacity/);

    const { pool } = makePool();
    pools.push(pool);
    await pool.shutdown();
    await expect(pool.ensure("late")).rejects.toThrow(/shutting down/);
  });
});
