// @vitest-environment happy-dom
import { h } from "preact";
import { useState } from "preact/hooks";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import '@testing-library/jest-dom/vitest';
import { ActionFeedbackRegion } from "../../../../dashboard/src/v2/components/ui/ActionFeedbackRegion.js";

vi.mock("../../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: (duration: number | string) => typeof duration === "number" ? 0 : "0ms",
}));

describe("ActionFeedbackRegion", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with appropriate ARIA attributes for alert", () => {
    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="An error occurred" />
    );
    const element = getByRole("alert");
    expect(element).toBeInTheDocument();
    expect(element.getAttribute("aria-live")).toBe("assertive");
    expect(element.getAttribute("aria-atomic")).toBe("true");
    expect(element.textContent).toContain("An error occurred");
  });

  it("renders with appropriate ARIA attributes for status", () => {
    const { getByRole } = render(
      <ActionFeedbackRegion status="success" message="Success message" />
    );
    const element = getByRole("status");
    expect(element).toBeInTheDocument();
    expect(element.getAttribute("aria-live")).toBe("off");
    expect(element.getAttribute("aria-atomic")).toBe("true");
    expect(element.textContent).toContain("Success message");
  });

  it("announces warning feedback politely", () => {
    const { getByRole } = render(
      <ActionFeedbackRegion status="warning" message="Warning message" />
    );
    const element = getByRole("status");
    expect(element).toHaveAttribute("aria-live", "polite");
    expect(element).toHaveTextContent("warning");
    expect(element).toHaveTextContent("Warning message");
  });

  it("announces pending progress politely with aria-busy", () => {
    const { getByRole, rerender } = render(
      <ActionFeedbackRegion status="pending" message="Saving settings" progress={25} />
    );

    const element = getByRole("status");
    expect(element).toHaveAttribute("aria-live", "polite");
    expect(element).toHaveAttribute("aria-busy", "true");
    expect(element.textContent).toContain("pending 25 percent complete");

    rerender(<ActionFeedbackRegion status="pending" message="Saving settings" progress={80} />);
    expect(getByRole("status").textContent).toContain("pending 80 percent complete");
  });

  it("renders reduced-motion-safe static cues for pending and error feedback", () => {
    const { getByRole, rerender } = render(
      <ActionFeedbackRegion status="pending" message="Saving settings" progress={40} />
    );

    const pendingRegion = getByRole("status");
    expect(pendingRegion).toHaveAttribute("aria-busy", "true");
    expect(pendingRegion).toHaveAttribute("aria-live", "polite");
    expect(pendingRegion).toHaveTextContent("pending 40 percent complete");
    expect(pendingRegion.querySelector("svg")).toHaveClass("motion-reduce:animate-none");
    expect(pendingRegion.querySelector("svg")).toHaveStyle({ animationDuration: "0ms" });

    rerender(<ActionFeedbackRegion status="error" message="Save failed" />);

    const errorRegion = getByRole("alert");
    expect(errorRegion).toHaveAttribute("aria-live", "assertive");
    expect(errorRegion).not.toHaveAttribute("aria-busy");
    expect(errorRegion).toHaveTextContent("Save failed");
  });

  it("clears errors without creating a nested alert announcement", () => {
    const clearError = vi.fn();
    const { getByRole, queryAllByRole } = render(
      <ActionFeedbackRegion status="error" message="Save failed" clearError={clearError} />
    );

    getByRole("button", { name: "Clear error" }).click();

    expect(clearError).toHaveBeenCalledTimes(1);
    expect(queryAllByRole("alert")).toHaveLength(1);
  });

  it("shows retry button when retryAction is provided", () => {
    const retryAction = () => {};
    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="Error" retryAction={retryAction} />
    );
    const retryButton = getByRole("button", { name: "Retry" });
    expect(retryButton).toBeInTheDocument();
  });

  it("handles retryAction correctly", () => {
    const retryAction = vi.fn();
    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="Error" retryAction={retryAction} />
    );
    const retryButton = getByRole("button", { name: "Retry" });
    retryButton.click();
    expect(retryAction).toHaveBeenCalledTimes(1);
  });

  it("keeps retry visible and name-stable while retry is pending", async () => {
    let resolveRetry = () => {};
    const retryAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));

    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="Error" retryAction={retryAction} />
    );

    const retryButton = getByRole("button", { name: "Retry" });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(retryAction).toHaveBeenCalledTimes(1);
    expect(retryButton).toBeDisabled();
    expect(retryButton).toHaveAttribute("aria-busy", "true");
    expect(retryButton).toHaveAccessibleName("Retry");
    expect(retryButton).toHaveAccessibleDescription("Retry in progress.");

    resolveRetry();
    await waitFor(() => expect(retryButton).not.toBeDisabled());
    expect(retryButton).toHaveAccessibleName("Retry");
  });

  it("moves focus to the existing fallback after dismissing a focused feedback control", async () => {
    const FeedbackHarness = () => {
      const [visible, setVisible] = useState(true);
      return (
        <main data-feedback-focus-fallback tabIndex={-1}>
          {visible && (
            <ActionFeedbackRegion
              status="error"
              message="Save failed"
              clearError={() => setVisible(false)}
            />
          )}
        </main>
      );
    };

    const { getByRole } = render(<FeedbackHarness />);
    const fallback = getByRole("main");
    const clearButton = getByRole("button", { name: "Clear error" });

    clearButton.focus();
    expect(document.activeElement).toBe(clearButton);

    fireEvent.click(clearButton);
    await waitFor(() => expect(document.activeElement).toBe(fallback));
  });

  it("moves focus to the existing fallback after dismissing a focused success control", async () => {
    const FeedbackHarness = () => {
      const [visible, setVisible] = useState(true);
      return (
        <main data-feedback-focus-fallback tabIndex={-1}>
          {visible && (
            <ActionFeedbackRegion
              status="success"
              message="Saved"
              onDismiss={() => setVisible(false)}
              autoDismiss={false}
            />
          )}
        </main>
      );
    };

    const { getByRole, queryByRole } = render(<FeedbackHarness />);
    const fallback = getByRole("main");
    const dismissButton = getByRole("button", { name: "Dismiss" });

    dismissButton.focus();
    expect(document.activeElement).toBe(dismissButton);

    fireEvent.click(dismissButton);
    await waitFor(() => expect(queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(fallback);
  });
});
