/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { fetchInvocationMessages, fetchProjectInvocations } from "../../../lib/invocation-api.js";
import { SystemStudio } from "../components/system/SystemStudio.js";

vi.mock("../../../lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(),
  fetchInvocationMessages: vi.fn(),
}));

const mockedFetchProjectInvocations = vi.mocked(fetchProjectInvocations);
const mockedFetchInvocationMessages = vi.mocked(fetchInvocationMessages);

afterEach(() => {
  cleanup();
  mockedFetchProjectInvocations.mockReset();
  mockedFetchInvocationMessages.mockReset();
});

function createInvocation(overrides: Partial<ExecutionInvocationRecord>): ExecutionInvocationRecord {
  return {
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
    finishedAt: "2026-06-01T10:09:00.000Z",
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 2,
    lastMessageAt: "2026-06-01T10:09:00.000Z",
    invocationSource: "internal",
    agentPresetId: null,
    inputTokens: 400,
    cachedInputTokens: 50,
    outputTokens: 300,
    totalTokens: 750,
    sprintNumber: null,
    sprintName: null,
    sprintSlug: null,
    taskKey: null,
    taskTitle: "Refine telemetry aggregation",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:09:00.000Z",
    ...overrides,
  } as ExecutionInvocationRecord;
}

describe("SystemStudio", () => {
  it("renders telemetry, responds to filtering, and toggles row expansion", async () => {
    mockedFetchInvocationMessages.mockResolvedValue([]);
    mockedFetchProjectInvocations.mockResolvedValue([
      createInvocation({
        id: "inv-failed",
        status: "failed",
        provider: "gemini",
        type: "analysis",
        model: "gemini-2.0-flash",
        errorMessage: "Rate limited",
        lastErrorMessage: "Rate limited",
        totalTokens: 1200,
        inputTokens: 500,
        outputTokens: 550,
      }),
      createInvocation({
        id: "inv-running",
        status: "running",
        provider: "codex",
        type: "deployment",
        model: "codex-1",
        finishedAt: null,
        lastMessageAt: null,
        totalTokens: 1250,
        inputTokens: 600,
        outputTokens: 450,
      }),
    ]);

    const { container } = render(<SystemStudio projectId="project-1" />);

    await waitFor(() => {
      expect(screen.getByText("Invocations & System Logs")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Errors" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System Msgs" })).toBeTruthy();
    expect(container.textContent).toContain("1.3k");
    expect(container.textContent).toContain("9m 0s");
    expect(container.textContent).toContain("2 of 2");
    expect(screen.getByText("Rate limited")).toBeTruthy();
    expect(screen.queryByText("Loading messages")).toBeNull();

    expect(container.querySelectorAll(".text-red-600").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".text-blue-600").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Sprint Overview");
    expect(container.textContent).toContain("Status Distribution");
    expect(container.textContent).toContain("Success Rate");
    expect(container.textContent).toContain("Error Log");
    expect(container.textContent).toContain("Detailed Log");

    fireEvent.click(screen.getByRole("button", { name: "Errors" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "System Msgs" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    await waitFor(() => {
      expect(screen.getByText("2 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 2")).toBeTruthy();
    });

    expect(container.querySelectorAll("tbody > tr").length).toBe(1);
    expect(screen.queryByText("Rate limited")).toBeNull();
    expect(screen.getByText("codex-1")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Expand invocation inv-running" })[0]);

    expect(screen.getByText("Loading messages")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("No messages recorded for this invocation")).toBeTruthy();
    });
    expect(container.querySelectorAll("tbody > tr").length).toBe(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse invocation inv-running" })[0]);

    expect(screen.queryByText("No messages recorded for this invocation")).toBeNull();
    expect(container.querySelectorAll("tbody > tr").length).toBe(1);
  });

  it("shows an error banner when invocation loading fails", async () => {
    mockedFetchProjectInvocations.mockRejectedValue(new Error("boom"));

    render(<SystemStudio projectId="project-1" />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load invocations — boom")).toBeTruthy();
    });
  });
});
