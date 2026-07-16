/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ActionFeedbackRegion } from "../../../../src/v2/components/ui/ActionFeedbackRegion.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (cb: () => void) => {
      cb();
      return { revert: () => undefined };
    },
    fromTo: () => undefined,
    to: () => undefined,
    timeline: () => ({
      fromTo: () => undefined,
      to: () => undefined,
    }),
  },
}));

vi.mock("../../../../src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: (duration: number | string) => typeof duration === "number" ? 0 : "0ms",
}));

vi.mock("../../../../src/v2/lib/motion/constants.js", () => ({
  useGsapDurations: () => ({ fast: 0.1, base: 0.2 }),
  GSAP_EASINGS: { smooth: "power2.inOut" },
  useGsapInteractionTokens: () => ({
    controlFeedback: { duration: 0, ease: "linear" },
    enterExit: { duration: 0, ease: "linear" },
    expansionCollapse: { duration: 0, ease: "linear" },
    selectionMovement: { duration: 0, ease: "linear" },
    listReveal: { duration: 0, ease: "linear" },
    listReorder: { duration: 0, ease: "linear" },
    inlineValidation: { duration: 0, ease: "linear" },
    asyncFeedback: { duration: 0, ease: "linear" },
  }),
}));

vi.mock("../../../../src/v2/lib/motion/tokens.js", () => ({
  useInteractionTokens: () => ({
    controlFeedback: { duration: "0ms", ease: "linear" },
    enterExit: { duration: "0ms", ease: "linear" },
    expansionCollapse: { duration: "0ms", ease: "linear" },
    selectionMovement: { duration: "0ms", ease: "linear" },
    listReveal: { duration: "0ms", ease: "linear" },
    listReorder: { duration: "0ms", ease: "linear" },
    inlineValidation: { duration: "0ms", ease: "linear" },
    asyncFeedback: { duration: "0ms", ease: "linear" },
  }),
}));

vi.mock("../../../../src/v2/lib/motion/modal-motion.js", () => ({
  MODAL_MOTION: {
    feedback: { yStart: 10, yEnd: 0, scaleStart: 0.95, scaleEnd: 1, duration: 0.2, ease: "power2.out" }
  }
}));

describe("ActionFeedbackRegion", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders stable action slots with target-specific accessible names for buttons", () => {
    render(
      <ActionFeedbackRegion
        status="error"
        message="A long error message that shouldn't be repeated."
        retryAction={() => {}}
        onDismiss={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("grid-cols-[1.25rem_minmax(0,1fr)_auto]");
  });

  it("updates aria-live correctly based on pending, success, and blocking error status", () => {
    const { rerender } = render(
      <ActionFeedbackRegion status="pending" message="Pending" />
    );

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");

    rerender(<ActionFeedbackRegion status="success" message="Saved" />);

    const successRegion = screen.getByRole("status");
    expect(successRegion).toHaveAttribute("aria-live", "off");

    rerender(<ActionFeedbackRegion status="error" message="Error" />);

    const errorRegion = screen.getByRole("alert");
    expect(errorRegion).toHaveAttribute("aria-live", "assertive");
  });

  it("handles clearError correctly", () => {
    const clearError = vi.fn();
    render(
      <ActionFeedbackRegion
        status="error"
        message="An error occurred"
        clearError={clearError}
      />
    );

    const clearBtn = screen.getByRole("button", { name: "Clear error" });
    fireEvent.click(clearBtn);

    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it("restores focus when the focused dismiss button is removed", async () => {
    const dismiss = vi.fn();

    const { rerender } = render(
      <div>
        <div role="main" tabIndex={-1}>Main Content</div>
        <ActionFeedbackRegion
          status="warning"
          message="Warning message"
          onDismiss={() => {
            dismiss();
            rerender(
              <div>
                <div role="main" tabIndex={-1}>Main Content</div>
              </div>
            );
          }}
        />
      </div>
    );

    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    fireEvent.click(dismissBtn);

    expect(dismiss).toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("role")).toBe("main");
    });
  });

  it("keeps blocking errors persistent until caller dismissal or clear", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();

    render(
      <ActionFeedbackRegion
        status="error"
        message="Blocking save failed"
        onDismiss={dismiss}
        autoDismissMs={50}
      />
    );

    vi.advanceTimersByTime(1000);

    expect(screen.getByRole("alert")).toHaveTextContent("Blocking save failed");
    expect(dismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("suppresses duplicate retry activation while retry is pending", async () => {
    let resolveRetry: () => void = () => undefined;
    const retryAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));

    render(
      <ActionFeedbackRegion
        status="error"
        message="Failed to save"
        retryAction={retryAction}
        retryLabel="Retry save"
      />
    );

    const retry = screen.getByRole("button", { name: "Retry save" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(retryAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry save" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Retry save" })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Retry save in progress");
    });

    resolveRetry();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry save" })).not.toBeDisabled();
    });
  });

  it("snaps pending progress to the visible width under reduced motion", () => {
    const { container, rerender } = render(
      <ActionFeedbackRegion status="pending" message="Uploading" progress={25} />
    );

    const progress = container.querySelector('[aria-hidden="true"].bg-signal-500') as HTMLElement;
    expect(progress).toHaveStyle({ width: "25%" });
    expect(screen.getByRole("status")).toHaveTextContent("pending 25 percent complete");

    rerender(<ActionFeedbackRegion status="pending" message="Uploading" progress={70} />);
    expect(progress).toHaveStyle({ width: "70%" });
    expect(screen.getByRole("status")).toHaveTextContent("pending 70 percent complete");
  });
});
