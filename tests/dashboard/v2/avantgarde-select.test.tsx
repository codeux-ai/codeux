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

  it("filters options by search text when searchable", () => {
    const options = [
      { value: "1", label: "Anthropic" },
      { value: "2", label: "OpenAI" },
    ];
    render(<AvantgardeSelect value="" onChange={() => {}} options={options} searchable />);
    fireEvent.click(screen.getByText("Select\u2026"));

    const search = screen.getByPlaceholderText("Search...");
    fireEvent.input(search, { target: { value: "open" } });

    expect(screen.queryByText("OpenAI")).not.toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("offers a custom-value option when nothing matches and allowCustomValue is set", () => {
    const onChange = vi.fn();
    const options = [{ value: "1", label: "Anthropic" }];
    render(
      <AvantgardeSelect value="" onChange={onChange} options={options} searchable allowCustomValue />
    );
    fireEvent.click(screen.getByText("Select\u2026"));

    const search = screen.getByPlaceholderText("Search...");
    fireEvent.input(search, { target: { value: "my-custom-model" } });

    const customOption = screen.getByText('Use "my-custom-model"');
    fireEvent.click(customOption);

    expect(onChange).toHaveBeenCalledWith("my-custom-model");
  });

  it("does not offer a custom-value option when the search text already matches an option", () => {
    const options = [{ value: "1", label: "Anthropic" }];
    render(
      <AvantgardeSelect value="" onChange={() => {}} options={options} searchable allowCustomValue />
    );
    fireEvent.click(screen.getByText("Select\u2026"));

    const search = screen.getByPlaceholderText("Search...");
    fireEvent.input(search, { target: { value: "Anthropic" } });

    expect(screen.queryByText('Use "Anthropic"')).toBeNull();
  });

  it("caps rendered options via maxVisibleOptions without limiting what search can match", () => {
    const options = Array.from({ length: 20 }, (_, i) => ({ value: `${i}`, label: `Option ${i}` }));
    render(
      <AvantgardeSelect value="" onChange={() => {}} options={options} searchable maxVisibleOptions={5} placeholder="Pick" />
    );
    fireEvent.click(screen.getByText("Pick"));

    // Unfiltered: capped to 5 even though 20 options exist.
    expect(screen.getAllByText(/^Option \d+$/).length).toBe(5);

    // Still searchable across the full underlying set, just capped again after matching.
    const search = screen.getByPlaceholderText("Search...");
    fireEvent.input(search, { target: { value: "Option 1" } });
    // Matches "Option 1", "Option 10".."Option 19" (11 matches) but stays capped at 5.
    expect(screen.getAllByText(/^Option 1\d?$/).length).toBeLessThanOrEqual(5);
    expect(screen.queryByText("Option 1")).not.toBeNull();
  });

  it("focuses the search input by default when a searchable select opens", async () => {
    const options = [{ value: "1", label: "Anthropic" }, { value: "2", label: "OpenAI" }];
    render(<AvantgardeSelect value="" onChange={() => {}} options={options} searchable placeholder="Pick" />);
    fireEvent.click(screen.getByText("Pick"));

    const search = await screen.findByPlaceholderText("Search...");
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it("keeps the search input focused through a reposition (scroll/resize) while typing", async () => {
    const options = [{ value: "1", label: "Anthropic" }, { value: "2", label: "OpenAI" }];
    render(<AvantgardeSelect value="" onChange={() => {}} options={options} searchable placeholder="Pick" />);
    fireEvent.click(screen.getByText("Pick"));

    const search = await screen.findByPlaceholderText("Search...");
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.input(search, { target: { value: "o" } });
    // A reposition (e.g. from the filtered list's height changing) must not steal focus back
    // to the listbox container.
    fireEvent.scroll(window);
    expect(document.activeElement).toBe(search);
  });
});
