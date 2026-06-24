/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
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
}));

vi.mock("../../../../src/v2/lib/motion/constants.js", () => ({
  useGsapDurations: () => ({ fast: 0.1, base: 0.2 }),
  GSAP_EASINGS: { smooth: "power2.inOut" }
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

  it("renders with concise accessible names for buttons", () => {
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
  });

  it("restores focus when the focused dismiss button is clicked", () => {
    const dismiss = vi.fn();

    render(
      <div>
        <div role="main" tabIndex={-1}>Main Content</div>
        <ActionFeedbackRegion
          status="warning"
          message="Warning message"
          onDismiss={dismiss}
        />
      </div>
    );

    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    fireEvent.click(dismissBtn);

    expect(dismiss).toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("role")).toBe("main");
  });
});
