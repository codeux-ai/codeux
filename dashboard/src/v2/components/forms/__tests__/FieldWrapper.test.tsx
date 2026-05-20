/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { FieldWrapper } from "../FieldWrapper";

describe("FieldWrapper", () => {
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
