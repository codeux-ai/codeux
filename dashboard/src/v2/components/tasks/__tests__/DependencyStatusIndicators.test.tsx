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
          { recordId: "5", id: "TASK-5", title: "Unknown Task (missing)", status: "pending" }
        ]}
      />
    );

    // Verify visual text exists (aria-hidden)
    const task1Elements = container.querySelectorAll('span[aria-hidden="true"]');
    expect(Array.from(task1Elements).some(el => el.textContent === "TASK-1")).toBeTruthy();

    expect(getByText("Blocked: 4 dependencies need completion")).toBeTruthy();

    // Verify explicit accessible text
    expect(getByText("Depends on task TASK-1, resolved. Status: completed. Title: Test task 1")).toBeTruthy();

    // Verify sr-only accessible text
    const srText = getByText((content, element) => {
        return element?.tagName.toLowerCase() === 'span' && element?.className.includes('sr-only') && content.includes('Depends on task TASK-1');
    });
    expect(srText).toBeTruthy();

    // Check specific styling classes for visual feedback states
    const completedIndicator = getByTitle(/Depends on Test task 1 \(completed\)/);
    expect(completedIndicator.className).toContain("text-status-green");

    const pendingIndicator = getByTitle(/Depends on Test task 2 \(pending\)/);
    expect(pendingIndicator.className).toContain("text-slate-500");
    expect(pendingIndicator.className).not.toContain("border-dashed");

    const blockedIndicator = getByTitle(/Depends on Test task 3 \(QA REVIEW FAILED\)/i);
    expect(blockedIndicator.className).toContain("text-red-500");

    const inProgressIndicator = getByTitle(/Depends on Test task 4 \(in progress\)/i);
    expect(inProgressIndicator.className).toContain("text-signal-500");
    expect(getByText("In progress")).toBeTruthy();

    const unknownIndicator = getByTitle(/Depends on Unknown Task \(missing\) \(pending\)/i);
    expect(unknownIndicator.className).toContain("border-dashed");
    expect(container.querySelector('[role="list"]')).toHaveAccessibleName("Blocked: 4 dependencies need completion. Task dependencies");
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
  });

  it("returns null when no indicators provided", () => {
    const { container } = render(<DependencyStatusIndicators indicators={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
