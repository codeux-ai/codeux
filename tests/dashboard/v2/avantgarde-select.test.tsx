/* eslint-disable */
import * as React from "preact/compat";
/**
 * @vitest-environment happy-dom
 */
import { h, Fragment } from "preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/preact";
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

  it("handles Tab key close and focus return", async () => {
    const options = [{ value: "1", label: "Option 1" }, { value: "2", label: "Option 2" }];
    const { getByRole, getByText, queryByRole } = render(
      <AvantgardeSelect value="1" onChange={() => {}} options={options} />
    );

    const trigger = getByText("Option 1").closest("button")!;
    fireEvent.click(trigger);

    const listbox = getByRole("listbox");
    expect(listbox).toBeDefined();

    fireEvent.keyDown(listbox, { key: "Tab" });

    await waitFor(() => {
      expect(queryByRole("listbox")).toBeNull();
    });
  });

  it("handles Home, End, and Escape keys", async () => {
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

    // End
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
    expect(getByRole("listbox")).toBeDefined();
    fireEvent.keyDown(getByRole("listbox"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("closes when clicking outside", async () => {
    const options = [{ value: "1", label: "Option 1" }];
    const { getByText, queryByRole } = render(
      <div>
        <AvantgardeSelect value="1" onChange={() => {}} options={options} />
        <div id="outside">Outside</div>
      </div>
    );

    fireEvent.click(getByText("Option 1"));
    expect(queryByRole("listbox")).not.toBeNull();

    fireEvent.mouseDown(document.getElementById("outside")!);
    await waitFor(() => {
      expect(queryByRole("listbox")).toBeNull();
    });
  });

  it("remains closed when disabled", () => {
    const { getByText, queryByRole } = render(
      <AvantgardeSelect value="1" onChange={() => {}} options={[{ value: "1", label: "Opt" }]} disabled />
    );
    fireEvent.click(getByText("Opt"));
    expect(queryByRole("listbox")).toBeNull();
  });

  it("renders different variants", () => {
    const options = [{ value: "1", label: "Opt" }];
    const { rerender, container } = render(<AvantgardeSelect value="1" onChange={() => {}} options={options} variant="compact" />);
    expect(container.querySelector(".bg-transparent")).not.toBeNull();

    rerender(<AvantgardeSelect value="1" onChange={() => {}} options={options} variant="card" />);
    expect(container.querySelector(".rounded-\\[1\\.2rem\\]")).not.toBeNull();
  });

  it("handles boundary ancestor for positioning", () => {
    // This is hard to test fully with jsdom but we can at least trigger the code path
    const options = [{ value: "1", label: "Opt" }];
    render(
      <div role="dialog" style={{ height: "100px", overflow: "hidden" }}>
        <AvantgardeSelect value="1" onChange={() => {}} options={options} />
      </div>
    );
    fireEvent.click(screen.getByText("Opt"));
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("handles empty options", () => {
    render(<AvantgardeSelect value="" onChange={() => {}} options={[]} />);
    fireEvent.click(screen.getByText("Select\u2026"));
    expect(screen.getByText("No options available.")).toBeDefined();
  });
});
