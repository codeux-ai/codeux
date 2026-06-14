/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { FieldWrapper } from "../FieldWrapper";

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

  it("generates a unique id when htmlFor is not provided", () => {
    render(
      <FieldWrapper label="Name">
        <input type="text" />
      </FieldWrapper>
    );

    const label = screen.getByText("Name");
    const input = screen.getByRole("textbox");

    const htmlFor = label.getAttribute("for");
    const id = input.getAttribute("id");

    expect(htmlFor).not.toBeNull();
    expect(htmlFor).not.toBe("");
    expect(htmlFor).not.toBe("undefined");
    expect(htmlFor).toEqual(id);
  });

  it("uses explicit htmlFor when provided", () => {
    render(
      <FieldWrapper label="Email" htmlFor="email">
        <input type="text" />
      </FieldWrapper>
    );

    const label = screen.getByText("Email");
    const input = screen.getByRole("textbox");

    expect(label.getAttribute("for")).toBe("email");
    expect(input.getAttribute("id")).toBe("email");
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
