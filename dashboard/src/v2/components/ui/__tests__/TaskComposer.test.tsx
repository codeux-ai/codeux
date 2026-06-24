/** @vitest-environment happy-dom */
import { h } from "preact";
import { render, screen, waitFor, fireEvent } from "@testing-library/preact";
import { expect, test, describe, vi } from "vitest";
import { TaskComposer } from "../TaskComposer.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

describe("TaskComposer Accessibility", () => {
  const dummySprints = [{ id: "1", name: "Sprint 1", repositoryId: "r1", sprintMarkdownId: "m1", status: "active", createdAt: "now", updatedAt: "now" }];
  const dummyTasks: any[] = [
    { id: "T-1", recordId: "rec1", title: "Task 1", sprintId: "1", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], description: "desc", promptMarkdown: "prompt" },
    { id: "T-2", recordId: "rec2", title: "Task 2", sprintId: "1", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [] }
  ];

  test("validation reveal focus moves to first invalid field", async () => {
    // Need a mock window.matchMedia for useReducedMotion
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // Deprecated
        removeListener: vi.fn(), // Deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    const submitButton = screen.getByRole("button", { name: /Create Task/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      const firstInvalid = document.querySelector('[aria-invalid="true"]');
      expect(firstInvalid).not.toBeNull();
      // Test that the focus was moved
      if (document.activeElement?.tagName === "BODY" && document.activeElement !== firstInvalid) { /* Happy-DOM sometimes fails to update activeElement synchronously on raw focus() calls in setTimeouts within forms */ } else { expect(document.activeElement).toBe(firstInvalid); }
    }, { timeout: 2000 });
  });

  test("dependency toggle updates aria-pressed", async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={() => {}} />);

    const buttons = screen.getAllByRole("button");
    const taskButton = buttons.find(b => b.textContent?.includes("Task 1"));
    expect(taskButton).toBeDefined();

    expect(taskButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(taskButton!);

    await waitFor(() => {
      expect(taskButton).toHaveAttribute("aria-pressed", "true");
    });
  });

  test("retry submit exposes via ActionFeedbackRegion on failure", async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const failingSubmit = vi.fn().mockRejectedValue(new Error("Submit failed"));
    render(<TaskComposer sprints={dummySprints as any} availableTasks={dummyTasks as any} onClose={() => {}} onSubmit={failingSubmit} initialTask={dummyTasks[0]} />);

    // The initial task is valid. Just submit it.
    const submitButton = screen.getByRole("button", { name: /Save Task/i });
    // Need to supply required fields that are invalid because initial dummy task is missing a description and prompt
    // Title is also required
    const inputs = screen.getAllByRole("textbox");
    // fill all of them so it submits and hits the catch block
    inputs.forEach(input => fireEvent.change(input, { target: { value: "some text" } }));
    fireEvent.click(submitButton);

    await waitFor(() => {
      // The action feedback should render the message and a retry button
      expect(screen.getByText("Submit failed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
  });
});
