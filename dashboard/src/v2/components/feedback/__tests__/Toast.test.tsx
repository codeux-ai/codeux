// @vitest-environment jsdom
import { h } from "preact";
import { useState } from "preact/hooks";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ToastProvider, useToast } from "../ToastProvider.js";
import { Toast } from "../Toast.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

// Mock gsap to avoid test failures
vi.mock("gsap", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    default: {
      ...actual.default,
      context: (cb: any) => { cb(); return { revert: () => {} }; },
      fromTo: (target: any, from: any, to: any) => {
        if (to.onComplete) to.onComplete();
      },
      to: (target: any, to: any) => {
        if (to.onComplete) to.onComplete();
      }
    }
  };
});

const TestComponent = () => {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast({ type: "error", message: "Error msg", action: { label: "Retry", onClick: () => {} } })}>Add Error</button>
      <button onClick={() => addToast({ type: "success", message: "Success msg" })}>Add Success</button>
    </div>
  );
};

const RetryRemovalToast = ({ onRetry }: { onRetry: () => void | Promise<void> }) => {
  const [visible, setVisible] = useState(true);
  return (
    <div>
      <main data-feedback-focus-fallback tabIndex={-1}>Toast fallback</main>
      {visible && (
        <Toast
          id="retry-toast"
          type="error"
          message="Retryable toast"
          retryAction={async () => {
            await onRetry();
            setVisible(false);
          }}
          onDismiss={() => setVisible(false)}
        />
      )}
    </div>
  );
};

describe("Toast System", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it("uses polite for normal and assertive for errors, without nesting roles inside Toast itself", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    // Test container setup
    expect(document.querySelector('div[role="status"][aria-live="polite"]')).toBeInTheDocument();
    expect(document.querySelector('div[role="alert"][aria-live="assertive"]')).toBeInTheDocument();

    const addSuccess = screen.getByText("Add Success");
    const addError = screen.getByText("Add Error");

    fireEvent.click(addSuccess);
    fireEvent.click(addError);

    await waitFor(() => {
      expect(screen.getAllByText("Success msg").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Error msg").length).toBeGreaterThan(0);
    });

    const successToast = document.querySelector('div.pointer-events-auto p')?.closest('div.pointer-events-auto');
    const errorToast = Array.from(document.querySelectorAll('div.pointer-events-auto p'))
      .find((node) => node.textContent === "Error msg")
      ?.closest('div.pointer-events-auto');

    // Ensure the individual toasts themselves don't have redundant roles
    expect(successToast).not.toHaveAttribute('role');
    expect(successToast).not.toHaveAttribute('aria-live');
    expect(errorToast).not.toHaveAttribute('role');
    expect(errorToast).not.toHaveAttribute('aria-live');
  });

  it("does not dynamically steal focus when an error toast with action is rendered", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const btn = screen.getByText("Add Error");
    btn.focus();
    expect(document.activeElement).toBe(btn);

    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getAllByText("Error msg").length).toBeGreaterThan(0);
    });

    const retryBtn = screen.getByText("Retry");
    expect(retryBtn).toBeInTheDocument();

    // Focus should remain on the button that triggered the action, not jump to Retry
    expect(document.activeElement).toBe(btn);
  });

  it("preserves focus context when dismissing a toast from a focused dismiss button", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const btn = screen.getByText("Add Success");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getAllByText("Success msg").length).toBeGreaterThan(0);
    });

    const dismissBtn = screen.getByLabelText("Dismiss toast");
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    fireEvent.click(dismissBtn);

    expect(document.activeElement).not.toBe(dismissBtn);
  });

  it("moves focus to fallback when retry removes the focused toast control", async () => {
    const onRetry = vi.fn();
    render(<RetryRemovalToast onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    expect(document.activeElement).toBe(retry);

    fireEvent.click(retry);

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Toast fallback")));
  });

  it("pauses auto-dismiss while pointer-hovered and resumes with remaining time", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <Toast
        id="hover-toast"
        type="success"
        message="Hover saved"
        onDismiss={onDismiss}
        autoDismissMs={100}
      />
    );

    const toast = screen.getByText("Hover saved").closest("[data-toast-type='success']") as HTMLElement;
    const countdown = toast.querySelector("[data-toast-countdown]");
    expect(countdown).toBeInTheDocument();
    expect(countdown).toHaveAttribute("aria-hidden", "true");

    fireEvent.pointerEnter(toast);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(countdown).toHaveAttribute("data-paused", "true");

    fireEvent.pointerLeave(toast);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledWith("hover-toast");
  });

  it("pauses auto-dismiss while focus is inside an action and resumes on focus-out", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <Toast
        id="focus-toast"
        type="info"
        message="Focusable info"
        action={{ label: "View details", onClick: () => {} }}
        onDismiss={onDismiss}
        autoDismissMs={100}
      />
    );

    const action = screen.getByRole("button", { name: "View details" });
    fireEvent.focus(action);
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.blur(action, { relatedTarget: document.body });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onDismiss).toHaveBeenCalledWith("focus-toast");
  });

  it("keeps error toasts manual-dismiss with no countdown", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <Toast
        id="error-toast"
        type="error"
        message="Blocking error"
        onDismiss={onDismiss}
        autoDismissMs={50}
      />
    );

    const toast = screen.getByText("Blocking error").closest("[data-toast-type='error']") as HTMLElement;
    expect(toast.querySelector("[data-toast-countdown]")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
