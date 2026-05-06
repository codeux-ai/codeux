/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import { h } from "preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/preact";
/** @jsx h */

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
    timeline: () => ({
      fromTo: vi.fn(),
    }),
  },
}));

vi.mock("../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
  useExecutionTimeline: vi.fn(() => ({ execution: { connections: [] } })),
}));

import { SprintComposer } from "../../../dashboard/src/v2/components/ui/SprintComposer.js";

describe("SprintComposer", () => {
  beforeEach(() => {
    cleanup();
  });

  const defaultProps = {
    nextId: "SPR-1",
    virtualProviders: [],
    planningPresets: [],
    planningEta: 60000,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  it("renders correctly", () => {
    const { getByText, getByPlaceholderText } = render(<SprintComposer {...defaultProps} />);
    expect(getByText("Compose The Next Sprint.")).toBeInTheDocument();
    expect(getByPlaceholderText("Runtime hardening")).toBeInTheDocument();
  });

  it("shows planning overlay on submit and allows dismiss without cancel", async () => {
    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    const mockOnSubmit = vi.fn(() => submitPromise);

    const { getByText, getByPlaceholderText, queryByText, getAllByText } = render(
      <SprintComposer {...defaultProps} onSubmit={mockOnSubmit} />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    fireEvent.input(nameInput, { target: { value: "Test Sprint" } });

    // Switch to Plan mode
    const planModeBtn = getAllByText("Plan Only")[0]!;
    fireEvent.click(planModeBtn);

    const submitBtn = getAllByText("Plan Only").pop()!;
    fireEvent.click(submitBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(document.body.textContent).toContain("Generating subtasks");
    });

    expect(mockOnSubmit).toHaveBeenCalled();

    // Dismiss overlay
    const closeBtn = getByText("Minimize");
    fireEvent.click(closeBtn);

    // Overlay should disappear
    await waitFor(() => {
      expect(queryByText("Planning in motion")).not.toBeInTheDocument();
    });

    // We didn't cancel, so we can now resolve the submit to finish
    resolveSubmit!(undefined);
  });

  it("shows planning overlay and cancels through explicit request cancellation", async () => {
    const mockOnCancelPlanningRequest = vi.fn();
    const mockOnSubmit = vi.fn(async () => new Promise(() => undefined));

    const { getByText, getByPlaceholderText, queryByText, getAllByText } = render(
      <SprintComposer {...defaultProps} onSubmit={mockOnSubmit} onCancelPlanningRequest={mockOnCancelPlanningRequest} />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    fireEvent.input(nameInput, { target: { value: "Test Sprint" } });

    // Switch to Plan mode
    const planModeBtn = getAllByText("Plan Only")[0]!;
    fireEvent.click(planModeBtn);

    const submitBtn = getAllByText("Plan Only").pop()!;
    fireEvent.click(submitBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(document.body.textContent).toContain("Generating subtasks");
    });

    expect(mockOnSubmit).toHaveBeenCalled();

    // Click Cancel Active Request through the overlay specifically.
    const cancelBtns = getAllByText("Cancel Active Request");
    // Click the one inside the overlay
    fireEvent.click(cancelBtns[0]!);

    expect(mockOnCancelPlanningRequest).toHaveBeenCalledTimes(1);
    expect(mockOnCancelPlanningRequest.mock.calls[0]?.[0]).toEqual(expect.any(String));

    // Overlay should disappear because state resets when not busy
    await waitFor(() => {
      expect(document.body.textContent).not.toContain("Generating subtasks...");
    });
  });

  it("shows New Sprint secondary action and opens a fresh composer without cancelling", async () => {
    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    const mockOnSubmit = vi.fn(async () => submitPromise);
    const mockOnCancelPlanningRequest = vi.fn();
    const mockOnStartNewSprint = vi.fn();

    const { getByText, getByPlaceholderText, getAllByText } = render(
      <SprintComposer
        {...defaultProps}
        onSubmit={mockOnSubmit}
        onCancelPlanningRequest={mockOnCancelPlanningRequest}
        onStartNewSprint={mockOnStartNewSprint}
      />
    );

    const nameInput = getByPlaceholderText("Runtime hardening");
    fireEvent.input(nameInput, { target: { value: "Test Sprint" } });

    // Switch to Plan mode
    const planModeBtn = getAllByText("Plan Only")[0]!;
    fireEvent.click(planModeBtn);

    const submitBtn = getAllByText("Plan Only").pop()!;
    fireEvent.click(submitBtn);

    // Overlay should appear
    await waitFor(() => {
      expect(document.body.textContent).toContain("Generating subtasks");
    });

    expect(mockOnSubmit).toHaveBeenCalled();

    // Click New Sprint
    const newSprintBtn = getByText("New Sprint");
    fireEvent.click(newSprintBtn);

    expect(mockOnStartNewSprint).toHaveBeenCalled();
    expect(mockOnCancelPlanningRequest).not.toHaveBeenCalled();
    expect((nameInput as HTMLInputElement).value).toBe("");

    // Resolve the promise to cleanup
    resolveSubmit!(undefined);
  });
});

import { AddTaskModal } from "../../../dashboard/src/v2/components/ui/AddTaskModal.js";

describe("AddTaskModal Lifecycle", () => {
  const defaultProps = {
    sprints: [{ id: "SPR-1", name: "Test Sprint", status: "planning", order: 0 }],
    availableTasks: [],
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    cleanup();
  });

  it("returns focus to trigger upon modal close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open Modal";
    document.body.appendChild(trigger);
    trigger.focus();

    const { getByLabelText, unmount } = render(
      <AddTaskModal {...defaultProps} />
    );

    const closeBtn = getByLabelText("Close");
    fireEvent.click(closeBtn);

    // useFocusTrap sets the timeout to focus the previous active element.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    unmount();
    trigger.remove();
  });

  it("disables cancel and close buttons during pending submit", async () => {
    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    const mockOnSubmit = vi.fn(() => submitPromise);

    const { getByLabelText, getByRole, getByText } = render(
      <AddTaskModal {...defaultProps} onSubmit={mockOnSubmit} />
    );

    const sprintSelect = getByLabelText("Sprint");
    const titleInput = getByLabelText("Title");

    fireEvent.input(sprintSelect, { target: { value: "SPR-1" } });
    fireEvent.input(titleInput, { target: { value: "A valid title" } });

    const submitButton = getByRole("button", { name: "Create Task" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });

    const closeBtn = getByLabelText("Close");
    const cancelBtn = getByText("Cancel");

    expect(closeBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(submitButton).toHaveAttribute("aria-disabled", "true");

    resolveSubmit!(undefined);
  });

  it("displays error in ActionFeedbackRegion without auto dismiss, and handles dismiss", async () => {
    const mockOnSubmit = vi.fn(() => Promise.reject(new Error("API Error 500")));

    const { getByLabelText, getByRole, getByText, queryByText, queryByRole } = render(
      <AddTaskModal {...defaultProps} onSubmit={mockOnSubmit} />
    );

    const sprintSelect = getByLabelText("Sprint");
    const titleInput = getByLabelText("Title");

    fireEvent.input(sprintSelect, { target: { value: "SPR-1" } });
    fireEvent.input(titleInput, { target: { value: "A valid title" } });

    const submitButton = getByRole("button", { name: "Create Task" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(getByText("API Error 500")).toBeInTheDocument();
    });

    const errorRegion = getByRole("alert");
    expect(errorRegion).toBeInTheDocument();

    const dismissBtn = getByLabelText("Dismiss message");

    // Explicitly focus it to ensure focus behavior is correctly represented
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(queryByText("API Error 500")).not.toBeInTheDocument();
      // focus placement after error recovery: activeElement should not be a dead reference
      expect(document.activeElement).not.toBe(dismissBtn);
    });
  });
});
