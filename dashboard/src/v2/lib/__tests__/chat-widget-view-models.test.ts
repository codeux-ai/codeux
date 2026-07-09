import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "../../types.js";
import { getChatWidgetData } from "../chat-widget-view-models.js";

const createMessage = (metadata: ChatMessageRecord["metadata"]): ChatMessageRecord => ({
  id: "message-1",
  threadId: "thread-1",
  direction: "connection_to_dashboard",
  authorType: "connection",
  authorConnectionId: "connection-1",
  bodyMarkdown: "",
  deliveryStatus: "delivered",
  metadata,
  createdAt: "2026-07-09T12:00:00.000Z",
});

describe("chat widget view models", () => {
  it("infers Jira references from atlassian.net hosts", () => {
    const widget = getChatWidgetData(createMessage({
      externalReference: {
        title: "Restore release notes",
        key: "CUX-123",
        url: "https://team.atlassian.net/browse/CUX-123",
      },
    }));

    expect(widget.type).toBe("external_reference");
    expect(widget.externalReference?.provider).toBe("jira");
    expect(widget.externalReference?.url).toBe("https://team.atlassian.net/browse/CUX-123");
  });

  it("does not infer Jira from hosts that only contain atlassian.net", () => {
    const widget = getChatWidgetData(createMessage({
      externalReference: {
        title: "Spoofed Jira reference",
        key: "CUX-123",
        url: "https://team.atlassian.net.evil.example/browse/CUX-123",
      },
    }));

    expect(widget.type).toBe("none");
  });
});
