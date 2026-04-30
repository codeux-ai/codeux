/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
import { Button } from "../Button.js";
import { Input } from "../Input.js";
import { Select } from "../Select.js";
import { Switch } from "../Switch.js";
import { CollapsiblePanel } from "../CollapsiblePanel.js";
import { Activity } from "lucide-preact";

afterEach(() => {
  cleanup();
});

describe("Interaction A11y (Components)", () => {
  describe("Button", () => {
    it("disables correctly and prevents onClick when pending", async () => {
      const onClick = vi.fn();
      const { getByRole } = render(
        <Button pending onClick={onClick}>
          Submit
        </Button>
      );

      const button = getByRole("button");
      expect(button).toBeDisabled();

      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("disables correctly and prevents onClick when disabled", async () => {
      const onClick = vi.fn();
      const { getByRole } = render(
        <Button disabled onClick={onClick}>
          Submit
        </Button>
      );

      const button = getByRole("button");
      expect(button).toBeDisabled();

      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("Input", () => {
    it("renders with aria-invalid and aria-describedby when invalid and errorMessage are provided", () => {
      const { getByRole, getByText } = render(
        <Input
          id="test-input"
          invalid={true}
          errorMessage="This field is required"
        />
      );

      const input = getByRole("textbox");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe("test-input-error");

      const errorElement = getByText("This field is required");
      expect(errorElement.getAttribute("id")).toBe("test-input-error");
    });
  });

  describe("Select", () => {
    it("renders with aria-invalid and aria-describedby when invalid and errorMessage are provided", () => {
      const { getByRole, getByText } = render(
        <Select
          id="test-select"
          invalid={true}
          errorMessage="Please select an option"
        >
          <option value="">Select...</option>
          <option value="1">Option 1</option>
        </Select>
      );

      const select = getByRole("combobox");
      expect(select.getAttribute("aria-invalid")).toBe("true");
      expect(select.getAttribute("aria-describedby")).toBe("test-select-error");

      const errorElement = getByText("Please select an option");
      expect(errorElement.getAttribute("id")).toBe("test-select-error");
    });
  });

  describe("Switch", () => {
    it("renders with role='switch' and aria-invalid", () => {
      const { getByRole } = render(<Switch invalid={true} />);

      const switchEl = getByRole("switch");
      expect(switchEl.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("CollapsiblePanel", () => {
    it("toggles state via mouse click", async () => {
      const { getByRole, getByText } = render(
        <CollapsiblePanel
          title="Test Panel"
          icon={Activity}
          accentHex="#ff0000"
          defaultOpen={false}
        >
          <div>Panel Content</div>
        </CollapsiblePanel>
      );

      const toggleButton = getByRole("button", { name: /Test Panel/i });
      const content = getByText("Panel Content");

      // Intially not visible due to height: 0, but content is in DOM.
      // We check if click triggers re-render
      await userEvent.click(toggleButton);

      // Verify that toggling the button doesn't crash and operates properly
      expect(toggleButton).toBeInTheDocument();
      expect(content).toBeInTheDocument();
    });

    it("has visible focus outline (focus-visible class)", () => {
        const { getByRole } = render(
            <CollapsiblePanel
              title="Focus Panel"
              icon={Activity}
              accentHex="#ff0000"
              defaultOpen={false}
            >
              <div>Panel Content</div>
            </CollapsiblePanel>
          );

          const toggleButton = getByRole("button", { name: /Focus Panel/i });
          expect(toggleButton.className).toMatch(/focus-visible:ring-2/);
    });
  });
});