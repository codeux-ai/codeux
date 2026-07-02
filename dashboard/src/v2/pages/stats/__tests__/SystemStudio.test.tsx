/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ExecutionInvocationRecord } from "../../../types.js";
import type { ProjectInvocationsQueryResult } from "../../../types.js";
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
    const serverResponse: ProjectInvocationsQueryResult = {
      items: [
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
        createInvocation({
          id: "inv-system",
          status: "completed",
          provider: "gemini",
          type: "system_message",
          model: "gemini-2.0-flash",
          totalTokens: 220,
          inputTokens: 120,
          outputTokens: 60,
          taskTitle: "System diagnostics",
        }),
      ],
      totalCount: 42,
      summary: {
        totalInvocations: 42,
        runningCount: 1,
        failedCount: 1,
        completedCount: 40,
        cancelledCount: 0,
        pausedCount: 0,
        totalTokens: 2670,
        totalInputTokens: 1220,
        totalOutputTokens: 1060,
        totalCachedTokens: 150,
        avgDurationMs: 90000,
        p95DurationMs: 120000,
        externalApiMetrics: {
          git: { calls: 0, avgDurationMs: 0 },
          jules: { calls: 0, avgDurationMs: 0 },
          jira: { calls: 0, avgDurationMs: 0 },
          other: { calls: 0, avgDurationMs: 0 },
        },
        sprintStateSummary: {
          totalSprints: 0,
          activeSprints: 0,
          completedSprints: 0,
          failedSprints: 0,
          totalTasks: 0,
          runningTasks: 0,
          blockedTasks: 0,
        },
        errorsByCategory: { timeout: 0, rateLimit: 1, apiError: 0, modelError: 0, cancelled: 0, other: 0 },
      },
      availablePurposes: ["analysis", "deployment", "system_message"],
      availableProviders: ["codex", "gemini"],
    };
    mockedFetchProjectInvocations.mockResolvedValue(serverResponse);

    const { container } = render(<SystemStudio projectId="project-1" />);

    await waitFor(() => {
      expect(screen.getByText("Invocations & System Logs")).toBeTruthy();
    });

    expect(screen.getByRole("tab", { name: /^All/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Errors/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^System Msgs/ })).toBeTruthy();
    expect(container.textContent).toContain("Showing 3 of 42");
    expect(screen.getByText("Rate limited")).toBeTruthy();
    expect(screen.queryByText("Loading messages")).toBeNull();

    expect(container.textContent).toContain("Sprint Overview");
    expect(container.textContent).toContain("Status Distribution");
    expect(container.textContent).toContain("Success Rate");
    expect(container.textContent).toContain("External API Metrics");
    expect(container.textContent).toContain("Invocation Ledger");

    fireEvent.click(screen.getByRole("tab", { name: /^Errors/ }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1 of 42")).toBeTruthy();
      expect(container.textContent).toContain("Rate limited");
    });

    fireEvent.click(screen.getByRole("tab", { name: /^System Msgs/ }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1 of 42")).toBeTruthy();
      expect(container.textContent).toContain("System Msgs");
    });

    fireEvent.click(screen.getByRole("tab", { name: /^All/ }));

    await waitFor(() => {
      expect(screen.getByText("Showing 3 of 42")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1 of 42")).toBeTruthy();
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
