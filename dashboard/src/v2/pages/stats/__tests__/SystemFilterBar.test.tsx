/**
 * @vitest-environment jsdom
 */
import { useState } from "preact/hooks";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SystemFilterBar } from "../components/system/SystemFilterBar.js";
import type { SystemFilters } from "../hooks/use-system-view-data.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

function Harness({
  initialFilters,
  initialSearch = "",
  availablePurposes = ["cli_task_coding", "planning"],
  availableProviders = ["gemini", "codex"],
  page,
  hasMore,
}: {
  initialFilters: SystemFilters;
  initialSearch?: string;
  availablePurposes?: string[];
  availableProviders?: string[];
  page?: number;
  hasMore?: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(page ?? 0);

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
      page={page === undefined ? undefined : currentPage}
      onPageChange={page === undefined ? undefined : setCurrentPage}
      hasMore={hasMore}
    />
  );
}

describe("SystemFilterBar", () => {
  it("toggles filter groups and updates search and clear state", () => {
    const { getByRole, getByLabelText, getByPlaceholderText } = render(
      <Harness initialFilters={{ status: [], purpose: [], provider: [] }} initialSearch="alpha" />
    );

    const runningButton = getByRole("button", { name: "Running" });
    expect(runningButton).toHaveAttribute("aria-pressed", "false");

    expect(getByRole("group", { name: "Status filters" })).toBeTruthy();
    expect(getByRole("group", { name: "Purposes filters" })).toBeTruthy();
    expect(getByRole("group", { name: "Providers filters" })).toBeTruthy();
    expect(getByRole("group", { name: "Error Category filters" })).toBeTruthy();

    fireEvent.click(runningButton);
    expect(runningButton).toHaveAttribute("aria-pressed", "true");

    const taskCodingButton = getByRole("button", { name: "Cli Task Coding" });
    fireEvent.click(taskCodingButton);
    expect(taskCodingButton).toHaveAttribute("aria-pressed", "true");

    const codexButton = getByRole("button", { name: "Codex" });
    fireEvent.click(codexButton);
    expect(codexButton).toHaveAttribute("aria-pressed", "true");

    const rateLimitButton = getByRole("button", { name: "RateLimit" });
    fireEvent.click(rateLimitButton);
    expect(rateLimitButton).toHaveAttribute("aria-pressed", "true");

    const searchInput = getByPlaceholderText("Search system stats") as HTMLInputElement;
    fireEvent.input(searchInput, { target: { value: "beta" } });
    expect(searchInput.value).toBe("beta");

    const clearSearch = getByLabelText("Clear search");
    fireEvent.click(clearSearch);
    expect(searchInput.value).toBe("");

    const clearAll = getByRole("button", { name: "Clear all" });
    fireEvent.click(clearAll);

    expect(runningButton).toHaveAttribute("aria-pressed", "false");
    expect(taskCodingButton).toHaveAttribute("aria-pressed", "false");
    expect(codexButton).toHaveAttribute("aria-pressed", "false");
    expect(rateLimitButton).toHaveAttribute("aria-pressed", "false");
    expect(searchInput.value).toBe("");
    expect(screen.getByText("Showing 7 of 24")).toBeTruthy();
  });

  it("exposes pagination controls when a server page is provided", () => {
    render(
      <Harness
        initialFilters={{ status: [], purpose: [], provider: [], errorCategories: [] }}
        page={0}
        hasMore={true}
      />,
    );

    expect(screen.getByText("Page 1 · more available")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Invocation pagination" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();

    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);

    expect(screen.getByText("Page 2 · more available")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prev" })).not.toBeDisabled();
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
