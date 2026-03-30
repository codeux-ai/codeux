import { describe, expect, it } from "vitest";
import type { ChatThread, ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";
import {
  isDetailLoading,
  isListLoading,
  resolveSelectedItemId,
} from "../../../dashboard/src/v2/lib/chat-page-state-utils.js";

const createThread = (id: string): ChatThread => ({
  id,
  projectId: "project-1",
  connectionId: null,
  scope: "project",
  title: `Thread ${id}`,
  status: "open",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
  messageCount: 0,
  pendingMessageCount: 0,
  lastMessageAt: null,
  lastMessagePreview: null,
});

const createInvocation = (id: string): ExecutionInvocationRecord => ({
  id,
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "planning",
  status: "completed",
  provider: "mock",
  model: "mock",
  systemPrompt: null,
  startedAt: "2026-03-10T12:00:00.000Z",
  finishedAt: "2026-03-10T12:05:00.000Z",
  errorMessage: null,
  messageCount: 0,
  lastMessageAt: null,
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
});

describe("chat-page-state-utils", () => {
  it("preserves the selected item when it still exists", () => {
    const threads = [createThread("thread-1"), createThread("thread-2")];
    expect(resolveSelectedItemId(threads, "thread-2")).toBe("thread-2");

    const invocations = [createInvocation("inv-1"), createInvocation("inv-2")];
    expect(resolveSelectedItemId(invocations, "inv-2")).toBe("inv-2");
  });

  it("falls back to the first item when the current selection is missing", () => {
    const threads = [createThread("thread-1"), createThread("thread-2")];
    expect(resolveSelectedItemId(threads, "thread-missing")).toBe("thread-1");
    expect(resolveSelectedItemId([], "thread-missing")).toBeNull();

    const invocations = [createInvocation("inv-1"), createInvocation("inv-2")];
    expect(resolveSelectedItemId(invocations, "inv-missing")).toBe("inv-1");
    expect(resolveSelectedItemId([], "inv-missing")).toBeNull();
  });

  it("treats list as loading until the selected project snapshot is loaded", () => {
    expect(isListLoading("project-1", false, false)).toBe(false);
    expect(isListLoading("project-1", false, true)).toBe(true);
    expect(isListLoading("project-1", true, true)).toBe(false);
  });

  it("treats detail as loading until the selected item snapshot is loaded", () => {
    expect(isDetailLoading("thread-1", false, false)).toBe(false);
    expect(isDetailLoading("thread-1", false, true)).toBe(true);
    expect(isDetailLoading("thread-1", true, true)).toBe(false);
  });
});
