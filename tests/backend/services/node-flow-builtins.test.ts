import { describe, expect, it } from "vitest";
import { BuiltinExecutors, MAX_FOREACH_ITEMS } from "../../../src/services/node-flows/builtins/builtin-executors.js";

const base = { projectId: "p", flowId: "f", publicationId: "pub", runId: "r", nodeId: "n", upstream: {}, flowInput: {}, subflowDepth: 0 };

describe("governed built-in executors", () => {
  it("selects explicit condition and switch ports", async () => {
    const executors = new BuiltinExecutors();
    await expect(executors.execute("condition", { ...base, flowInput: { enabled: true }, config: { path: "input.enabled" } }))
      .resolves.toMatchObject({ selectedPorts: ["true"] });
    await expect(executors.execute("switch", { ...base, flowInput: { tier: "pro" }, config: { path: "input.tier", cases: [{ id: "paid", value: "pro" }] } }))
      .resolves.toMatchObject({ selectedPorts: ["paid"] });
  });

  it("bounds foreach and delay", async () => {
    const executors = new BuiltinExecutors();
    await expect(executors.execute("foreach", { ...base, upstream: { items: Array(MAX_FOREACH_ITEMS + 1).fill(null) }, config: { path: "upstream.items" } }))
      .rejects.toThrow(/bounded item limit/i);
    await expect(executors.execute("delay", { ...base, config: { delayMs: 3_600_001 } })).rejects.toThrow(/Delay must be between/i);
  });

  it("supports deterministic merge strategies and subflow recursion guards", async () => {
    const executors = new BuiltinExecutors({ executeSubflow: async () => ({ ok: true }) });
    await expect(executors.execute("merge", { ...base, upstream: { a: { one: 1 }, b: { two: 2 } }, config: { strategy: "object" } }))
      .resolves.toMatchObject({ output: { one: 1, two: 2 } });
    await expect(executors.execute("execute_subflow", { ...base, config: { flowId: "f" } })).rejects.toThrow(/cannot directly execute itself/i);
  });
});
