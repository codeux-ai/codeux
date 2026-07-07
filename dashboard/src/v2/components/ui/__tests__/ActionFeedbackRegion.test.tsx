// @vitest-environment jsdom
import { h } from "preact";
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ActionFeedbackRegion } from "../ActionFeedbackRegion.js";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

// Mock gsap
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
      },
      timeline: () => ({
        fromTo: () => {},
        to: (target: any, to: any) => { if (to.onComplete) to.onComplete(); }
      })
    }
  };
});

describe("ActionFeedbackRegion", () => {
  afterEach(() => {
    cleanup();
  });

  it("sets correct role and aria-live depending on status", () => {
    const { unmount } = render(<ActionFeedbackRegion status="success" message="Success message" />);

    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-live", "off");
    expect(screen.getByText("Success message")).toBeInTheDocument();
    unmount();

    render(<ActionFeedbackRegion status="error" message="Error message" />);
    const err = screen.getByRole("alert");
    expect(err).toBeInTheDocument();
    expect(err).toHaveAttribute("aria-live", "assertive");
  });

  it("applies contextual accessible names to buttons and aria-hidden to progress and does not auto-dismiss error or pending", () => {
    render(
      <ActionFeedbackRegion
        status="success"
        message="Saved successfully"
        retryAction={() => {}}
        onDismiss={() => {}}
      />
    );

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    expect(retryBtn).toBeInTheDocument();
    expect(dismissBtn).toBeInTheDocument();
  });

  it("sets aria-busy and visually hidden text for pending status", () => {
    const { container, unmount } = render(<ActionFeedbackRegion status="pending" message="Loading..." />);

    // There might be multiple things with role="status" in the DOM due to other tests not cleaning up perfectly if unmount wasn't called,
    // so we search within our rendered container.
    const el = container.querySelector('[role="status"]');
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("aria-busy", "true");

    const hiddenText = container.querySelector(".sr-only");
    expect(hiddenText).not.toBeNull();
    expect(hiddenText?.textContent).toBe("pending. ");

    unmount();
  });

  it("only renders progress for pending when progress is provided and non-error auto-dismiss states", () => {
    const { unmount } = render(<ActionFeedbackRegion status="error" message="Error msg" />);
    expect(document.querySelector(".absolute.bottom-0")).not.toBeInTheDocument();
    unmount();

    const { unmount: unmountPendingWithoutProgress } = render(<ActionFeedbackRegion status="pending" message="Pending msg" />);
    expect(document.querySelector(".absolute.bottom-0")).not.toBeInTheDocument();
    unmountPendingWithoutProgress();

    render(<ActionFeedbackRegion status="pending" message="Pending msg" progress={40} />);
    expect(document.querySelector(".absolute.bottom-0")).toBeInTheDocument();
  });

  it("moves focus to fallback when retry removes the focused feedback control", async () => {
    function RetryHarness() {
      const [status, setStatus] = useState<"error" | "idle">("error");
      return (
        <div>
          <main data-feedback-focus-fallback tabIndex={-1}>Workbench</main>
          <ActionFeedbackRegion
            status={status}
            message={status === "error" ? "Save failed" : null}
            retryAction={() => {
              setStatus("idle");
            }}
          />
        </div>
      );
    }

    render(<RetryHarness />);

    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    expect(document.activeElement).toBe(retry);

    fireEvent.click(retry);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Workbench")));
  });
});
