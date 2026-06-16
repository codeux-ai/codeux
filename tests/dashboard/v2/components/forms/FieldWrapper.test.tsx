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

  it("passes helperText, error, and aria attributes properly", () => {
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
    const expectedErrorId = undefined;

    expect(input?.getAttribute("aria-describedby")).toBe(expectedHelperId);
    expect(input?.getAttribute("aria-errormessage")).toBe(null);
    expect(input?.hasAttribute("aria-invalid")).toBe(false);

    // Add error
    rerender(
      <FieldWrapper label="Email" helperText="Enter a valid email" error="Invalid format">
        <input type="text" />
      </FieldWrapper>
    );

    const inputAfter = container.querySelector('input');

    // Trigger blur
    inputAfter!.focus();
    inputAfter!.blur();

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

    // Set an error
    rerender(
      <FieldWrapper label="Email" error="First error">
        <input type="text" />
      </FieldWrapper>
    );

    expect(getShakeContainer()).not.toBeNull();

    // Advance time past the shake timer (400ms)
    vi.advanceTimersByTime(450);

    rerender(
      <FieldWrapper label="Email" error="First error">
        <input type="text" />
      </FieldWrapper>
    );

    // Should NOT shake again because error is the same
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
