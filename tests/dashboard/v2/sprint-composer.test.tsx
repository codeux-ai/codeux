/** @vitest-environment jsdom */
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
    set: vi.fn(),
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

  it("shows planning overlay and aborts when cancel is clicked", async () => {
    let rejectSubmit: (val: any) => void;
    const submitPromise = new Promise((_, reject) => {
      rejectSubmit = reject;
    });

    const mockOnSubmit = vi.fn(async ({ signal }) => {
      return new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException("Aborted", "AbortError")));
        }
      });
    });

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

    // Click Cancel Request (abort via the overlay specifically)
    const cancelBtns = getAllByText("Cancel Request");
    // Click the one inside the overlay
    fireEvent.click(cancelBtns[0]!);

    // Overlay should disappear because state resets when not busy
    await waitFor(() => {
      expect(document.body.textContent).not.toContain("Generating subtasks...");
    });
  });
});