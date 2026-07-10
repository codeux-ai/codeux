/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
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
    (mockedFetchProjectInvocations as any).mockResolvedValue([
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
      expect(screen.getByText("System Operations")).toBeTruthy();
    });

    expect(container.querySelector('[class*="backdrop-blur"]')).toBeNull();
    expect(container.querySelector('[class*="shadow-"]')).toBeNull();
    expect(screen.getByRole("button", { name: /^All/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Errors/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^System Msgs/ })).toBeTruthy();
    expect(container.textContent).toContain("1.3k");
    expect(container.textContent).toContain("9m 0s");
    expect(container.textContent).toContain("Showing 2 of 2");
    expect(screen.getByText("Rate limited")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading transcript messages" })).toBeNull();

    expect(container.textContent).toContain("Sprint Overview");
    expect(container.textContent).toContain("Status Distribution");
    expect(container.textContent).toContain("Success Rate");
    expect(container.textContent).toContain("External API Activity");
    expect(container.textContent).toContain("Error Categories");
    expect(container.textContent).toContain("Filters");
    expect(container.textContent).toContain("Invocation Records");
    expect(container.textContent).toContain("Invocation Ledger");

    const sprintSection = screen.getByRole("region", { name: "Sprint State" });
    expect(within(sprintSection).getByText("Sprint Overview")).toBeTruthy();
    expect(within(sprintSection).getAllByText("Tasks").length).toBeGreaterThan(0);

    const healthSection = screen.getByRole("region", { name: "Health Snapshot" });
    expect(within(healthSection).getByText("Filtered")).toBeTruthy();
    expect(within(healthSection).getByText("0%")).toBeTruthy();
    expect(container.querySelector('[title="Running: 1"]')).toBeTruthy();
    expect(container.querySelector('[title="Failed: 1"]')).toBeTruthy();

    const externalApiSection = screen.getByRole("region", { name: "External API Activity" });
    expect(within(externalApiSection).getByText("Calls")).toBeTruthy();
    expect(within(externalApiSection).getByText("Other")).toBeTruthy();
    expect(within(externalApiSection).getByText("9m 0s")).toBeTruthy();

    const errorSection = screen.getByRole("region", { name: "Error Categories" });
    expect(within(errorSection).getByText("Failure Analysis")).toBeTruthy();
    expect(within(errorSection).getByText("Failures")).toBeTruthy();
    expect(within(errorSection).getByText("Rate Limit")).toBeTruthy();

    const recordsSection = screen.getByRole("region", { name: "Invocation Records" });
    expect(within(recordsSection).getByText("Available")).toBeTruthy();
    expect(within(recordsSection).getByLabelText("Available invocation records: 2")).toBeTruthy();
    expect(within(recordsSection).getByRole("group", { name: "Status filters" })).toBeTruthy();
    expect(within(recordsSection).getByRole("group", { name: "Purposes filters" })).toBeTruthy();
    expect(within(recordsSection).getByRole("group", { name: "Providers filters" })).toBeTruthy();
    expect(within(recordsSection).getByRole("group", { name: "Error Category filters" })).toBeTruthy();
    expect(within(recordsSection).getByRole("columnheader", { name: /Model/i })).toBeTruthy();
    expect(within(recordsSection).getByRole("columnheader", { name: /Expand/i })).toBeTruthy();

    const recordViewGroup = within(recordsSection).getByRole("group", { name: "Invocation record views" });
    const allRecordsButton = within(recordViewGroup).getByRole("button", { name: "All invocation records, 2 records" });
    const errorRecordsButton = within(recordViewGroup).getByRole("button", { name: "Errors invocation records, 1 record" });
    const systemRecordsButton = within(recordViewGroup).getByRole("button", { name: "System Msgs invocation records, 1 record" });
    expect(within(recordViewGroup).getByText("All")).toBeTruthy();
    expect(within(recordViewGroup).getByText("Errors")).toBeTruthy();
    expect(within(recordViewGroup).getByText("System Msgs")).toBeTruthy();
    expect(within(recordViewGroup).getByText("2")).toBeTruthy();
    expect(within(recordViewGroup).getAllByText("1")).toHaveLength(2);
    expect(allRecordsButton.getAttribute("aria-pressed")).toBe("true");
    expect(errorRecordsButton.getAttribute("aria-pressed")).toBe("false");
    expect(systemRecordsButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.keyDown(recordViewGroup, { key: "End" });

    await waitFor(() => {
      expect(systemRecordsButton.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
    });

    fireEvent.keyDown(recordViewGroup, { key: "Home" });

    await waitFor(() => {
      expect(allRecordsButton.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByText("Showing 2 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Errors/ }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
      expect(container.textContent).toContain("Rate limited");
    });

    fireEvent.click(screen.getByRole("button", { name: /^System Msgs/ }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
      expect(container.textContent).toContain("System Msgs");
    });

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));

    await waitFor(() => {
      expect(screen.getByText("Showing 2 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
    });

    expect(container.querySelectorAll("tbody > tr").length).toBe(1);
    expect(screen.queryByText("Rate limited")).toBeNull();
    expect(container.textContent).toContain("codex-1");

    fireEvent.click(screen.getAllByRole("button", { name: "Expand invocation inv-running" })[0]);

    expect(screen.getByRole("status", { name: "Loading transcript messages" })).toBeTruthy();
    expect(screen.getByText("Fetching the recorded message list for this invocation.")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("status", { name: "No transcript messages" })).toBeTruthy();
      expect(screen.getByText("No transcript messages recorded")).toBeTruthy();
    });
    expect(container.querySelectorAll("tbody > tr").length).toBe(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse invocation inv-running" })[0]);

    expect(screen.queryByRole("status", { name: "No transcript messages" })).toBeNull();
    expect(container.querySelectorAll("tbody > tr").length).toBe(1);
  });

  it("shows an error banner when invocation loading fails", async () => {
    mockedFetchProjectInvocations.mockRejectedValue(new Error("boom"));

    render(<SystemStudio projectId="project-1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert", { name: "Invocation load failed" })).toBeTruthy();
      expect(screen.getByText("Failed to load invocations")).toBeTruthy();
      expect(screen.getAllByText("boom").length).toBeGreaterThan(0);
    });
  });

  it("uses polite feedback states for reduced system summary data", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue([]);

    render(<SystemStudio projectId="project-1" />);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Invocation health reduced data" })).toBeTruthy();
    });

    expect(screen.getByText("Invocation health needs records")).toBeTruthy();
    expect(screen.getByRole("status", { name: "No external API activity" })).toBeTruthy();
    expect(screen.getByText("No external API activity classified")).toBeTruthy();
    expect(screen.getByRole("status", { name: "No error categories" })).toBeTruthy();
    expect(screen.getByText("No error categories classified")).toBeTruthy();
    expect(screen.getByRole("status", { name: "No invocation records" })).toBeTruthy();
  });
});
