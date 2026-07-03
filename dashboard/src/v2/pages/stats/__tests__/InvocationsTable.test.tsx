/**
 * @vitest-environment jsdom
 */
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { fetchInvocationMessages } from "../../../lib/invocation-api.js";
import { InvocationsTable } from "../components/system/InvocationsTable.js";
import type { SystemSort } from "../hooks/use-system-view-data.js";
import type { ExecutionInvocationRecord } from "../../../types.js";

vi.mock("../../../lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(),
}));

const mockedFetchInvocationMessages = vi.mocked(fetchInvocationMessages);

expect.extend(matchers);

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
  error = null,
}: {
  invocations?: ExecutionInvocationRecord[];
  loading?: boolean;
  error?: string | null;
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
      error={error}
    />
  );
}

const longInvocations = Array.from({ length: 40 }).map((_, i) => ({
  ...mockInvocations[0],
  id: `inv-long-${i}`,
  sprintNumber: null,
  taskKey: null,
}));

function LongHarness() {
  const [sort, setSort] = useState<SystemSort>({ key: "startedAt", dir: "desc" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <InvocationsTable
      invocations={longInvocations}
      sort={sort}
      onSortChange={setSort}
      expandedId={expandedId}
      onRowExpand={setExpandedId}
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

    const headers = document.querySelectorAll("th[scope='col']");
    expect(headers.length).toBeGreaterThan(0);
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

    const inHeader = getByRole("button", { name: "Sort invocations by input tokens" });
    fireEvent.click(inHeader);
    expect(onSortChange).toHaveBeenCalledWith({ key: "inputTokens", dir: "desc" });

    // Click again to toggle direction
    const timeHeader = getByRole("button", { name: "Sort invocations by time, currently sorted descending" });
    fireEvent.click(timeHeader);
    expect(onSortChange).toHaveBeenCalledWith({ key: "startedAt", dir: "asc" });
  });

  it("provides a caption and active aria-sort state", () => {
    render(<Harness />);

    expect(screen.getByText(/Invocation ledger with sortable time/i)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Time/i })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /In/i })).not.toHaveAttribute("aria-sort");
  });

  it("handles row expansion and renders transcript details", async () => {
    mockedFetchInvocationMessages.mockResolvedValue([
      {
        id: "msg-1",
        invocationId: "inv-1",
        role: "assistant",
        contentMarkdown: "Telemetry summary ready.",
        ordinal: 1,
        createdAt: "2024-06-03T10:00:05Z",
      } as any,
    ]);
    const { getByText, queryByText, getAllByRole } = render(<Harness />);

    const expandButton = getAllByRole("button", { name: "Expand invocation inv-1" })[0];
    fireEvent.click(expandButton);
    expect(expandButton).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(getByText("Loading messages")).toBeTruthy();
    });
    await waitFor(() => {
      expect(getByText("Telemetry summary ready.")).toBeTruthy();
    });

    fireEvent.click(expandButton);
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(queryByText("Loading messages")).toBeNull();
    });
    expect(queryByText("Telemetry summary ready.")).toBeNull();
  });

  it("initially limits rows and reveals more", () => {
    const { queryAllByText, getByRole, queryByRole } = render(<LongHarness />);

    // initial window is 20, so we should see 20 instances of gemini-1.5-pro
    expect(queryAllByText("gemini-1.5-pro").length).toBe(20);

    const revealBtn = getByRole("button", { name: "Show more invocations" });
    fireEvent.click(revealBtn);

    expect(queryAllByText("gemini-1.5-pro").length).toBe(40);
    expect(queryByRole("button", { name: "Show more invocations" })).toBeNull();
  });

  it("preserves expanded invocation even if outside initial window", () => {
    mockedFetchInvocationMessages.mockResolvedValue([]);
    // Pass an expanded ID that is at the very end of the list (index 39)
    const { queryAllByText, getByRole } = render(
      <InvocationsTable invocations={longInvocations} sort={{ key: "startedAt", dir: "desc" }} onSortChange={vi.fn()} expandedId="inv-long-39" onRowExpand={vi.fn()} />
    );
    expect(queryAllByText("gemini-1.5-pro").length).toBeGreaterThan(20);
  });

  it("renders loading skeleton", () => {
    const { container } = render(<Harness loading={true} />);
    expect(container.querySelectorAll(".motion-safe\\:animate-pulse").length).toBe(6);
  });

  it("renders empty state", () => {
    const { getByText } = render(<Harness invocations={[]} />);
    expect(getByText("No invocations match the current filters")).toBeTruthy();
  });

  it("renders error state", () => {
    const { getByRole, getByText } = render(<Harness error="network offline" />);
    expect(getByRole("alert")).toBeTruthy();
    expect(getByText("Failed to load invocation records")).toBeTruthy();
    expect(getByText("network offline")).toBeTruthy();
  });
});
