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

  it("renders completed review with findings in a two-column layout", () => {
    const summary = {
      status: "completed",
      outcome: "passed",
      summary: "Good but has minor nits.",
      findings: ["Fix spacing", "Rename variable"],
      reviewer: "Jules",
      finishedAt: "2024-01-01T00:00:00.000Z",
    };
    render(<SprintReviewBadge summary={summary} />);

    // Ensure the header for findings is rendered
    expect(screen.getByText("2 Findings")).toBeDefined();

    // Verify findings are present in the DOM (right column content)
    expect(screen.getByText("Fix spacing")).toBeDefined();
    expect(screen.getByText("Rename variable")).toBeDefined();
  });
});
