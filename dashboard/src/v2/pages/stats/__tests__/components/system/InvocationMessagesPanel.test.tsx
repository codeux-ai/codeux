/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ExecutionInvocationMessageRecord, ExecutionInvocationRecord } from "../../../../../types.js";
import { fetchInvocationMessages } from "../../../../../lib/invocation-api.js";
import { InvocationMessagesPanel } from "../../../components/system/InvocationMessagesPanel.js";

vi.mock("../../../../../lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(),
}));

const mockedFetchInvocationMessages = vi.mocked(fetchInvocationMessages);

const createInvocation = (overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord => ({
  id: "inv-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "analysis",
  status: "completed",
  provider: "gemini",
  model: "gemini-2.0-flash",
  systemPrompt: null,
  startedAt: "2026-06-01T10:00:00.000Z",
  finishedAt: "2026-06-01T10:01:00.000Z",
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 21,
  lastMessageAt: "2026-06-01T10:01:00.000Z",
  invocationSource: "internal",
  agentPresetId: null,
  inputTokens: 100,
  cachedInputTokens: 0,
  outputTokens: 20,
  totalTokens: 120,
  sprintNumber: null,
  sprintName: null,
  sprintSlug: null,
  taskKey: null,
  taskTitle: "Inspect transcript",
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:01:00.000Z",
  ...overrides,
});

function createMessage(overrides: Partial<ExecutionInvocationMessageRecord> = {}): ExecutionInvocationMessageRecord {
  return {
    id: "msg-1",
    invocationId: "inv-1",
    role: "assistant",
    contentMarkdown: "Hello world",
    toolCallsJson: null,
    metadata: null,
    createdAt: "2026-06-01T10:00:10.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockedFetchInvocationMessages.mockReset();
});

describe("InvocationMessagesPanel", () => {
  it("renders message metadata, truncates long transcripts, and expands the full list", async () => {
    mockedFetchInvocationMessages.mockResolvedValue([
      createMessage({ id: "msg-system", role: "system", contentMarkdown: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6" }),
      createMessage({ id: "msg-user", role: "user", contentMarkdown: "User request" }),
      ...Array.from({ length: 19 }).map((_, index) => createMessage({
        id: `msg-${index + 3}`,
        role: index % 2 === 0 ? "assistant" : "tool",
        contentMarkdown: `Message ${index + 3}`,
        createdAt: `2026-06-01T10:00:${10 + index}.000Z`,
      })),
    ]);

    render(<InvocationMessagesPanel invocation={createInvocation()} />);

    expect(screen.getByText("Loading messages")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("gemini-2.0-flash")).toBeTruthy();
    });

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("1m 0s")).toBeTruthy();
    expect(screen.getByText("120 total tokens")).toBeTruthy();
    expect(screen.getByText("21 messages")).toBeTruthy();
    expect(screen.getByText("SYSTEM")).toBeTruthy();
    expect(screen.getByText("USER")).toBeTruthy();
    expect(screen.queryByText("Message 21")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show all 21 messages/i }));

    await waitFor(() => {
      expect(screen.getByText("Message 21")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("surfaces fetch errors", async () => {
    mockedFetchInvocationMessages.mockRejectedValue(new Error("network down"));

    render(<InvocationMessagesPanel invocation={createInvocation()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load invocation messages — network down")).toBeTruthy();
    });
  });
});
