/**
 * @vitest-environment jsdom
 */
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInvocationMessages } from "../../../lib/invocation-api.js";
import { InvocationsTable } from "../components/system/InvocationsTable.js";
import type { SystemSort } from "../hooks/use-system-view-data.js";
import type { ExecutionInvocationRecord } from "../../../types.js";

vi.mock("../../../lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(),
}));

const mockedFetchInvocationMessages = vi.mocked(fetchInvocationMessages);

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockedFetchInvocationMessages.mockReset();
});

const mockInvocations: ExecutionInvocationRecord[] = [
  {
    id: "inv-1",
    status: "completed",
    type: "cli_task_coding",
    provider: "gemini",
    model: "gemini-1.5-pro",
    inputTokens: 100,
    outputTokens: 200,
    cachedInputTokens: 50,
    totalTokens: 350,
    startedAt: "2024-06-03T10:00:00Z",
    finishedAt: "2024-06-03T10:00:05Z",
    sprintNumber: 1,
    taskKey: "TASK-1",
    durationMs: 5000,
  } as any,
  {
    id: "inv-2",
    status: "failed",
    type: "planning",
    provider: "claude",
    model: "claude-3-sonnet",
    inputTokens: 150,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 150,
    startedAt: "2024-06-03T10:05:00Z",
    finishedAt: "2024-06-03T10:05:02Z",
    sprintNumber: null,
    taskKey: null,
    errorMessage: "Rate limited",
    durationMs: 2000,
  } as any,
];

function Harness({
  invocations = mockInvocations,
  loading = false,
}: {
  invocations?: ExecutionInvocationRecord[];
  loading?: boolean;
}) {
  const [sort, setSort] = useState<SystemSort>({ key: "startedAt", dir: "desc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <InvocationsTable
      invocations={invocations}
      sort={sort}
      onSortChange={setSort}
      expandedId={expandedId}
      onRowExpand={setExpandedId}
      loading={loading}
    />
  );
}

describe("InvocationsTable", () => {
  it("renders invocations correctly", () => {
    const { getByText, getAllByText } = render(<Harness />);

    expect(getByText("Completed")).toBeTruthy();
    expect(getByText("Failed")).toBeTruthy();
    expect(getByText("gemini-1.5-pro")).toBeTruthy();
    expect(getByText("claude-3-sonnet")).toBeTruthy();
    expect(getByText("350")).toBeTruthy(); // Total tokens for inv-1 (unique)
    expect(getAllByText("150").length).toBeGreaterThan(0); // input and total for inv-2
    expect(getByText("S1")).toBeTruthy();
    expect(getByText("TASK-1")).toBeTruthy();
    expect(getByText("Rate limited")).toBeTruthy();
  });

  it("handles sorting", () => {
    const onSortChange = vi.fn();
    const { getByRole } = render(
      <InvocationsTable
        invocations={mockInvocations}
        sort={{ key: "startedAt", dir: "desc" }}
        onSortChange={onSortChange}
        expandedId={null}
        onRowExpand={() => {}}
      />
    );

    const inHeader = getByRole("button", { name: "In" });
    fireEvent.click(inHeader);
    expect(onSortChange).toHaveBeenCalledWith({ key: "inputTokens", dir: "desc" });

    // Click again to toggle direction
    const timeHeader = getByRole("button", { name: "Time" });
    fireEvent.click(timeHeader);
    expect(onSortChange).toHaveBeenCalledWith({ key: "startedAt", dir: "asc" });
  });

  it("handles row expansion", async () => {
    mockedFetchInvocationMessages.mockResolvedValue([]);
    const { getByText, queryByText, getByRole } = render(<Harness />);

    // The first 5 buttons are sort headers in the thead
    const expandButton = getByRole("button", { name: "Expand details for invocation inv-1" });

    expect(expandButton.getAttribute("aria-expanded")).toBe("false");
    expect(expandButton.getAttribute("aria-controls")).toBe("invocation-panel-inv-1");

    fireEvent.click(expandButton);

    expect(expandButton.getAttribute("aria-expanded")).toBe("true");

    await waitFor(() => {
      expect(getByText("Loading messages")).toBeTruthy();
    });

    const panelRegion = getByRole("region", { name: "Message transcript" });
    expect(panelRegion).toBeTruthy();
    expect(panelRegion.getAttribute("id")).toBe("invocation-panel-inv-1");

    fireEvent.click(expandButton);
    await waitFor(() => {
      expect(queryByText("Loading messages")).toBeNull();
    });
  });

  it("renders loading skeleton", () => {
    const { container } = render(<Harness loading={true} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(6);
  });

  it("renders empty state", () => {
    const { getByText } = render(<Harness invocations={[]} />);
    expect(getByText("No invocations match the current filters")).toBeTruthy();
  });

  it("announces failed invocations with alert role", () => {
    const { getByRole, getByText } = render(<Harness />);
    const alertRegion = getByRole("alert");
    expect(alertRegion).toBeTruthy();
    expect(getByText("Error:")).toBeTruthy();
    expect(getByText("Rate limited")).toBeTruthy();
  });

  it("sets aria-sort on sortable headers", () => {
    const { getByRole } = render(<Harness />);
    const timeHeader = getByRole("columnheader", { name: /Time/i });
    expect(timeHeader.getAttribute("aria-sort")).toBe("descending");

    const inHeader = getByRole("columnheader", { name: /In/i });
    expect(inHeader.getAttribute("aria-sort")).toBe("none");
  });
});
