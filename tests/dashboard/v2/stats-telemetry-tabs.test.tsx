/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, describe, it } from "vitest";
import { TelemetryLedgerTabs } from "../../../dashboard/src/v2/pages/stats/components/TelemetryLedgerTabs.js";

expect.extend(matchers);

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
    expect(screen.getByText("Task 1")).toBeInTheDocument();

    // Click on Sprint Telemetry tab
    fireEvent.click(screen.getByText("Sprint Telemetry"));

    // Assert "Task Telemetry" ledger is hidden and "Sprint Telemetry" ledger is visible
    expect(screen.queryByText("Task Ledger")).not.toBeInTheDocument();
    expect(screen.getByText("Sprint Ledger")).toBeInTheDocument();
    expect(screen.getByText("Sprint 1")).toBeInTheDocument();
  });
});
