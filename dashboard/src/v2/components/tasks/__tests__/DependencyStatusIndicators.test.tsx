/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DependencyStatusIndicators } from "../DependencyStatusIndicators.js";

expect.extend(matchers);

describe("DependencyStatusIndicators", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with indicators and distinct styles for different statuses", () => {
    const { getByText, getByTitle, container } = render(
      <DependencyStatusIndicators
        indicators={[
          { recordId: "1", id: "TASK-1", title: "Test task 1", status: "completed" },
          { recordId: "2", id: "TASK-2", title: "Test task 2", status: "pending" },
          { recordId: "3", id: "TASK-3", title: "Test task 3", status: "QA_REVIEW_FAILED" },
          { recordId: "4", id: "TASK-4", title: "Test task 4", status: "in_progress" },
          { recordId: "4b", id: "TASK-4B", title: "Test task 4B", status: "coding_completed" },
          { recordId: "5", id: "TASK-5", title: "Unknown Task (missing)", status: "pending" }
        ] as any}
      />
    );

    const task1Elements = container.querySelectorAll('span[aria-hidden="true"]');
    expect(Array.from(task1Elements).some(el => el.textContent === "TASK-1")).toBeTruthy();

    expect(getByText("Blocked: 5 dependencies need completion")).toBeTruthy();

    expect(getByText("Depends on task TASK-1, resolved. Resolved dependency. Dependency completed. Status: completed. Title: Test task 1")).toBeTruthy();

    const srText = getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'span' && element?.className.includes('sr-only') && content.includes('Depends on task TASK-1');
    });
    expect(srText).toBeTruthy();

    const completedIndicator = getByTitle(/Depends on Test task 1 \(Resolved; completed\)/);
    expect(completedIndicator.className).toContain("text-status-green");
    expect(completedIndicator).toHaveAttribute("data-dependency-state", "resolved");
    expect(Array.from(completedIndicator.querySelectorAll(':scope > span[aria-hidden="true"]')).map((element) => element.textContent)).toEqual(["TASK-1", "Resolved"]);

    const pendingIndicator = getByTitle(/Depends on Test task 2 \(Blocked; pending\)/);
    expect(pendingIndicator.className).toContain("text-status-amber");
    expect(pendingIndicator.className).not.toContain("border-dashed");
    expect(pendingIndicator).toHaveAttribute("data-dependency-state", "blocked");
    expect(Array.from(pendingIndicator.querySelectorAll(':scope > span[aria-hidden="true"]')).map((element) => element.textContent)).toEqual(["TASK-2", "Blocked"]);

    const blockedIndicator = getByTitle(/Depends on Test task 3 \(QA failed; QA REVIEW FAILED\)/i);
    expect(blockedIndicator.className).toContain("text-status-red");
    expect(blockedIndicator).toHaveAttribute("data-dependency-state", "qa_failed");

    const inProgressIndicator = getByTitle(/Depends on Test task 4 \(In progress; in progress\)/i);
    expect(inProgressIndicator.className).toContain("text-signal-600");
    expect(inProgressIndicator).toHaveAttribute("data-dependency-state", "in_progress");
    expect(getByText("In progress")).toBeTruthy();

    const codingCompleteIndicator = getByTitle(/Depends on Test task 4B \(Ready for QA; coding completed\)/i);
    expect(codingCompleteIndicator.className).toContain("text-cyan-700");
    expect(getByText("Ready for QA")).toBeTruthy();
    expect(Array.from(codingCompleteIndicator.querySelectorAll(':scope > span[aria-hidden="true"]')).map((element) => element.textContent)).toEqual(["TASK-4B", "Ready for QA"]);

    const unknownIndicator = getByTitle(/Depends on Unknown Task \(missing\) \(Unknown; pending\)/i);
    expect(unknownIndicator.className).toContain("border-dashed");
    expect(unknownIndicator).toHaveAttribute("data-dependency-state", "unknown");
    expect(unknownIndicator).toHaveAttribute("data-blocking", "true");
    expect(getByText("Unknown")).toBeTruthy();
    expect(container.querySelector('[role="list"]')).toHaveAccessibleName("Blocked: 5 dependencies need completion. Task dependencies");
    expect(container.querySelectorAll('[role="list"] > [role="listitem"]')).toHaveLength(6);
    expect(container.querySelector('[data-motion-control="controlFeedback"]')).toBeTruthy();
    expect(container.querySelector('[data-motion-list-reorder="listReorder"]')).toBeTruthy();
  });

  it("summarizes resolved dependencies without implying blockers", () => {
    const { getByText, getByRole } = render(
      <DependencyStatusIndicators
        indicators={[
          { recordId: "1", id: "TASK-1", title: "Completed task", status: "completed" },
        ]}
      />
    );

    expect(getByText("Dependencies resolved: 1 clear")).toBeTruthy();
    expect(getByRole("list")).toHaveAccessibleName("Dependencies resolved: 1 clear. Task dependencies");
    expect(getByText("Dependency blockers resolved. 1 dependency is clear.")).toHaveClass("sr-only");
    expect(getByRole("listitem", { name: /Depends on task TASK-1/i })).toHaveAttribute("data-blocking", "false");
  });

  it("returns null when no indicators provided", () => {
    const { container } = render(<DependencyStatusIndicators indicators={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
