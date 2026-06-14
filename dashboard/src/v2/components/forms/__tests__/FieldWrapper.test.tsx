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

  it("wires label, input, and error message with auto-generated id", () => {
    render(
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

  it("adds error styling and animations when error is present", async () => {
    const { container, rerender } = render(
      <FieldWrapper label="Test Label" htmlFor="test-input">
        <input id="test-input" type="text" />
      </FieldWrapper>
    );

    // No error initially
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

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
});
