// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ToastProvider, useToast } from "../ToastProvider.js";
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

describe("Toast System", () => {
  afterEach(() => {
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
      expect(screen.getByText("Success msg")).toBeInTheDocument();
      expect(screen.getByText("Error msg")).toBeInTheDocument();
    });

    const successToast = screen.getByText("Success msg").closest('div.pointer-events-auto');
    const errorToast = screen.getByText("Error msg").closest('div.pointer-events-auto');

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
      expect(screen.getByText("Error msg")).toBeInTheDocument();
    });

    const retryBtn = screen.getByText("Retry");
    expect(retryBtn).toBeInTheDocument();

    // Focus should remain on the button that triggered the action, not jump to Retry
    expect(document.activeElement).toBe(btn);
  });
});
