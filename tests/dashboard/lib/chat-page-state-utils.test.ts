import { describe, expect, it } from "vitest";
import type { ChatThread } from "../../../dashboard/src/v2/types.js";
import {
  isThreadListLoading,
  isThreadMessagesLoading,
  resolveSelectedThreadId,
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

describe("chat-page-state-utils", () => {
  it("preserves the selected thread when it still exists", () => {
    const threads = [createThread("thread-1"), createThread("thread-2")];
    expect(resolveSelectedThreadId(threads, "thread-2")).toBe("thread-2");
  });

  it("falls back to the first thread when the current selection is missing", () => {
    const threads = [createThread("thread-1"), createThread("thread-2")];
    expect(resolveSelectedThreadId(threads, "thread-missing")).toBe("thread-1");
    expect(resolveSelectedThreadId([], "thread-missing")).toBeNull();
  });

  it("treats thread list as loading until the selected project snapshot is loaded", () => {
    expect(isThreadListLoading("project-1", false, false)).toBe(false);
    expect(isThreadListLoading("project-1", false, true)).toBe(true);
    expect(isThreadListLoading("project-1", true, true)).toBe(false);
  });

  it("treats messages as loading until the selected thread snapshot is loaded", () => {
    expect(isThreadMessagesLoading("thread-1", false, false)).toBe(false);
    expect(isThreadMessagesLoading("thread-1", false, true)).toBe(true);
    expect(isThreadMessagesLoading("thread-1", true, true)).toBe(false);
  });
});
