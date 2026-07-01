// @vitest-environment happy-dom
import { h } from "preact";
import { render, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import '@testing-library/jest-dom/vitest';
import { ActionFeedbackRegion } from "../../../../dashboard/src/v2/components/ui/ActionFeedbackRegion.js";

describe("ActionFeedbackRegion", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with appropriate ARIA attributes for alert", () => {
    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="An error occurred" />
    );
    const element = getByRole("alert");
    expect(element).toBeInTheDocument();
    expect(element.getAttribute("aria-live")).toBe("assertive");
    expect(element.getAttribute("aria-atomic")).toBe("true");
    expect(element.textContent).toContain("An error occurred");
  });

  it("renders with appropriate ARIA attributes for status", () => {
    const { getByRole } = render(
      <ActionFeedbackRegion status="success" message="Success message" />
    );
    const element = getByRole("status");
    expect(element).toBeInTheDocument();
    expect(element.getAttribute("aria-live")).toBe("off");
    expect(element.getAttribute("aria-atomic")).toBe("true");
    expect(element.textContent).toContain("Success message");
  });

  it("shows retry button when retryAction is provided", () => {
    const retryAction = () => {};
    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="Error" retryAction={retryAction} />
    );
    const retryButton = getByRole("button", { name: "Retry" });
    expect(retryButton).toBeInTheDocument();
  });

  it("handles retryAction correctly", () => {
    const retryAction = vi.fn();
    const { getByRole } = render(
      <ActionFeedbackRegion status="error" message="Error" retryAction={retryAction} />
    );
    const retryButton = getByRole("button", { name: "Retry" });
    retryButton.click();
    expect(retryAction).toHaveBeenCalledTimes(1);
  });
});
