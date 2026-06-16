import { h } from "preact";
import { render, screen } from "@testing-library/preact";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { FieldWrapper } from "../../../../../dashboard/src/v2/components/forms/FieldWrapper";
import "@testing-library/jest-dom/vitest";

/** @vitest-environment jsdom */

describe("FieldWrapper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders label and child input", () => {
    render(
      <FieldWrapper label="My Field">
        <input type="text" />
      </FieldWrapper>
    );
    expect(screen.getByText("My Field")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("passes helperText, error, and aria attributes properly", async () => {
    const { rerender, container } = render(
      <FieldWrapper label="Email" helperText="Enter a valid email">
        <input type="text" />
      </FieldWrapper>
    );

    const input = container.querySelector('input');

    // Check helperText
    const helperText = screen.getByText("Enter a valid email");
    expect(helperText).toBeInTheDocument();

    const expectedHelperId = helperText.id;

    expect(input?.getAttribute("aria-describedby")).toBe(expectedHelperId);
    expect(input?.getAttribute("aria-errormessage")).toBe(null);
    expect(input?.hasAttribute("aria-invalid")).toBe(false);

    // Add error
    rerender(
      <FieldWrapper label="Email" helperText="Enter a valid email" error="Invalid format">
        <input type="text" />
      </FieldWrapper>
    );

    let inputAfter = container.querySelector('input');

    // Trigger blur to make error visible
    inputAfter!.focus();
    inputAfter!.blur();

    // Re-render again after state update (blur -> touched=true) to apply ARIA correctly from touched state change
    rerender(
      <FieldWrapper label="Email" helperText="Enter a valid email" error="Invalid format">
        <input type="text" />
      </FieldWrapper>
    );

    inputAfter = container.querySelector('input');
    const errorText = screen.getByText("Invalid format");
    expect(errorText).toBeInTheDocument();
    expect(inputAfter?.getAttribute("aria-invalid")).toBe("true");
    expect(inputAfter?.getAttribute("aria-errormessage")).toBe(errorText.id);
    expect(inputAfter?.getAttribute("aria-describedby")).toBe(`${expectedHelperId} ${errorText.id}`);
  });

  it("triggers shake only when error changes to a new truthy value", async () => {
    const { rerender, container } = render(
      <FieldWrapper label="Email">
        <input type="text" />
      </FieldWrapper>
    );

    const getShakeContainer = () => container.querySelector(".motion-safe\\:animate-form-shake");

    expect(getShakeContainer()).toBeNull();

    const input = container.querySelector('input');
    input!.focus();
    input!.blur();

    // Re-render after state change to lock in touched state
    rerender(
      <FieldWrapper label="Email">
        <input type="text" />
      </FieldWrapper>
    );

    // Set an error
    rerender(
      <FieldWrapper label="Email" error="First error">
        <input type="text" />
      </FieldWrapper>
    );

    expect(getShakeContainer()).not.toBeNull();

    // Advance time past the shake timer (400ms)
    vi.advanceTimersByTime(450);

    // We must flush promises to let the state update from setTimeout run
    await Promise.resolve();

    // Wait for the shake to finish
    vi.runAllTimers();
    await Promise.resolve();

    // Verify it stopped shaking
    expect(getShakeContainer()).toBeNull();

    // Rerender with SAME error should NOT shake
    rerender(
      <FieldWrapper label="Email" error="First error">
        <input type="text" />
      </FieldWrapper>
    );

    // Give effect a moment to run if it mistakenly does
    vi.runAllTimers();
    await Promise.resolve();

    expect(getShakeContainer()).toBeNull();

    // Change error message
    rerender(
      <FieldWrapper label="Email" error="Second error">
        <input type="text" />
      </FieldWrapper>
    );

    // Should shake again
    expect(getShakeContainer()).not.toBeNull();
  });
});
