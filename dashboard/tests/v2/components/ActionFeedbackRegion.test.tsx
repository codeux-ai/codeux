/** @jsx h */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h } from "preact";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/preact";
import { ActionFeedbackRegion } from "../../../src/v2/components/ui/ActionFeedbackRegion.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe("ActionFeedbackRegion", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when status is idle", () => {
    const { container } = render(<ActionFeedbackRegion status="idle" message="Hidden" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when message is empty", () => {
    const { container } = render(<ActionFeedbackRegion status="success" message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("displays the correct message and status", () => {
    const { container } = render(<ActionFeedbackRegion status="success" message="Saved successfully" />);
    expect(within(container as HTMLElement).getByText("Saved successfully")).toBeInTheDocument();

    // Find within the container since test runner might leak DOM
    const region = within(container as HTMLElement).getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("uses assertive aria-live for errors", () => {
    const { container } = render(<ActionFeedbackRegion status="error" message="Failed to save" />);

    // Find within the container since test runner might leak DOM
    const region = within(container as HTMLElement).getByRole("status");
    expect(region).toHaveAttribute("aria-live", "assertive");
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const handleDismiss = vi.fn();
    const { container } = render(<ActionFeedbackRegion status="warning" message="Watch out" onDismiss={handleDismiss} />);
    const dismissBtn = within(container as HTMLElement).getByRole("button", { name: "Dismiss message" });
    fireEvent.click(dismissBtn);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders retry action and executes it on click", () => {
    const handleRetry = vi.fn();
    const { container } = render(<ActionFeedbackRegion status="error" message="Failed to load" retryAction={handleRetry} retryLabel="Try Again" />);
    const retryBtn = within(container as HTMLElement).getByRole("button", { name: "Try Again" });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
