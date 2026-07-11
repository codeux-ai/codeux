import { describe, expect, it } from "vitest";
import {
  getCurrentMcpAgentId,
  getCurrentMcpThreadId,
  runWithMcpAgentContext,
} from "../../../src/server/mcp-agent-context.js";

describe("mcp-agent-context", () => {
  it("returns null outside any context", () => {
    expect(getCurrentMcpAgentId()).toBeNull();
    expect(getCurrentMcpThreadId()).toBeNull();
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
      expect(getCurrentMcpThreadId()).toBeNull();
    });
  });

  it("exposes the dashboard thread while preserving the agent context", async () => {
    await runWithMcpAgentContext("agent-42", "thread-7", async () => {
      expect(getCurrentMcpAgentId()).toBe("agent-42");
      expect(getCurrentMcpThreadId()).toBe("thread-7");
      await Promise.resolve();
      expect(getCurrentMcpThreadId()).toBe("thread-7");
    });
    expect(getCurrentMcpThreadId()).toBeNull();
  });
});
