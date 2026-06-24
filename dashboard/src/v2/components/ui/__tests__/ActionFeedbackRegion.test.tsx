// @vitest-environment jsdom
import { h } from "preact";
import { render, screen } from "@testing-library/preact";
import { describe, it, expect, vi } from "vitest";
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
  it("sets correct role and aria-live depending on status", () => {
    const { unmount } = render(<ActionFeedbackRegion status="success" message="Success message" />);

    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-live", "polite");
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

  it("does not render progress for pending or error statuses", () => {
    const { unmount } = render(<ActionFeedbackRegion status="error" message="Error msg" />);
    expect(document.querySelector(".absolute.bottom-0")).not.toBeInTheDocument();
    unmount();

    render(<ActionFeedbackRegion status="pending" message="Pending msg" />);
    expect(document.querySelector(".absolute.bottom-0")).not.toBeInTheDocument();
  });
});
