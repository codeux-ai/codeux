/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { cleanup, render, screen } from "@testing-library/preact";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { ToastProvider, useToast } from "../../../src/v2/components/feedback/ToastProvider.js";
import { useEffect } from "preact/hooks";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// Mock GSAP and reduced motion for tests
vi.mock("gsap", () => ({
  default: {
    context: (cb: any) => { cb(); return { revert: vi.fn() }; },
    fromTo: (el: any, from: any, to: any) => { if (to.onComplete) to.onComplete(); },
    to: (el: any, to: any) => { if (to.onComplete) to.onComplete(); }
  }
}));

const TestComponent = ({ type = "success", action = undefined }: any) => {
  const { addToast } = useToast();
  useEffect(() => {
    addToast({ type, message: "Test message", action });
  }, [addToast, type, action]);
  return null;
};

describe("ToastProvider Accessibility", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders success toast with role status and polite aria-live", () => {
    render(<ToastProvider><TestComponent type="success" /></ToastProvider>);
    const toast = screen.getByRole("status");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(toast).toHaveAttribute("aria-atomic", "true");
  });

  it("renders error toast with role alert and assertive aria-live", () => {
    render(<ToastProvider><TestComponent type="error" /></ToastProvider>);
    const toasts = screen.getAllByRole("alert");
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[0]).toHaveAttribute("aria-live", "assertive");
    expect(toasts[0]).toHaveAttribute("aria-atomic", "true");
  });

  it("does not force focus on error toast action buttons", async () => {
    render(<ToastProvider><TestComponent type="error" action={{ label: "Retry", onClick: vi.fn() }} /></ToastProvider>);
    const toasts = screen.getAllByRole("alert");
    expect(toasts.length).toBeGreaterThan(0);

    // Wait for next tick to ensure focus didn't move (yielding event loop)
    await new Promise(resolve => setTimeout(resolve, 0));

    const actionButton = screen.getByRole("button", { name: "Retry" });
    expect(actionButton).toBeInTheDocument();
    expect(document.activeElement).not.toBe(actionButton);
  });

  it("retry/dismiss controls have accessible names including status", () => {
    render(<ToastProvider><TestComponent type="error" /></ToastProvider>);
    const dismissBtn = screen.getByRole("button", { name: "Dismiss error message" });
    expect(dismissBtn).toBeInTheDocument();
  });
});
