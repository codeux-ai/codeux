/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { cleanup, render, screen, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, expect, describe, it } from "vitest";
import { TelemetryLedgerTabs } from "../../../dashboard/src/v2/pages/stats/components/TelemetryLedgerTabs.js";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../../dashboard/src/v2/components/ui/Table.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const mockStats = {
  tasks: [
    {
      id: "task-1",
      label: "Task 1",
      secondaryLabel: null,
      status: "COMPLETED",
      provider: "mock-provider",
      purpose: "test",
      lastActivityAt: new Date().toISOString(),
      usage: {
        totalTokens: 100,
        activeTimeMs: 1000,
        invocationCount: 1,
        inputTokens: 50,
        outputTokens: 50,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
      },
    },
  ],
  sprints: [
    {
      id: "sprint-1",
      label: "Sprint 1",
      secondaryLabel: null,
      status: "COMPLETED",
      provider: "mock-provider",
      purpose: "test",
      lastActivityAt: new Date().toISOString(),
      usage: {
        totalTokens: 200,
        activeTimeMs: 2000,
        invocationCount: 2,
        inputTokens: 100,
        outputTokens: 100,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
      },
    },
  ],
};

describe("TelemetryLedgerTabs", () => {
  it("renders Task Telemetry by default and switches to Sprint Telemetry", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    // Assert "Task Telemetry" ledger is visible by default
    expect(screen.getByText("Task Ledger")).toBeInTheDocument();
    expect(screen.queryByText("Sprint Ledger")).not.toBeInTheDocument();
    expect(screen.getAllByText("Task 1").length).toBeGreaterThan(0);

    // Click on Sprint Telemetry tab
    fireEvent.click(screen.getByText("Sprint Telemetry"));

    // Assert "Task Telemetry" ledger is hidden and "Sprint Telemetry" ledger is visible
    expect(screen.queryByText("Task Ledger")).not.toBeInTheDocument();
    expect(screen.getByText("Sprint Ledger")).toBeInTheDocument();
    expect(screen.getAllByText("Sprint 1").length).toBeGreaterThan(0);
  });

  it("uses tab semantics and arrow keys to move through telemetry ledgers", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    const tablist = screen.getByRole("tablist", { name: "Telemetry ledgers" });
    const taskTab = screen.getByRole("tab", { name: "Task Telemetry, 1 entry" });
    const sprintTab = screen.getByRole("tab", { name: "Sprint Telemetry, 1 entry" });

    expect(taskTab).toHaveAttribute("aria-selected", "true");
    expect(sprintTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Task Telemetry, 1 entry" })).toHaveAttribute("aria-labelledby", "tab-tasks");
    expect(screen.getByText("Task Telemetry selected, 1 entry.")).toBeInTheDocument();

    taskTab.focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });

    expect(sprintTab).toHaveFocus();
    expect(sprintTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Sprint Telemetry, 1 entry" })).toHaveAttribute("aria-labelledby", "tab-sprints");
    expect(screen.getByText("Sprint Telemetry selected, 1 entry.")).toBeInTheDocument();

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(taskTab).toHaveFocus();
    expect(taskTab).toHaveAttribute("aria-selected", "true");
  });
});

describe("Stats table accessibility", () => {
  it("labels sortable headers and announces busy result counts", () => {
    render(
      <Table ariaLabel="Stats results" resultCount={2} resultLabel="records" busy>
        <TableHeader>
          <TableCell isHeader onSort={() => {}} sortLabel="Tokens" ariaSort="descending">Tokens</TableCell>
          <TableCell isHeader onSort={() => {}} sortLabel="Latest">Latest</TableCell>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell mobileLabel="Tokens">200</TableCell>
            <TableCell mobileLabel="Latest">Today</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(screen.getByRole("table", { name: "Stats results" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Updating results. 2 records shown.");
    expect(screen.getByRole("columnheader", { name: /Tokens/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("button", { name: "Tokens, sorted descending" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Latest/ })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("button", { name: "Latest, not sorted" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /200 Today/ })).toHaveAttribute("data-reorder-motion", "listReorder");
  });
});
