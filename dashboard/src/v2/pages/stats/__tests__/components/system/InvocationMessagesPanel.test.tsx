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
const writeText = vi.fn((_text: string): Promise<void> => Promise.resolve());

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText,
  },
});

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
  writeText.mockClear();
});

describe("InvocationMessagesPanel", () => {
  it("renders message metadata, truncates long transcripts, and expands the full list", async () => {
    mockedFetchInvocationMessages.mockResolvedValue([
      createMessage({ id: "msg-system", role: "system", contentMarkdown: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6" }),
      createMessage({ id: "msg-user", role: "user", contentMarkdown: "User request" }),
      createMessage({
        id: "msg-metadata",
        role: "assistant",
        contentMarkdown: "Assistant response",
        metadata: {
          kind: "completion",
          inputTokens: "12",
          outputTokens: 8,
          costCents: 4,
        },
      }),
      ...Array.from({ length: 18 }).map((_, index) => createMessage({
        id: `msg-${index + 4}`,
        role: index % 2 === 0 ? "assistant" : "tool",
        contentMarkdown: `Message ${index + 4}`,
        createdAt: `2026-06-01T10:00:${10 + index}.000Z`,
      })),
    ]);

    const { container } = render(<InvocationMessagesPanel invocation={createInvocation()} />);

    expect(screen.getByRole("region", { name: "Invocation inv-1 message transcript" }).getAttribute("aria-busy")).toBe("true");
    expect((container as HTMLElement).querySelector('[class*="backdrop-blur"]')).toBeNull();
    expect(screen.getByRole("status", { name: "Loading transcript messages" })).toBeTruthy();
    expect(screen.getByText("Fetching the recorded message list for this invocation.")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("gemini-2.0-flash")).toBeTruthy();
    });

    expect(screen.getByRole("region", { name: "Invocation inv-1 message transcript" }).getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("1m 0s")).toBeTruthy();
    expect(screen.getByText("120 tokens")).toBeTruthy();
    expect(screen.getByText("100 in / 20 out")).toBeTruthy();
    expect(screen.getByText("21")).toBeTruthy();
    expect(screen.getByText("completion")).toBeTruthy();
    expect(screen.getByText("12 in / 8 out")).toBeTruthy();
    expect(screen.getByText("$0.04")).toBeTruthy();
    expect(screen.getByText("system")).toBeTruthy();
    expect(screen.getByText("user")).toBeTruthy();
    expect(screen.queryByText("Message 21")).toBeNull();

    const systemContent = screen.getByText(/line 1/);
    expect(systemContent.getAttribute("style")).toContain("-webkit-line-clamp: 5");

    fireEvent.click(screen.getByRole("button", { name: /Show all 21 messages/i }));

    await waitFor(() => {
      expect(screen.getByText("Message 21")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Expand system message 1" }));
    expect(screen.getByRole("button", { name: "Collapse system message 1" })).toBeTruthy();
    expect(systemContent.getAttribute("style") || "").not.toContain("-webkit-line-clamp: 5");

    fireEvent.click(screen.getByRole("button", { name: "Copy as JSON" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"id\": \"msg-system\""));
    });
  });

  it("surfaces fetch errors", async () => {
    mockedFetchInvocationMessages.mockRejectedValue(new Error("network down"));

    render(<InvocationMessagesPanel invocation={createInvocation()} />);

    await waitFor(() => {
      const alert = screen.getByRole("alert", { name: "Transcript messages failed to load" });
      expect(alert.textContent).toContain("Failed to load invocation messages");
      expect(alert.textContent).toContain("network down");
    });
  });

  it("renders empty transcript and invocation error summary states", async () => {
    mockedFetchInvocationMessages.mockResolvedValue([]);

    render(<InvocationMessagesPanel invocation={createInvocation({ lastErrorMessage: "Provider failed\nwith quota error" })} />);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "No transcript messages" })).toBeTruthy();
    });

    expect(screen.getByText("No transcript messages recorded")).toBeTruthy();
    expect(screen.getByText("This invocation has no stored message records to inspect.")).toBeTruthy();
    expect(screen.getByText("Error Summary")).toBeTruthy();
    fireEvent.click(screen.getByText("Error Summary"));
    expect(screen.getByText(/Provider failed/).textContent).toContain("with quota error");
  });

  it("keeps long transcript model, error, metadata, and message content visible with wrapping-safe structure", async () => {
    const longModel = "gemini-provider/super-long-model-identifier-with-routing-suffix-and-context-window-2026-07-04";
    const longError = "Provider failed with a very long operational error that should remain visible inside the transcript error summary without requiring hover text.";
    const longContent = "Assistant message with a very long task and provider diagnostic string TASK-LONG-OPERATIONAL-IDENTIFIER-2026-07-04 provider_with_unusually_long_gateway_identifier model_route_suffix_alpha_beta_gamma.";

    mockedFetchInvocationMessages.mockResolvedValue([
      createMessage({
        id: "msg-long",
        role: "assistant",
        contentMarkdown: longContent,
        metadata: {
          kind: "completion-with-long-operational-label",
          totalTokens: "1200",
        },
      }),
    ]);

    const { container } = render(
      <InvocationMessagesPanel invocation={createInvocation({
        model: longModel,
        lastErrorMessage: longError,
      })} />,
    );

    await waitFor(() => {
      expect(screen.getByText(longModel)).toBeTruthy();
    });

    expect(screen.getByText(longError)).toBeTruthy();
    expect(screen.getByText(longContent)).toBeTruthy();
    expect(screen.getByText("completion-with-long-operational-label")).toBeTruthy();
    expect(screen.getByText("1.2k tokens")).toBeTruthy();

    const root = container as HTMLElement;
    const transcript = screen.getByRole("region", { name: "Invocation inv-1 message transcript" });
    const message = screen.getByRole("article", { name: "assistant message 1" });
    const content = screen.getByText(longContent);
    expect(root.querySelector('[class*="backdrop-blur"]')).toBeNull();
    expect(transcript.className).toContain("min-w-0");
    expect(transcript.className).toContain("max-w-full");
    expect(message.className).toContain("break-words");
    expect(message.className).toContain("[overflow-wrap:anywhere]");
    expect(content.className).toContain("whitespace-pre-wrap");
    expect(content.className).toContain("[overflow-wrap:anywhere]");
  });
});
