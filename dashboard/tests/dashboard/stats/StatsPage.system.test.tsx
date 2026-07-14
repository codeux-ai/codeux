/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SystemStudio } from "../../../src/v2/pages/stats/components/system/SystemStudio.js";
import { SystemFilterBar } from "../../../src/v2/pages/stats/components/system/SystemFilterBar.js";
import type { SystemFilters } from "../../../src/v2/pages/stats/hooks/use-system-view-data.js";
import { useSystemViewData } from "../../../src/v2/pages/stats/hooks/use-system-view-data.js";

expect.extend(matchers);

vi.mock("../../../src/v2/pages/stats/hooks/use-system-view-data.js", () => ({
  useSystemViewData: vi.fn(),
}));

const mockedUseSystemViewData = vi.mocked(useSystemViewData);

afterEach(() => {
  cleanup();
  mockedUseSystemViewData.mockReset();
});

function createInvocation(overrides: Record<string, unknown>) {
  return {
    id: "inv-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
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
    sprintNumber: 1,
    sprintName: "Sprint 1",
    sprintSlug: "sprint-1",
    taskKey: "T-1",
    taskTitle: "Refine telemetry aggregation",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:09:00.000Z",
    ...overrides,
  };
}

describe("SystemStudio and filters", () => {
  it("renders the system tabs, summary, and invocation table basics", () => {
    mockedUseSystemViewData.mockReturnValue({
      invocations: [
        createInvocation({
          id: "inv-failed",
          status: "failed",
          provider: "gemini",
          type: "analysis",
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
          provider: "claude-code",
          type: "system_message",
          model: "claude-3.5-sonnet",
          totalTokens: 620,
          inputTokens: 260,
          outputTokens: 180,
        }),
      ],
      summaryMetrics: {
        totalInvocations: 3,
        runningCount: 1,
        failedCount: 1,
        completedCount: 2,
        cancelledCount: 0,
        pausedCount: 0,
        errorRate: 1 / 3,
        successRate: 2 / 3,
        totalTokens: 3070,
        totalInputTokens: 1360,
        totalOutputTokens: 1180,
        totalCachedTokens: 50,
        cacheHitRate: 50 / 1410,
        avgDurationMs: 540000,
        p95DurationMs: 540000,
      },
      availablePurposes: ["analysis", "deployment"],
      availableProviders: ["gemini", "codex", "claude-code"],
      filters: { status: [], purpose: [], provider: [], errorCategories: [] },
      setFilters: vi.fn(),
      search: "",
      setSearch: vi.fn(),
      sort: { key: "startedAt", dir: "desc" },
      setSort: vi.fn(),
      loading: false,
      error: null,
      refetch: vi.fn(),
      externalApiMetrics: {
        git: { calls: 1, avgDurationMs: 2400 },
        jules: { calls: 0, avgDurationMs: 0 },
        jira: { calls: 0, avgDurationMs: 0 },
        other: { calls: 0, avgDurationMs: 0 },
      },
      sprintStateSummary: {
        totalSprints: 1,
        activeSprints: 1,
        completedSprints: 0,
        failedSprints: 0,
        totalTasks: 1,
        runningTasks: 1,
        blockedTasks: 0,
      },
      errorsByCategory: {
        timeout: 0,
        rateLimit: 1,
        apiError: 0,
        modelError: 0,
        cancelled: 0,
        other: 0,
      },
      page: 0,
      setPage: vi.fn(),
      hasMore: false,
      totalCount: 3,
    } as any);

    render(<SystemStudio projectId="project-1" />);

    expect(screen.getByText("System Operations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^All/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Errors/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^System Msgs/ })).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.getByText("Sprint Overview")).toBeInTheDocument();
    expect(screen.getAllByText("Invocation Records").length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Search system stats")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Time/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Total/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Errors/ }));
    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.queryByText("system message")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^System Msgs/ }));
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("system_message")).toBeInTheDocument();
  });

  it("keeps the controlled system filter bar interactive", () => {
    function Harness() {
      const [filters, setFilters] = useState<SystemFilters>({
        status: [],
        purpose: [],
        provider: [],
        errorCategories: [],
      });
      const [search, setSearch] = useState("");

      return (
        <SystemFilterBar
          filters={filters}
          onFiltersChange={setFilters}
          search={search}
          onSearchChange={setSearch}
          availablePurposes={["analysis", "deployment"]}
          availableProviders={["gemini", "codex"]}
          totalCount={12}
          filteredCount={3}
          page={0}
          onPageChange={vi.fn()}
          hasMore={true}
        />
      );
    }

    render(<Harness />);

    const runningButton = screen.getByRole("button", { name: "Running" });
    expect(runningButton).not.toHaveAttribute("aria-pressed", "true");

    fireEvent.click(runningButton);
    expect(runningButton).toHaveAttribute("aria-pressed", "true");

    const searchInput = screen.getByPlaceholderText("Search system stats") as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: "beta" } });
    expect(searchInput.value).toBe("beta");

    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(searchInput.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(runningButton).not.toHaveAttribute("aria-pressed", "true");
  });
});
