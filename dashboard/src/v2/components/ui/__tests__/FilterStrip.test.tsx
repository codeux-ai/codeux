/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { FilterStrip } from "../FilterStrip.js";

afterEach(() => {
  cleanup();
});

describe("FilterStrip", () => {
  it("supports arrow, Home, and End keyboard selection", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <FilterStrip
        options={[
          { value: "all", label: "All" },
          { value: "running", label: "Running" },
          { value: "done", label: "Done" },
        ] as const}
        active="all"
        onChange={onChange}
      />
    );

    const allTab = getByRole("tab", { name: "All" });
    allTab.focus();

    fireEvent.keyDown(allTab, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("running");

    const runningTab = getByRole("tab", { name: "Running" });
    fireEvent.keyDown(runningTab, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("done");

    const doneTab = getByRole("tab", { name: "Done" });
    fireEvent.keyDown(doneTab, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("all");
  });

  it("skips disabled options and exposes disabled semantics", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <FilterStrip
        options={[
          { value: "all", label: "All" },
          { value: "running", label: "Running", disabled: true },
          { value: "done", label: "Done" },
        ] as const}
        active="all"
        onChange={onChange}
      />
    );

    const runningTab = getByRole("tab", { name: "Running" });
    expect(runningTab.getAttribute("aria-disabled")).toBe("true");

    const allTab = getByRole("tab", { name: "All" });
    fireEvent.keyDown(allTab, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("done");
  });
});
