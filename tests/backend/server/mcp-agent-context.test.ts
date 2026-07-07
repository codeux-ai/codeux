import { describe, expect, it } from "vitest";
import { runWithMcpAgentContext, getCurrentMcpAgentId } from "../../../src/server/mcp-agent-context.js";

describe("mcp-agent-context", () => {
  it("returns null outside any context", () => {
    expect(getCurrentMcpAgentId()).toBeNull();
  });

  it("exposes the agent id within the context and across awaits", async () => {
    await runWithMcpAgentContext("agent-42", async () => {
      expect(getCurrentMcpAgentId()).toBe("agent-42");
      await Promise.resolve();
      expect(getCurrentMcpAgentId()).toBe("agent-42");
    });
    expect(getCurrentMcpAgentId()).toBeNull();
  });

  it("supports a null agent id (no header)", () => {
    runWithMcpAgentContext(null, () => {
      expect(getCurrentMcpAgentId()).toBeNull();
    });
  });
});
