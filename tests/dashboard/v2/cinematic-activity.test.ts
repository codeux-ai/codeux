import { describe, expect, it } from "vitest";
import {
  classifyCinematicActivityPhase,
  resolveCinematicActivityDisplayState,
} from "../../../dashboard/src/v2/lib/cinematic-activity.js";
import type { ChatThread, ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";

const invocation = (overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord => ({
  id: "invocation-1",
  agentPresetId: "worker-agent",
  messageCount: 1,
  provider: "codex",
  providerInvocationId: "provider-run-1",
  startedAt: "2026-07-11T10:00:00.000Z",
  status: "running",
  type: "task_coding",
  ...overrides,
} as ExecutionInvocationRecord);

const selectedThread = {
  id: "thread-1",
  runtimeState: {
    providerLabel: "claude-code",
    sessionIds: ["session-1"],
  },
} as ChatThread;

const resolve = (overrides: Partial<Parameters<typeof resolveCinematicActivityDisplayState>[0]> = {}) => (
  resolveCinematicActivityDisplayState({
    agentId: "pm-agent",
    error: null,
    hasAwaitedReply: false,
    invocations: [],
    nowMs: 10_000,
    projectManagerAgentPresetId: "pm-agent",
    selectedThread,
    ...overrides,
  })
);

describe("cinematic activity", () => {
  it("classifies persisted invocation phases without inventing progress", () => {
    expect(classifyCinematicActivityPhase(invocation({ providerInvocationId: null }))).toBe("container_startup");
    expect(classifyCinematicActivityPhase(invocation({ messageCount: 0 }))).toBe("container_startup");
    expect(classifyCinematicActivityPhase(invocation())).toBe("provider_work");
    expect(classifyCinematicActivityPhase(invocation({ type: "planning" }))).toBe("planning");
    expect(classifyCinematicActivityPhase(invocation({ type: "qa_review" }))).toBe("qa_handoff");
    expect(classifyCinematicActivityPhase(invocation({ status: "completed" }))).toBe("completion");
    expect(classifyCinematicActivityPhase(invocation({ status: "failed" }))).toBe("error");
    expect(classifyCinematicActivityPhase(invocation({ status: "paused" }))).toBeNull();
  });

  it("keeps unrelated running work in a visible background cue", () => {
    const state = resolve({ invocations: [invocation()] });

    expect(state.projectManagerActive).toBe(false);
    expect(state.foregroundCue).toBeNull();
    expect(state.backgroundActivityCount).toBe(1);
    expect(state.backgroundCue).toMatchObject({
      label: "Provider running",
      phase: "provider_work",
      providerLabel: "Codex",
    });
  });

  it("gives active Project Manager work precedence without hiding background activity", () => {
    const state = resolve({
      invocations: [
        invocation({ id: "background", startedAt: "2026-07-11T10:01:00.000Z" }),
        invocation({
          agentPresetId: "pm-agent",
          id: "foreground",
          provider: "gemini-cli",
          type: "dashboard_reply",
        }),
      ],
    });

    expect(state.projectManagerActive).toBe(true);
    expect(state.foregroundCue).toMatchObject({ phase: "provider_work", providerLabel: "Gemini Cli" });
    expect(state.backgroundActivityCount).toBe(1);
    expect(state.backgroundCue?.id).toBe("background");
  });

  it("resolves selected-thread startup and provider work from known runtime fields", () => {
    expect(resolve({ hasAwaitedReply: true, selectedThread: null }).foregroundCue?.phase).toBe("container_startup");
    expect(resolve({ hasAwaitedReply: true }).foregroundCue).toMatchObject({
      phase: "provider_work",
      providerLabel: "Claude Code",
    });
  });

  it("keeps provider and phase copy stable throughout a five-second cycle", () => {
    const first = resolve({ invocations: [invocation()], nowMs: 10_000 }).backgroundCue;
    const rerendered = resolve({ invocations: [invocation()], nowMs: 14_999 }).backgroundCue;

    expect(rerendered?.quote).toBe(first?.quote);
    expect(rerendered?.providerLabel).toBe("Codex");
    expect(rerendered?.phase).toBe("provider_work");
  });

  it("labels a current stage error without claiming completion", () => {
    const state = resolve({ error: "Provider disconnected", hasAwaitedReply: true });

    expect(state.foregroundCue).toMatchObject({
      label: "Runtime needs attention",
      phase: "error",
      tone: "error",
    });
    expect(state.foregroundCue?.quote).not.toMatch(/completed/i);
  });
});
