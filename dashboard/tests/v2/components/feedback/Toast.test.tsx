/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ToastProvider, useToast } from "../../../../src/v2/components/feedback/ToastProvider.js";
import { Toast } from "../../../../src/v2/components/feedback/Toast.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (cb: () => void) => {
      cb();
      return { revert: () => undefined };
    },
    fromTo: () => undefined,
    to: (el: any, config: any) => {
      if (config.onComplete) {
        config.onComplete();
      }
    },
  },
}));

vi.mock("../../../../src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../../src/v2/lib/motion/constants.js", () => ({
  GSAP_EASINGS: { smooth: "power2.inOut" }
}));

const TestComponent = ({ type }: { type: "success" | "error" }) => {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast({ type, message: `Test ${type} message` })}>
      Add {type} toast
    </button>
  );
};

describe("Toast", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders non-error toasts in a polite region without aria-atomic", () => {
    render(
      <ToastProvider>
        <TestComponent type="success" />
      </ToastProvider>
    );

    const politeRegion = screen.getByRole("status");
    expect(politeRegion).toHaveAttribute("aria-live", "polite");
    expect(politeRegion).not.toHaveAttribute("aria-atomic");

    fireEvent.click(screen.getByText("Add success toast"));
    expect(screen.getByText("Test success message")).toBeInTheDocument();
  });

  it("renders error toasts in an assertive region without aria-atomic", () => {
    render(
      <ToastProvider>
        <TestComponent type="error" />
      </ToastProvider>
    );

    const alertRegion = screen.getByRole("alert");
    expect(alertRegion).toHaveAttribute("aria-live", "assertive");
    expect(alertRegion).not.toHaveAttribute("aria-atomic");

    fireEvent.click(screen.getByText("Add error toast"));
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("restores focus when a focused dismiss button is clicked", () => {
    const onDismiss = vi.fn();

    render(
      <div>
        <div role="main" tabIndex={-1}>Main Content</div>
        <Toast
          id="1"
          type="success"
          message="Toast message"
          onDismiss={onDismiss}
        />
      </div>
    );

    const dismissBtn = screen.getByRole("button", { name: "Dismiss toast" });
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledWith("1");
    expect(document.activeElement?.getAttribute("role")).toBe("main");
  });
});
