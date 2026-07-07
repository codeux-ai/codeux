import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../../../lib/api/fetch-json.js";
import { updateConversationThread } from "../connection-api.js";

vi.mock("../../../lib/api/fetch-json.js", () => ({
  fetchJson: vi.fn(),
}));

describe("connection-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("patches a conversation thread title without route fields", async () => {
    const updatedThread = {
      id: "thread-1",
      projectId: "project-1",
      connectionId: null,
      scope: "project",
      title: "Renamed Session",
      status: "open",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:01:00.000Z",
      messageCount: 1,
      pendingMessageCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    vi.mocked(fetchJson).mockResolvedValueOnce(updatedThread);

    const result = await updateConversationThread("thread-1", { title: "Renamed Session" });

    expect(result).toBe(updatedThread);
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/conversations/threads/thread-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed Session" }),
      },
    );
  });
});
