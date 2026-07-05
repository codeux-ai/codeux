/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ToastProvider, useToast } from "../../../dashboard/src/v2/components/feedback/ToastProvider.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
    to: vi.fn((_el: unknown, config: { onComplete?: () => void }) => {
      config.onComplete?.();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: () => 0,
}));

function ToastHarness() {
  const { addToast } = useToast();
  return (
    <div>
      <button type="button" onClick={() => addToast({ type: "success", message: "Saved one" })}>Add success one</button>
      <button type="button" onClick={() => addToast({ type: "success", message: "Saved two" })}>Add success two</button>
      <button type="button" onClick={() => addToast({ type: "success", message: "Saved three" })}>Add success three</button>
      <button type="button" onClick={() => addToast({ type: "success", message: "Saved four" })}>Add success four</button>
      <button type="button" onClick={() => addToast({ type: "error", message: "Save failed" })}>Add error</button>
    </div>
  );
}

function RetryToastHarness({ onRetry }: { onRetry: () => Promise<void> }) {
  const { addToast } = useToast();
  return (
    <div>
      <main data-feedback-focus-fallback tabIndex={-1}>Toast fallback</main>
      <button
        type="button"
        onClick={() => addToast({ type: "error", message: "Retryable failure", retryAction: onRetry })}
      >
        Add retry error
      </button>
      <button type="button" onClick={() => addToast({ type: "success", message: "Saved with dismiss" })}>
        Add dismissible success
      </button>
    </div>
  );
}

describe("ToastProvider async feedback", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("dismisses overflow non-error toasts while preserving the newest stack", async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Add success one"));
    fireEvent.click(screen.getByText("Add success two"));
    fireEvent.click(screen.getByText("Add success three"));
    fireEvent.click(screen.getByText("Add success four"));

    await waitFor(() => {
      expect(screen.queryAllByText("Saved one")).toHaveLength(0);
    });
    expect(screen.getAllByText("Saved two").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved three").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved four").length).toBeGreaterThan(0);
  });

  it("does not auto-dismiss error toasts", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Add error"));
    vi.runAllTimers();

    expect(screen.getAllByText("Save failed").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    vi.useRealTimers();
  });

  it("keeps retry button name-stable and suppresses duplicate retry while pending", async () => {
    let resolveRetry = () => {};
    const retryAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));

    render(
      <ToastProvider>
        <RetryToastHarness onRetry={retryAction} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Add retry error"));
    const retryButton = screen.getByRole("button", { name: "Retry" });

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

  it("moves focus to the existing fallback after dismissing a focused toast control", async () => {
    render(
      <ToastProvider>
        <RetryToastHarness onRetry={() => Promise.resolve()} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Add dismissible success"));
    const fallback = screen.getByRole("main");
    const dismissButton = screen.getByRole("button", { name: "Dismiss toast" });

    dismissButton.focus();
    expect(document.activeElement).toBe(dismissButton);

    fireEvent.click(dismissButton);
    await waitFor(() => expect(document.activeElement).toBe(fallback));
  });
});
