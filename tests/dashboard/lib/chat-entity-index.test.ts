import { describe, it, expect } from "vitest";
import {
  buildThreadIndex,
  buildInvocationIndex,
  buildConnectionIndex,
} from "../../../dashboard/src/v2/lib/chat-entity-index.js";
import type { ChatThread, ExecutionInvocationRecord, AgentConnection } from "../../../dashboard/src/v2/types.js";

describe("chat-entity-index", () => {
  it("builds thread index", () => {
    const t1 = { id: "t1" } as ChatThread;
    const t2 = { id: "t2" } as ChatThread;
    const map = buildThreadIndex([t1, t2]);
    expect(map.get("t1")).toBe(t1);
    expect(map.get("t2")).toBe(t2);
    expect(map.size).toBe(2);
  });

  it("builds invocation index", () => {
    const i1 = { id: "i1" } as ExecutionInvocationRecord;
    const i2 = { id: "i2" } as ExecutionInvocationRecord;
    const map = buildInvocationIndex([i1, i2]);
    expect(map.get("i1")).toBe(i1);
    expect(map.get("i2")).toBe(i2);
    expect(map.size).toBe(2);
  });

  it("builds connection index", () => {
    const c1 = { id: "c1" } as AgentConnection;
    const c2 = { id: "c2" } as AgentConnection;
    const map = buildConnectionIndex([c1, c2]);
    expect(map.get("c1")).toBe(c1);
    expect(map.get("c2")).toBe(c2);
    expect(map.size).toBe(2);
  });
});
