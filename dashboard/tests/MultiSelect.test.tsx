/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, screen } from "@testing-library/preact";
import { MultiSelect } from "../src/v2/components/ui/MultiSelect";
import { expect, test, vi, afterEach } from "vitest";

afterEach(() => {
  document.body.innerHTML = '';
});

test("MultiSelect allows adding and removing tags", () => {
  const onChange = vi.fn();
  const { rerender } = render(<MultiSelect value={[]} onChange={onChange} ariaLabel="Tags" />);

  const input = screen.getByRole("combobox", { name: "Tags" });

  // Add a tag
  fireEvent.input(input, { target: { value: "bug" } });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(onChange).toHaveBeenCalledWith(["bug"]);
  expect(screen.getByText("Added bug")).toBeTruthy();

  // Rerender with new value
  rerender(<MultiSelect value={["bug"]} onChange={onChange} />);
  expect(screen.getByText("bug")).toBeTruthy();

  // Add another tag via comma
  fireEvent.input(input, { target: { value: "feature" } });
  fireEvent.keyDown(input, { key: "," });

  expect(onChange).toHaveBeenCalledWith(["bug", "feature"]);
  expect(screen.getByText("Added feature")).toBeTruthy();

  // Rerender with new values
  rerender(<MultiSelect value={["bug", "feature"]} onChange={onChange} />);

  // Remove first tag
  const removeButtons = screen.getAllByRole("button", { name: /Remove/ });
  fireEvent.click(removeButtons[0]);

  expect(onChange).toHaveBeenCalledWith(["feature"]);
  expect(screen.getByText("Removed bug")).toBeTruthy();
  expect(document.activeElement).toBe(input);
});

test("MultiSelect removes last tag on backspace when input is empty", () => {
  const onChange = vi.fn();
  render(<MultiSelect value={["bug", "feature"]} onChange={onChange} />);

  const input = screen.getByRole("combobox");

  // Backspace with empty input
  fireEvent.keyDown(input, { key: "Backspace" });

  expect(onChange).toHaveBeenCalledWith(["bug"]);
  expect(screen.getByText("Removed feature")).toBeTruthy();
});

test("MultiSelect ignores duplicate tags and announces them", () => {
  const onChange = vi.fn();
  render(<MultiSelect value={["bug"]} onChange={onChange} />);

  const input = screen.getByRole("combobox");

  fireEvent.input(input, { target: { value: "bug" } });
  fireEvent.keyDown(input, { key: "Enter" });

  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText("bug is already selected")).toBeTruthy();
});
