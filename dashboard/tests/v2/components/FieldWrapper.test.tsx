/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import { describe, it, expect } from "vitest";
import { FieldWrapper } from "../../../src/v2/components/forms/FieldWrapper";
import { Input } from "../../../src/v2/components/ui/Input";

describe("FieldWrapper Accessibility", () => {
  it("renders a required indicator with screen-reader text", () => {
    const { container, getByText } = render(
      <FieldWrapper label="Test Label" required>
        <Input />
      </FieldWrapper>
    );
    const requiredSrText = getByText("(required)");
    expect(requiredSrText.className).toContain("sr-only");

    const input = container.querySelector("input");
    expect(input?.getAttribute("aria-required")).toBe("true");
  });

  it("links error message stably and supports helperTextId", async () => {
    const { container, getByText, rerender } = render(
      <FieldWrapper label="Test" error="Invalid input" helperTextId="helper-123">
        <Input />
      </FieldWrapper>
    );

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    input!.focus();
    input!.blur();

    rerender(
      <FieldWrapper label="Test" error="Invalid input" helperTextId="helper-123">
        <Input />
      </FieldWrapper>
    );

    const inputId = input!.getAttribute("id");
    expect(inputId).toBeTruthy();

    const errorId = `${inputId}-error`;
    const errorDiv = getByText("Invalid input");
    expect(errorDiv.id).toBe(errorId);

    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-errormessage")).toBe(errorId);

    const ariaDescribedBy = input?.getAttribute("aria-describedby");
    expect(ariaDescribedBy).toBe(`helper-123 ${errorId}`);
  });

  it("supports helperText prop and renders it", () => {
    const { container, getByText } = render(
      <FieldWrapper label="Test" helperText="This is a helper">
        <Input />
      </FieldWrapper>
    );

    const helper = getByText("This is a helper");
    expect(helper).not.toBeNull();

    const input = container.querySelector("input");
    expect(input?.getAttribute("aria-describedby")).toContain(helper.id);
  });

  it("only includes helperTextId in aria-describedby if no error", () => {
    const { container } = render(
      <FieldWrapper label="Test" helperTextId="helper-123">
        <Input />
      </FieldWrapper>
    );

    const input = container.querySelector("input");
    expect(input?.getAttribute("aria-describedby")).toContain("helper-123");
    expect(input?.getAttribute("aria-errormessage")).toBeFalsy();
  });
});
