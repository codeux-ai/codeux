import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";
afterEach(() => { cleanup(); });
/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { SprintReviewBadge } from "../../../../../dashboard/src/v2/components/sprints/SprintReviewBadge";

describe("SprintReviewBadge", () => {
  it("renders running state loading UI", () => {
    const summary = {
      status: "running",
      outcome: null,
      summary: null,
      findings: [],
      reviewer: null,
      finishedAt: null,
    };
    render(<SprintReviewBadge summary={summary} />);
    expect(screen.getByText("Reviewing...")).toBeDefined();
  });

  it("renders completed review without findings", () => {
    const summary = {
      status: "completed",
      outcome: "passed",
      summary: "Looks perfect.",
      findings: [],
      reviewer: "Jules",
      finishedAt: "2024-01-01T00:00:00.000Z",
    };
    render(<SprintReviewBadge summary={summary} />);
    expect(screen.getByText("QA Review Complete")).toBeDefined();
    expect(screen.getByText("Looks perfect.")).toBeDefined();
    expect(screen.getByText("Reviewed by Jules")).toBeDefined();

    // Should not render the findings toggle button
    expect(screen.queryByText(/View \d+ Findings/)).toBeNull();
  });

  it("renders completed review with findings and handles toggle interaction", async () => {
    const summary = {
      status: "completed",
      outcome: "passed",
      summary: "Good but has minor nits.",
      findings: ["Fix spacing", "Rename variable"],
      reviewer: "Jules",
      finishedAt: "2024-01-01T00:00:00.000Z",
    };
    render(<SprintReviewBadge summary={summary} />);

    // Ensure the toggle button is rendered
    const toggleButton = screen.getByText("View 2 Findings");
    expect(toggleButton).toBeDefined();

    // Verify findings are present in the DOM (right column content inside collapsible section)
    expect(screen.getByText("Fix spacing")).toBeDefined();
    expect(screen.getByText("Rename variable")).toBeDefined();

    // Verify initial closed state (no "open" class on the collapsible section)
    // The closest wrapper to the list with class collapsible-section
    const listWrapper = screen.getByText("Fix spacing").closest(".collapsible-section");
    expect(listWrapper?.className).not.toContain("open");

    // Test interaction: click toggle
    fireEvent.click(toggleButton);

    // Verify state updates by checking if "open" class is added to the collapsible section
    await waitFor(() => {
        expect(listWrapper?.className).toContain("open");
    });
  });
});
