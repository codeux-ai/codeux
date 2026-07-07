/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";

import { useAgentMood, type UseAgentMoodOptions } from "../../../dashboard/src/v2/components/chat/cinematic/use-agent-mood.js";
import type { ChatMessageRecord } from "../../../dashboard/src/v2/types.js";

const agentMessage = (id: string): ChatMessageRecord => ({
  id,
  threadId: "thread-1",
  direction: "connection_to_dashboard",
  authorType: "connection",
  authorConnectionId: "conn-1",
  bodyMarkdown: "Reply",
  deliveryStatus: "processed",
  createdAt: "2026-07-07T12:00:00.000Z",
} as ChatMessageRecord);

const baseOptions: UseAgentMoodOptions = {
  error: null,
  sending: false,
  hasWorkingReply: false,
  workingPhase: null,
  messages: [],
  userEngaged: false,
  agentName: "Project Manager",
};

describe("useAgentMood", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets on an empty conversation and listens while the user is engaged", () => {
    const { result, rerender } = renderHook((props: UseAgentMoodOptions) => useAgentMood(props), {
      initialProps: baseOptions,
    });
    expect(result.current.mood).toBe("greeting");
    expect(result.current.expression).toBe("happy");

    rerender({ ...baseOptions, userEngaged: true });
    expect(result.current.mood).toBe("listening");
  });

  it("maps runtime states to expressions: routing, thinking, error", () => {
    const { result, rerender } = renderHook((props: UseAgentMoodOptions) => useAgentMood(props), {
      initialProps: { ...baseOptions, sending: true },
    });
    expect(result.current.mood).toBe("routing");
    expect(result.current.expression).toBe("nod");

    rerender({ ...baseOptions, hasWorkingReply: true, workingPhase: "starting" as const });
    expect(result.current.mood).toBe("thinking");
    expect(result.current.caption).toContain("Spinning up");

    rerender({ ...baseOptions, hasWorkingReply: true, workingPhase: "working" as const });
    expect(result.current.caption).toContain("Thinking");

    rerender({ ...baseOptions, error: "boom" });
    expect(result.current.mood).toBe("error");
    expect(result.current.expression).toBe("sad");
  });

  it("celebrates a newly landed reply, then settles back to idle", () => {
    const first = [agentMessage("m1")];
    const { result, rerender } = renderHook((props: UseAgentMoodOptions) => useAgentMood(props), {
      initialProps: { ...baseOptions, messages: first },
    });
    // History observed on mount never triggers a celebration.
    expect(result.current.mood).toBe("idle");

    rerender({ ...baseOptions, messages: [...first, agentMessage("m2")] });
    expect(result.current.mood).toBe("celebrating");
    expect(result.current.expression).toBe("excited");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.mood).toBe("idle");
  });

  it("decays to bored and sleepy while idle", () => {
    const messages = [agentMessage("m1")];
    const { result } = renderHook(() => useAgentMood({ ...baseOptions, messages }));
    expect(result.current.mood).toBe("idle");

    act(() => {
      vi.advanceTimersByTime(100_000);
    });
    expect(result.current.mood).toBe("bored");
    expect(result.current.expression).toBe("bored");

    act(() => {
      vi.advanceTimersByTime(150_000);
    });
    expect(result.current.mood).toBe("sleepy");
    expect(result.current.expression).toBe("sleepy");
  });
});
