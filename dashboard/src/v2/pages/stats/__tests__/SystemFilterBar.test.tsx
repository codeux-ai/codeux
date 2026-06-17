/**
 * @vitest-environment jsdom
 */
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { SystemFilterBar } from "../components/system/SystemFilterBar.js";
import type { SystemFilters } from "../hooks/use-system-view-data.js";

afterEach(() => {
  cleanup();
});

function Harness({
  initialFilters,
  initialSearch = "",
  availablePurposes = ["cli_task_coding", "planning"],
  availableProviders = ["gemini", "codex"],
}: {
  initialFilters: SystemFilters;
  initialSearch?: string;
  availablePurposes?: string[];
  availableProviders?: string[];
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState(initialSearch);

  return (
    <SystemFilterBar
      filters={filters}
      onFiltersChange={setFilters}
      search={search}
      onSearchChange={setSearch}
      availablePurposes={availablePurposes}
      availableProviders={availableProviders}
      totalCount={24}
      filteredCount={7}
    />
  );
}

describe("SystemFilterBar", () => {
  it("toggles active chip styles and updates search and clear state", () => {
    const { getByRole, getByLabelText, getByPlaceholderText } = render(
      <Harness initialFilters={{ status: [], purpose: [], provider: [] }} initialSearch="alpha" />
    );

    const runningButton = getByRole("button", { name: "Running" });
    expect(runningButton.className).not.toContain("border-blue-500/40");

    fireEvent.click(runningButton);
    expect(runningButton.className).toContain("border-blue-500/40");
    expect(runningButton.className).toContain("text-blue-300");

    const searchInput = getByPlaceholderText("Search system stats") as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: "beta" } });
    expect(searchInput.value).toBe("beta");

    const clearSearch = getByLabelText("Clear search");
    fireEvent.click(clearSearch);
    expect(searchInput.value).toBe("");

    const clearAll = getByRole("button", { name: "Clear all" });
    fireEvent.click(clearAll);

    expect(runningButton.className).not.toContain("border-blue-500/40");
    expect(searchInput.value).toBe("");
  });

  it("renders without purpose or provider chips when those arrays are empty", () => {
    const { queryByText } = render(
      <Harness
        initialFilters={{ status: [], purpose: [], provider: [] }}
        availablePurposes={[]}
        availableProviders={[]}
      />
    );

    expect(queryByText("Purposes")).toBeNull();
    expect(queryByText("Providers")).toBeNull();
  });
});
