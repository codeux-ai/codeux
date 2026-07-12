import { describe, expect, it } from "vitest";
import { listNodeDefinitions, resolveNodeDefinition } from "../../../../src/domain/node-flows/node-definition-registry.js";

describe("node definition registry", () => {
  it("registers the governed executable catalog", () => {
    expect(listNodeDefinitions().filter((definition) => definition.executable).map((definition) => definition.type)).toEqual([
      "input", "set_fields", "template", "provider_prompt", "http_request", "condition", "switch",
      "foreach", "merge", "delay", "approval", "email_draft", "email_send", "execute_subflow",
      "webhook_trigger", "output",
    ]);
    expect(resolveNodeDefinition("condition", 1)).toMatchObject({
      executable: true,
      ports: expect.arrayContaining([expect.objectContaining({ id: "true" }), expect.objectContaining({ id: "false" })]),
    });
    expect(resolveNodeDefinition("http_request", 1)).toMatchObject({
      executionKind: "http",
      sideEffect: "external",
      capabilities: ["network.http"],
      defaultPolicy: { timeout: { timeoutMs: 30_000 } },
    });
  });
});
