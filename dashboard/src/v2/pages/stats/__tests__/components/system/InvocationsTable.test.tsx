/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import type { ExecutionInvocationRecord } from "../../../../../types.js";
import { fetchInvocationMessages } from "../../../../../lib/invocation-api.js";
import { InvocationsTable } from "../../../components/system/InvocationsTable.js";
import type { SystemSort } from "../../../hooks/use-system-view-data.js";

vi.mock("../../../../../lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(),
}));

const mockedFetchInvocationMessages = vi.mocked(fetchInvocationMessages);

function createInvocation(overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord {
  return {
    id: "inv-1",
    projectId: "proj-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sprintRunId: null,
    dispatchId: null,
    taskRunId: null,
    attentionItemId: null,
    providerInvocationId: null,
    type: "task_run",
    status: "completed",
    provider: "claude",
    model: "claude-sonnet-4",
    systemPrompt: null,
    startedAt: "2026-06-03T10:00:00.000Z",
    finishedAt: "2026-06-03T10:01:30.000Z",
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 3,
    lastMessageAt: "2026-06-03T10:01:20.000Z",
    invocationSource: "internal",
    agentPresetId: null,
    inputTokens: 1500,
    cachedInputTokens: 250,
    outputTokens: 500,
    totalTokens: 2250,
    sprintNumber: 4,
    sprintName: "Sprint 4",
    sprintSlug: "sprint-4",
    taskKey: "T-12",
    taskTitle: "Implement invocation table",
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:01:30.000Z",
    ...overrides,
  };
}

describe("InvocationsTable", () => {
  beforeEach(() => {
    mockedFetchInvocationMessages.mockReset();
  });

  it("renders formatted tokens, status colors, and context chips", () => {
    const invocations = [
      createInvocation({
        id: "inv-running",
        status: "running",
        provider: "jules",
        model: "jules-1",
        finishedAt: null,
        type: "planning_run",
        inputTokens: 1500,
        cachedInputTokens: 250,
        outputTokens: 500,
        totalTokens: 2250,
        sprintNumber: null,
        taskKey: null,
      }),
      createInvocation({
        id: "inv-failed",
        status: "failed",
        provider: "codex",
        errorMessage: "Primary failure",
        lastErrorMessage: "Latest failure",
        inputTokens: 4000,
        cachedInputTokens: 0,
        outputTokens: 2500,
        totalTokens: 6500,
      }),
    ];
    const sort = { key: "startedAt", dir: "desc" } satisfies SystemSort;

    const { container } = render(
      <InvocationsTable
        invocations={invocations}
        sort={sort}
        onSortChange={vi.fn()}
        expandedId={null}
        onRowExpand={vi.fn()}
      />,
    );
    const root = container as HTMLElement;

    const textContent = root.textContent ?? "";

    expect(textContent).toContain("1.5k");
    expect(textContent).toContain("250");
    expect(textContent).toContain("500");
    expect(textContent).toContain("2.3k");
    expect(textContent).toContain("4.0k");
    expect(textContent).toContain("2.5k");
    expect(textContent).toContain("6.5k");
    expect(textContent).toContain("S4");
    expect(textContent).toContain("T-12");
    expect(textContent).toContain("Latest failure");
    expect(textContent).toContain("running");

    const runningRow = within(root).getByText("running").closest("tr");
    expect(runningRow?.querySelector("div.text-blue-400")).toBeTruthy();
    const failedRow = within(root).getByText("Latest failure").closest("tr");
    expect(failedRow?.querySelector("div.text-red-400")).toBeTruthy();

    const modelCell = within(root).getByText("claude-sonnet-4");
    expect(within((modelCell.closest("td") as HTMLElement) ?? root).getByText("claude-sonnet-4")).toBeTruthy();
  });

  it("invokes sort changes with toggled and new directions", () => {
    const onSortChange = vi.fn();

    const { container } = render(
      <InvocationsTable
        invocations={[createInvocation()]}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={onSortChange}
        expandedId={null}
        onRowExpand={vi.fn()}
      />,
    );
    const root = container as HTMLElement;

    fireEvent.click(within(root).getByRole("button", { name: "Time" }));
    fireEvent.click(within(root).getByRole("button", { name: "In" }));

    expect(onSortChange).toHaveBeenNthCalledWith(1, { key: "startedAt", dir: "asc" });
    expect(onSortChange).toHaveBeenNthCalledWith(2, { key: "inputTokens", dir: "desc" });
  });

  it("renders the expansion placeholder row", async () => {
    const onRowExpand = vi.fn();
    mockedFetchInvocationMessages.mockResolvedValue([]);

    const { container } = render(
      <InvocationsTable
        invocations={[createInvocation({ id: "inv-expand" })]}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={vi.fn()}
        expandedId="inv-expand"
        onRowExpand={onRowExpand}
      />,
    );
    const root = container as HTMLElement;

    expect(within(root).getByText("Loading messages")).toBeTruthy();
    await waitFor(() => {
      expect(within(root).getByText("No messages recorded for this invocation")).toBeTruthy();
    });

    fireEvent.click(within(root).getByRole("button", { name: "Collapse invocation inv-expand" }));
    expect(onRowExpand).toHaveBeenCalledWith(null);
  });

  it("renders the empty state and loading skeletons", () => {
    const { rerender, container } = render(
      <InvocationsTable
        invocations={[]}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={vi.fn()}
        expandedId={null}
        onRowExpand={vi.fn()}
      />,
    );

    expect(screen.getByText("No invocations match the current filters")).toBeTruthy();

    rerender(
      <InvocationsTable
        invocations={[]}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={vi.fn()}
        expandedId={null}
        onRowExpand={vi.fn()}
        loading
      />,
    );

    expect(container.querySelectorAll(".animate-pulse").length).toBe(6);
  });
});
