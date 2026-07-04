/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
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

  afterEach(() => {
    cleanup();
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
    expect(runningRow?.textContent).toContain("running");
    const failedRow = within(root).getByText("Latest failure").closest("tr");
    expect(failedRow?.textContent).toContain("Latest failure");

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

    fireEvent.click(within(root).getByRole("button", { name: /currently sorted descending/i }));
    fireEvent.click(within(root).getByRole("button", { name: /input tokens/i }));

    expect(onSortChange).toHaveBeenNthCalledWith(1, { key: "startedAt", dir: "asc" });
    expect(onSortChange).toHaveBeenNthCalledWith(2, { key: "inputTokens", dir: "desc" });
  });

  it("preserves semantic invocation table headers and row expand labels", () => {
    render(
      <InvocationsTable
        invocations={[createInvocation({ id: "inv-headers" })]}
        sort={{ key: "totalTokens", dir: "desc" }}
        onSortChange={vi.fn()}
        expandedId={null}
        onRowExpand={vi.fn()}
      />,
    );

    for (const header of ["Time", "Status", "Type", "Model", "In", "Out", "Cached", "Total", "Avg Duration", "Context", "Expand"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(header) })).toBeTruthy();
    }

    expect(screen.getByText(/Invocation ledger with sortable time/i)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Total/i }).getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByRole("button", { name: /Sort invocations by total tokens, currently sorted descending/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Expand invocation inv-headers" }).length).toBeGreaterThan(0);
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

    expect(within(root).getByRole("status", { name: "Loading transcript messages" })).toBeTruthy();
    await waitFor(() => {
      expect(within(root).getByRole("status", { name: "No transcript messages" })).toBeTruthy();
    });

    fireEvent.click(within(root).getAllByRole("button", { name: "Collapse invocation inv-expand" })[0]);
    expect(onRowExpand).toHaveBeenCalledWith(null);
  });

  it("renders the empty state and loading skeletons with polite status semantics", () => {
    const { rerender } = render(
      <InvocationsTable
        invocations={[]}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={vi.fn()}
        expandedId={null}
        onRowExpand={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "No invocation records" })).toBeTruthy();
    expect(screen.getByText("No invocation records to show")).toBeTruthy();
    expect(screen.getByText("No records match the current filters or record view.")).toBeTruthy();

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
    expect(screen.getByRole("status", { name: "Loading invocation records" })).toBeTruthy();
    expect(screen.getByText("Loading invocation records")).toBeTruthy();
    expect(screen.getByText("Refreshing the ledger rows and transcript expansion targets.")).toBeTruthy();
  });

  it("renders blocking load failures as named alerts", () => {
    render(
      <InvocationsTable
        invocations={[]}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={vi.fn()}
        expandedId={null}
        onRowExpand={vi.fn()}
        error="network down"
      />,
    );

    expect(screen.getByRole("alert", { name: "Invocation records failed to load" })).toBeTruthy();
    expect(screen.getByText("Failed to load invocation records")).toBeTruthy();
    expect(screen.getByText("network down")).toBeTruthy();
  });
});
