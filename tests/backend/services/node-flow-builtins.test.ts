import { describe, expect, it } from "vitest";
import { BuiltinExecutors, MAX_FOREACH_ITEMS } from "../../../src/services/node-flows/builtins/builtin-executors.js";
import { listNodeDefinitions } from "../../../src/domain/node-flows/node-definition-registry.js";
import { customNodeDefinitionFromArtifact, type CustomNodeArtifact } from "../../../src/contracts/custom-node-types.js";

const base = { projectId: "p", flowId: "f", publicationId: "pub", runId: "r", nodeId: "n", upstream: {}, flowInput: {}, subflowDepth: 0 };

describe("governed built-in executors", () => {
  it("declares bounded credential kind and capability policy on every built-in slot", () => {
    const requirements = listNodeDefinitions().filter((definition) => !definition.type.startsWith("custom."))
      .flatMap((definition) => definition.credentials.map((credential) => ({ definition: definition.type, credential })));

    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ definition: "provider_prompt", credential: expect.objectContaining({ requiredCapabilities: ["read"] }) }),
      expect.objectContaining({ definition: "http_request", credential: expect.objectContaining({ requiredCapabilities: ["read"] }) }),
    ]));
    expect(requirements.every(({ credential }) => credential.allowedKinds.length > 0 && credential.allowedKinds.length <= 128
      && credential.requiredCapabilities.length > 0 && credential.requiredCapabilities.length <= 128)).toBe(true);
  });

  it("normalizes the schema-v1 custom-node requiredCapability into definition policy", () => {
    const artifact = {
      manifest: {
        nodeType: "custom.capability-fixture",
        version: 1,
        name: "Capability fixture",
        description: "",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        configurationSchema: { type: "object" },
        capabilities: ["credentials.read"],
        credentials: [{ slot: "jobs", label: "Jobs", required: true, allowedKinds: ["http.token"], requiredCapability: "jobs.list" }],
        resources: { timeoutMs: 30_000 },
      },
    } as unknown as CustomNodeArtifact;

    expect(customNodeDefinitionFromArtifact(artifact).credentials).toEqual([expect.objectContaining({
      slot: "jobs",
      requiredCapabilities: ["jobs.list"],
    })]);
  });

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
    await expect(executors.execute("foreach", { ...base, upstream: { items: [1, 2, 3] }, config: { path: "upstream.items", maxItems: 2 } }))
      .rejects.toThrow(/bounded item limit of 2/i);
    await expect(executors.execute("delay", { ...base, config: { delayMs: 3_600_001 } })).rejects.toThrow(/Delay must be between/i);
  });

  it("supports deterministic merge strategies and subflow recursion guards", async () => {
    const executors = new BuiltinExecutors({ executeSubflow: async () => ({ ok: true }) });
    await expect(executors.execute("merge", { ...base, upstream: { a: { one: 1 }, b: { two: 2 } }, config: { strategy: "object" } }))
      .resolves.toMatchObject({ output: { one: 1, two: 2 } });
    await expect(executors.execute("execute_subflow", { ...base, config: { flowId: "f" } })).rejects.toThrow(/cannot directly execute itself/i);
  });
});
