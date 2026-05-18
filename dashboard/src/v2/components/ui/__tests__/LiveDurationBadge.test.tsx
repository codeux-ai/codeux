import { render } from "@testing-library/preact";
import { LiveDurationBadge } from "../LiveDurationBadge";
import { describe, it, expect } from "vitest";
import React from "preact/compat";

describe("LiveDurationBadge", () => {
  it("renders with tabular-nums", () => {
    const { container } = render(<LiveDurationBadge durationText="00:01:05" flashTriggerCount={0} />);

    // Test that the outer span with tabular-nums is rendered.
    const badge = container.firstChild as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("tabular-nums");

    // Ensure the text itself renders.
    expect(container.textContent).toBe("00:01:05");
  });

  it("handles empty or null durationText", () => {
    const { container } = render(<LiveDurationBadge durationText={undefined} flashTriggerCount={0} />);
    // Just expect it not to crash and render null/empty appropriately based on implementation
    expect(container).not.toBeNull();
  });
});
