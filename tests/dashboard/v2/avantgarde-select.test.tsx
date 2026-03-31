/* eslint-disable */
import * as React from "preact/compat";
/**
 * @vitest-environment jsdom
 */
import { h, Fragment } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/preact";
import { AvantgardeSelect } from "../../../dashboard/src/v2/components/ui/AvantgardeSelect.js";

describe("AvantgardeSelect", () => {
  afterEach(() => {
    cleanup();
  });

  it("supports keyboard navigation", () => {
    const onChange = vi.fn();
    const options = [
      { value: "1", label: "Option 1" },
      { value: "2", label: "Option 2" },
      { value: "3", label: "Option 3" },
    ];
    const { getByRole, getByText } = render(
      <AvantgardeSelect value="1" onChange={onChange} options={options} aria-label="Test Select" />
    );

    const trigger = getByText("Option 1").closest("button")!;

    // Open dropdown via down arrow on trigger
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = getByRole("listbox");
    expect(listbox).toBeDefined();

    // Keyboard navigation
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowUp" });

    // Select an option with Enter
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("handles Home, End, and Escape keys", () => {
    const onChange = vi.fn();
    const options = [
      { value: "1", label: "Option 1" },
      { value: "2", label: "Option 2" },
      { value: "3", label: "Option 3" },
    ];
    const { getByRole, getByText } = render(
      <AvantgardeSelect value="1" onChange={onChange} options={options} />
    );

    const trigger = getByText("Option 1").closest("button")!;

    // Open
    fireEvent.click(trigger);
    const listbox = getByRole("listbox");

    // Home
    fireEvent.keyDown(listbox, { key: "End" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("3");

    // Re-open
    fireEvent.click(trigger);
    const listbox2 = getByRole("listbox");
    fireEvent.keyDown(listbox2, { key: "Home" });
    fireEvent.keyDown(listbox2, { key: " " });
    expect(onChange).toHaveBeenCalledWith("1");

    // Escape closes
    fireEvent.click(trigger);
    const listbox3 = getByRole("listbox");
    fireEvent.keyDown(listbox3, { key: "Escape" });

  });
});
