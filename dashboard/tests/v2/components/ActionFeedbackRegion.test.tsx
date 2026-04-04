/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi } from "vitest";
import { ActionFeedbackRegion } from "../../../src/v2/components/ui/ActionFeedbackRegion.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe("ActionFeedbackRegion", () => {
  it("renders nothing when status is idle", () => {
    const { container } = render(<ActionFeedbackRegion status="idle" message="Hidden" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when message is empty", () => {
    const { container } = render(<ActionFeedbackRegion status="success" message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("displays the correct message and status", () => {
    render(<ActionFeedbackRegion status="success" message="Saved successfully" />);
    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("uses assertive aria-live for errors", () => {
    render(<ActionFeedbackRegion status="error" message="Failed to save" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "assertive");
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const handleDismiss = vi.fn();
    render(<ActionFeedbackRegion status="warning" message="Watch out" onDismiss={handleDismiss} />);
    const dismissBtn = screen.getByRole("button", { name: "Dismiss message" });
    fireEvent.click(dismissBtn);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
