import { describe, expect, it } from "vitest";
import { listNodeDefinitions, resolveNodeDefinition } from "../../../../src/domain/node-flows/node-definition-registry.js";

describe("node definition registry", () => {
  it("registers only the six implemented executable node types", () => {
    expect(listNodeDefinitions().filter((definition) => definition.executable).map((definition) => definition.type)).toEqual([
      "input", "set_fields", "template", "provider_prompt", "http_request", "output",
    ]);
    expect(resolveNodeDefinition("condition", 1)).toBeNull();
    expect(resolveNodeDefinition("http_request", 1)).toMatchObject({
      executionKind: "http",
      sideEffect: "external",
      capabilities: ["network.http"],
      defaultPolicy: { timeout: { timeoutMs: 30_000 } },
    });
  });
});
