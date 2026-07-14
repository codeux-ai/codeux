import { describe, expect, it } from "vitest";
import {
  countUniqueCinematicToolCalls,
  projectCinematicInvocationFeedback,
  selectCinematicFeedbackInvocation,
  selectLatestCinematicAssistantMessage,
} from "../../../dashboard/src/v2/lib/cinematic-invocation-feedback.js";
import type {
  ExecutionInvocationMessageRecord,
  ExecutionInvocationRecord,
} from "../../../dashboard/src/v2/types.js";

const invocation = (
  overrides: Partial<ExecutionInvocationRecord> = {},
): ExecutionInvocationRecord => ({
  id: "invocation-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: "provider-1",
  type: "dashboard_reply",
  status: "running",
  provider: "codex",
  model: "test-model",
  systemPrompt: null,
  startedAt: "2026-07-13T10:00:00.000Z",
  finishedAt: null,
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 0,
  lastMessageAt: null,
  invocationSource: "internal",
  agentPresetId: "pm-agent",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
  ...overrides,
});

const message = (
  overrides: Partial<ExecutionInvocationMessageRecord> = {},
): ExecutionInvocationMessageRecord => ({
  id: "message-1",
  invocationId: "invocation-1",
  role: "assistant",
  contentMarkdown: "Interim response",
  toolCallsJson: null,
  metadata: null,
  createdAt: "2026-07-13T10:00:00.000Z",
  ...overrides,
});

describe("cinematic invocation feedback", () => {
  it("selects the latest matching running reply with deterministic id precedence", () => {
    const latestByTime = invocation({
      id: "reply-latest-time",
      startedAt: "2026-07-13T10:01:00.000Z",
      type: "worker_reply",
    });
    const latestById = invocation({
      id: "reply-z",
      startedAt: latestByTime.startedAt,
    });

    expect(selectCinematicFeedbackInvocation([
      latestById,
      invocation({ id: "completed", status: "completed", startedAt: "2026-07-13T11:00:00.000Z" }),
      invocation({ id: "wrong-agent", agentPresetId: "worker-agent", startedAt: "2026-07-13T12:00:00.000Z" }),
      invocation({ id: "wrong-type", type: "task_coding", startedAt: "2026-07-13T13:00:00.000Z" }),
      latestByTime,
    ], "pm-agent")?.id).toBe("reply-z");

    expect(selectCinematicFeedbackInvocation([invocation()], null)).toBeNull();
    expect(selectCinematicFeedbackInvocation([
      invocation({ status: "failed" }),
      invocation({ type: "planning" }),
    ], "pm-agent")).toBeNull();
  });

  it("returns no prose or tools for an empty transcript", () => {
    expect(projectCinematicInvocationFeedback([])).toEqual({
      message: null,
      toolCount: 0,
    });
  });

  it("selects only the latest non-empty normalized assistant prose", () => {
    const messages = [
      message({ id: "assistant-old", contentMarkdown: " Earlier answer ", createdAt: "2026-07-13T10:01:00.000Z" }),
      message({ id: "assistant-empty", contentMarkdown: "  ", createdAt: "2026-07-13T10:09:00.000Z" }),
      message({ id: "reasoning", contentMarkdown: "Private chain", metadata: { kind: "reasoning" }, createdAt: "2026-07-13T10:10:00.000Z" }),
      message({ id: "context", role: "system", contentMarkdown: "Injected secret", metadata: { kind: "injected_context" }, createdAt: "2026-07-13T10:11:00.000Z" }),
      message({ id: "tool-call", role: "tool", contentMarkdown: "Raw arguments", metadata: { kind: "tool_call" }, createdAt: "2026-07-13T10:12:00.000Z" }),
      message({ id: "tool-result", role: "tool", contentMarkdown: "Raw output", metadata: { kind: "tool_result" }, createdAt: "2026-07-13T10:13:00.000Z" }),
      message({ id: "user", role: "user", contentMarkdown: "Raw prompt", createdAt: "2026-07-13T10:14:00.000Z" }),
      message({ id: "assistant-kind", contentMarkdown: " Current safe answer ", metadata: { kind: "assistant" }, createdAt: "2026-07-13T10:08:00.000Z" }),
      message({ id: "unknown-internal", contentMarkdown: "Unknown internal data", metadata: { kind: "provider_debug" }, createdAt: "2026-07-13T10:15:00.000Z" }),
    ];

    expect(selectLatestCinematicAssistantMessage(messages)).toBe("Current safe answer");
  });

  it("counts logical tool calls once across pairs and repeated message records", () => {
    const messages = [
      message({ id: "call-1", role: "tool", metadata: { kind: "tool_call", toolCallId: "tool-a" } }),
      message({ id: "result-1", role: "tool", metadata: { kind: "tool_result", toolCallId: "tool-a" } }),
      message({ id: "call-2", role: "tool", metadata: { kind: "tool_call", toolCallId: "tool-b" } }),
      message({ id: "call-without-id", role: "tool", metadata: { kind: "tool_call" } }),
      message({ id: "call-without-id", role: "tool", metadata: { kind: "tool_call" } }),
      message({ id: "plain-tool-role", role: "tool", metadata: null }),
      message({ id: "assistant", metadata: { toolCallId: "not-a-tool-turn" } }),
    ];

    expect(countUniqueCinematicToolCalls(messages)).toBe(3);
  });
});
