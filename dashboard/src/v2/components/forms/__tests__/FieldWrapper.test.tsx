/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { FieldWrapper } from "../FieldWrapper";
import { Input } from "../../ui/Input";

describe("FieldWrapper", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("renders children and label correctly", () => {
    render(
      <FieldWrapper label="Test Label" htmlFor="test-input">
        <input id="test-input" type="text" />
      </FieldWrapper>
    );

    expect(screen.getByText("Test Label")).toBeInTheDocument();
  });

  it("wires label, input, and error message with auto-generated id after blur", () => {
    const { rerender } = render(
      <FieldWrapper label="Email" error="Required">
        <Input />
      </FieldWrapper>
    );

    const label = screen.getByText("Email");
    const input = screen.getByRole("textbox");

    const htmlFor = label.getAttribute("for");
    const id = input.getAttribute("id");

    expect(htmlFor).not.toBeNull();
    expect(htmlFor).not.toBe("");
    expect(htmlFor).not.toBe("undefined");
    expect(htmlFor).toEqual(id);

    // Error is hidden before blur
    expect(input).not.toHaveAttribute("aria-invalid", "true");

    // Trigger blur to show error
    input.focus();
    input.blur();

    rerender(
      <FieldWrapper label="Email" error="Required">
        <Input />
      </FieldWrapper>
    );

    expect(input).toHaveAttribute("aria-invalid", "true");

    const ariaErrormessage = input.getAttribute("aria-errormessage");
    expect(ariaErrormessage).not.toBeNull();

    const errorElement = screen.getByText("Required");
    expect(errorElement.getAttribute("id")).toEqual(ariaErrormessage);
  });

  it("uses explicit htmlFor when provided", () => {
    render(
      <FieldWrapper label="Email" htmlFor="my-email" error="Required">
        <Input id="my-email" />
      </FieldWrapper>
    );

    const label = screen.getByText("Email");
    const input = screen.getByRole("textbox");

    expect(label.getAttribute("for")).toBe("my-email");
    expect(input.getAttribute("id")).toBe("my-email");
  });

  it("adds error styling and animations when error is present and touched", async () => {
    const { container, rerender } = render(
      <FieldWrapper label="Test Label" htmlFor="test-input">
        <input id="test-input" type="text" />
      </FieldWrapper>
    );

    // No error initially
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const input = screen.getByRole("textbox");
    input.focus();
    input.blur();

    // Rerender with error
    rerender(
      <FieldWrapper label="Test Label" htmlFor="test-input" error="Invalid input">
        <input id="test-input" type="text" />
      </FieldWrapper>
    );

    // Verify error message is rendered
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid input");

    // Verify shake animation exists when error appears
    const parentDiv = container.querySelector('label')?.nextElementSibling;
    expect(parentDiv?.className).toContain("animate-form-shake");
  });

  it("shows error immediately when forceTouch is true", () => {
    render(
      <FieldWrapper label="Test Label" htmlFor="test-input" error="Forced error" forceTouch={true}>
        <input id="test-input" type="text" />
      </FieldWrapper>
    );

    // Error is shown immediately without needing blur
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Forced error");
  });

  it("renders helperText and wires aria-describedby correctly", () => {
    render(
      <FieldWrapper label="Test Label" htmlFor="test-input" helperText="This is a helper">
        <Input id="test-input" />
      </FieldWrapper>
    );

    const helperElement = screen.getByText("This is a helper");
    expect(helperElement).toBeInTheDocument();

    const input = screen.getByRole("textbox");
    const ariaDescribedby = input.getAttribute("aria-describedby");
    expect(ariaDescribedby).not.toBeNull();
    expect(helperElement.getAttribute("id")).toEqual(ariaDescribedby);
  });

  it("hides helperText when error is present and touched", () => {
    const { rerender } = render(
      <FieldWrapper label="Test Label" htmlFor="test-input" helperText="Helper" error="Error msg">
        <Input id="test-input" />
      </FieldWrapper>
    );

    const helperElement = screen.getByText("Helper");

    // Trigger blur to show error
    const input = screen.getByRole("textbox");
    input.focus();
    input.blur();

    // Need to trigger a rerender since the touched state update takes effect in the next pass
    rerender(
      <FieldWrapper label="Test Label" htmlFor="test-input" helperText="Helper" error="Error msg">
        <Input id="test-input" />
      </FieldWrapper>
    );

    const errorElement = screen.getByText("Error msg");

    expect(helperElement).toBeInTheDocument();
    expect(errorElement).toBeInTheDocument();

    // The helper text is hidden (collapsed) while an error is shown.
    expect(helperElement.className).toContain("opacity-0");
    expect(helperElement.className).toContain("invisible");

    // The error element is only rendered when there is an error, so its presence
    // is what makes it visible; it animates in via the slide-down keyframes.
    expect(errorElement.className).toContain("text-status-red");
    expect(errorElement.className).toContain("motion-safe:animate-form-slide-down");
  });
});
