/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/preact";

import {
  AGENT_AMBIENT_CUE_FOR_MS,
  AGENT_IDLE_CUE_GAP_MS,
  useAgentMood,
  type UseAgentMoodOptions,
} from "../../../dashboard/src/v2/components/chat/cinematic/use-agent-mood.js";
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
    vi.setSystemTime(new Date("2026-07-07T12:00:00.000Z"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  afterEach(() => {
    cleanup();
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

  it("runs deterministic, bounded, non-overlapping idle cues", () => {
    const messages = [agentMessage("m1")];
    const { result } = renderHook(() => useAgentMood({ ...baseOptions, messages }));

    act(() => vi.advanceTimersByTime(AGENT_IDLE_CUE_GAP_MS));
    expect(result.current.ambientCue?.kind).toBe("wink");
    expect(result.current.expression).toBe("wink");

    act(() => vi.advanceTimersByTime(AGENT_AMBIENT_CUE_FOR_MS));
    expect(result.current.ambientCue).toBeNull();

    act(() => vi.advanceTimersByTime(AGENT_IDLE_CUE_GAP_MS));
    expect(result.current.ambientCue?.kind).toBe("dance");
  });

  it("welcomes the user back only after the configured away threshold", () => {
    const { result } = renderHook(() => useAgentMood({
      ...baseOptions,
      messages: [agentMessage("m1")],
      returnGreetingAfterMs: 10_000,
    }));

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(9_000));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current.ambientCue).toBeNull();

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(result.current.ambientCue?.kind).toBe("welcome_back");
    expect(result.current.ambientCue?.label).toContain("Welcome back");
  });

  it("pauses while hidden and reacts when document visibility returns", () => {
    const { result } = renderHook(() => useAgentMood({
      ...baseOptions,
      messages: [agentMessage("m1")],
      returnGreetingAfterMs: 10_000,
    }));

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.ambientMotionEnabled).toBe(false);

    act(() => vi.advanceTimersByTime(10_000));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.ambientMotionEnabled).toBe(true);
    expect(result.current.ambientCue?.kind).toBe("welcome_back");
  });

  it("suspends ambient cues for runtime truth and reduced motion", () => {
    const { result, rerender } = renderHook((props: UseAgentMoodOptions) => useAgentMood(props), {
      initialProps: { ...baseOptions, messages: [agentMessage("m1")], sending: true },
    });

    act(() => vi.advanceTimersByTime(AGENT_IDLE_CUE_GAP_MS * 2));
    expect(result.current.mood).toBe("routing");
    expect(result.current.ambientCue).toBeNull();
    expect(result.current.ambientMotionEnabled).toBe(false);

    rerender({ ...baseOptions, messages: [agentMessage("m1")], hasWorkingReply: true });
    expect(result.current.mood).toBe("thinking");
    expect(result.current.ambientCue).toBeNull();

    rerender({ ...baseOptions, messages: [agentMessage("m1")], error: "boom" });
    expect(result.current.mood).toBe("error");
    expect(result.current.ambientCue).toBeNull();

    rerender({ ...baseOptions, messages: [agentMessage("m1")], reducedMotion: true });
    act(() => vi.advanceTimersByTime(AGENT_IDLE_CUE_GAP_MS * 2));
    expect(result.current.mood).toBe("idle");
    expect(result.current.caption).toContain("up to date");
    expect(result.current.ambientCue).toBeNull();
    expect(result.current.ambientMotionEnabled).toBe(false);
  });

  it("cleans up page-presence listeners and pending cue timers", () => {
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(() => useAgentMood({
      ...baseOptions,
      messages: [agentMessage("m1")],
    }));

    unmount();

    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("blur", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("pageshow", expect.any(Function));
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
