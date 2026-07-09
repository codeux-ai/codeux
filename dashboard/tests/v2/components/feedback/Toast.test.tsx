/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
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
  useResolvedMotionDuration: (duration: number | string) => typeof duration === "number" ? 0 : "0ms",
}));

vi.mock("../../../../src/v2/lib/motion/constants.js", () => ({
  GSAP_DURATIONS: { base: 0 },
  GSAP_EASINGS: { smooth: "power2.inOut" },
  useGsapInteractionTokens: () => ({
    asyncFeedback: { duration: 0, ease: "linear" },
    enterExit: { duration: 0, ease: "power2.out" },
    listReorder: { duration: 0, ease: "power2.out" },
  })
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

const TestComponent = ({ type }: { type: "success" | "error" }) => {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast({ type, message: `Test ${type} message` })}>
      Add {type} toast
    </button>
  );
};

const OverflowComponent = () => {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast({ type: "success", message: "Saved one" })}>Add one</button>
      <button onClick={() => addToast({ type: "success", message: "Saved two" })}>Add two</button>
      <button onClick={() => addToast({ type: "success", message: "Saved three" })}>Add three</button>
      <button onClick={() => addToast({ type: "success", message: "Saved four" })}>Add four</button>
      <button onClick={() => addToast({ type: "error", message: "Blocking failure" })}>Add blocking error</button>
    </div>
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
    expect(screen.getAllByText("Test success message").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("Test error message").length).toBeGreaterThan(0);
  });

  it("includes visually hidden type text and dismiss label", () => {
    render(
      <Toast
        id="2"
        type="success"
        message="Test success"
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText("success")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Dismiss toast" })).toBeInTheDocument();
  });

  it("shifts focus to document.body on dismiss when active", () => {
    const onDismiss = vi.fn();

    render(
      <div>
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
    expect(document.activeElement).toBe(document.body);
  });

  it("auto-dismisses non-error toasts but keeps blocking errors persistent", () => {
    vi.useFakeTimers();
    const successDismiss = vi.fn();
    const errorDismiss = vi.fn();

    render(
      <div>
        <Toast
          id="success"
          type="success"
          message="Saved one"
          onDismiss={successDismiss}
          autoDismissMs={50}
        />
        <Toast
          id="error"
          type="error"
          message="Blocking failure"
          onDismiss={errorDismiss}
          autoDismissMs={50}
        />
      </div>
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(successDismiss).toHaveBeenCalledWith("success");
    expect(errorDismiss).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("compacts non-error overflow while preserving error toasts", async () => {
    render(
      <ToastProvider>
        <OverflowComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText("Add blocking error"));
    fireEvent.click(screen.getByText("Add one"));
    fireEvent.click(screen.getByText("Add two"));
    fireEvent.click(screen.getByText("Add three"));
    fireEvent.click(screen.getByText("Add four"));

    await waitFor(() => {
      expect(screen.queryAllByText("Saved one")).toHaveLength(0);
    });
    expect(screen.getAllByText("Saved two").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved three").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved four").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocking failure").length).toBeGreaterThan(0);
  });

  it("labels retry actions and suppresses duplicate retry while pending", async () => {
    let resolveRetry: () => void = () => undefined;
    const retryAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));

    render(
      <Toast
        id="retry-toast"
        type="error"
        message="Save failed"
        retryAction={retryAction}
        retryLabel="Retry save"
        onDismiss={() => {}}
      />
    );

    const retry = screen.getByRole("button", { name: "Retry save" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(retryAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry save" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Retry save" })).toHaveAccessibleDescription("Retry save in progress.");

    resolveRetry();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry save" })).not.toBeDisabled();
    });
  });
});
