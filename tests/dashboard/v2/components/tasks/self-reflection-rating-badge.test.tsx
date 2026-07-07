/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskSelfReflectionRating } from "../../../../../src/contracts/task-self-reflection-types.js";
import { SelfReflectionRatingBadge } from "../../../../../dashboard/src/v2/components/tasks/SelfReflectionRatingBadge.js";

const createRating = (overrides: Partial<TaskSelfReflectionRating> = {}): TaskSelfReflectionRating => ({
  id: "rating-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  taskId: "task-1",
  sourceTaskRunId: "run-1",
  overallRating: 4.2,
  sections: [
    {
      label: "Scope control",
      normalizedLabel: "scope_control",
      rating: 3,
      note: null,
    },
    {
      label: "Implementation",
      normalizedLabel: "implementation",
      rating: 4.5,
      note: "Covered edge cases.",
    },
  ],
  capturedAt: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

describe("SelfReflectionRatingBadge", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when rating data is absent or malformed", () => {
    const { container, rerender } = render(<SelfReflectionRatingBadge rating={null} />);
    expect(container.firstChild).toBeNull();

    rerender(<SelfReflectionRatingBadge rating={createRating({ overallRating: Number.NaN })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders compact stars, numeric copy, and accessible rating text", () => {
    render(<SelfReflectionRatingBadge rating={createRating()} />);

    const trigger = screen.getByLabelText("Self-reflection rating 4.2 out of 5");
    expect(trigger.getAttribute("role")).toBe("meter");
    expect(trigger.getAttribute("aria-valuenow")).toBe("4.2");
    expect(trigger.textContent).toContain("4.2/5");
    expect(trigger.querySelectorAll("[data-star-state='filled']")).toHaveLength(4);
    expect(trigger.querySelectorAll("[data-star-state='empty']")).toHaveLength(1);
  });

  it("opens an accessible section-rating overlay on keyboard focus", async () => {
    render(<SelfReflectionRatingBadge rating={createRating()} />);

    const trigger = screen.getByLabelText("Self-reflection rating 4.2 out of 5");
    fireEvent.focus(trigger);

    const overlay = await screen.findByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(overlay.id);
    expect(within(overlay).getByText("Self-reflection rating")).toBeTruthy();
    expect(within(overlay).getByText("4.2/5")).toBeTruthy();
    expect(within(overlay).getByText("Implementation")).toBeTruthy();
    expect(within(overlay).getByText("4.5/5")).toBeTruthy();
    expect(within(overlay).getByText("Covered edge cases.")).toBeTruthy();
    expect(within(overlay).getByText("Scope control")).toBeTruthy();

    const rows = Array.from(overlay.querySelectorAll("[data-self-reflection-section='true']"));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Implementation"),
      expect.stringContaining("Scope control"),
    ]);
  });

  it("positions the overlay with the shared viewport helper on hover", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect() {
      const element = this as HTMLElement;
      if (element.getAttribute("role") === "meter") {
        return {
          x: 100,
          y: 40,
          top: 40,
          left: 100,
          right: 208,
          bottom: 64,
          width: 108,
          height: 24,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (element.getAttribute("role") === "tooltip") {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 240,
          bottom: 160,
          width: 240,
          height: 160,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    render(<SelfReflectionRatingBadge rating={createRating()} position="right" />);
    const trigger = screen.getByLabelText("Self-reflection rating 4.2 out of 5");
    fireEvent.mouseEnter(trigger.parentElement as Element);

    const overlay = await screen.findByRole("tooltip");
    await waitFor(() => {
      expect(overlay.style.left).toBe("216px");
      expect(overlay.style.top).toBe("12px");
    });
  });

  it("closes the overlay when focus leaves the badge", async () => {
    render(<SelfReflectionRatingBadge rating={createRating()} />);

    const trigger = screen.getByLabelText("Self-reflection rating 4.2 out of 5");
    fireEvent.focus(trigger);
    expect(await screen.findByRole("tooltip")).toBeTruthy();

    fireEvent.blur(trigger);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });
});
