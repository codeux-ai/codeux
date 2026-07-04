// @vitest-environment jsdom
import { render, screen } from "@testing-library/preact";
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
import { Table, TableHeader, TableBody, TableRow, TableCell } from "../Table";
import { ListWindowSelector } from "../ListWindowSelector";

describe("Table component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a table with appropriate roles and structure", () => {
    render(
      <Table ariaLabel="Test Table">
        <TableHeader>
          <TableCell isHeader>Header 1</TableCell>
          <TableCell isHeader>Header 2</TableCell>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Data 1</TableCell>
            <TableCell>Data 2</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const table = screen.getByRole("table", { name: "Test Table" });
    expect(table).toBeInTheDocument();

    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent("Header 1");

    const rows = screen.getAllByRole("row");
    // 2 rows: one in header, one in body
    expect(rows).toHaveLength(2);

    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveTextContent("Data 1");
  });

  it("renders table caption when provided", () => {
    render(
      <Table caption="Test Caption">
        <TableBody>
          <TableRow>
            <TableCell>Data 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const caption = screen.getByText("Test Caption");
    expect(caption).toBeInTheDocument();
    expect(caption.tagName.toLowerCase()).toBe("caption");
    expect(caption).toHaveClass("sr-only");
  });

  it("adds mobileLabel and displays it when passed to TableCell", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell mobileLabel="Mobile Label 1">Data 1</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    // Using getAllByRole because there might be multiple elements with role cell
    const cells = screen.getAllByRole("cell");
    const mobileLabel = screen.getByText("Mobile Label 1");
    expect(mobileLabel).toBeInTheDocument();
    expect(mobileLabel).toHaveClass("lg:hidden");
    expect(cells[0]).toHaveTextContent("Data 1");
  });

  it("renders inline mobileLabels correctly in block layout", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell mobileLabel="Label A">Data A</TableCell>
            <TableCell mobileLabel="Label B">Data B</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const labelA = screen.getByText("Label A");
    const labelB = screen.getByText("Label B");
    expect(labelA).toBeInTheDocument();
    expect(labelB).toBeInTheDocument();
    expect(labelA).toHaveClass("inline-flex", "lg:hidden");
    expect(labelB).toHaveClass("inline-flex", "lg:hidden");
  });

  it("applies aria-selected when TableRow is selected", () => {
    const { rerender } = render(
      <Table>
        <TableBody>
          <TableRow selected={true}>
            <TableCell>Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const rowTrue = screen.getAllByRole("row")[0];
    expect(rowTrue).toHaveAttribute("aria-selected", "true");

    rerender(
      <Table>
        <TableBody>
          <TableRow selected={false}>
            <TableCell>Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const rowFalse = screen.getAllByRole("row")[0];
    expect(rowFalse).toHaveAttribute("aria-selected", "false");
  });

  it("renders a sort button when isHeader is true and onSort is provided", () => {
    const handleSort = vi.fn();
    render(
      <Table>
        <TableHeader>
          <TableCell isHeader onSort={handleSort} ariaSort="ascending" sortLabel="Sort by sortable header">Sortable Header</TableCell>
        </TableHeader>
      </Table>
    );

    const header = screen.getByRole("columnheader", { name: /Sortable Header/ });
    expect(header).toHaveAttribute("aria-sort", "ascending");

    const button = screen.getByRole("button", { name: "Sort by sortable header, sorted ascending" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Sortable Header");
    expect(button).toHaveTextContent("sorted ascending");

    button.click();
    expect(handleSort).toHaveBeenCalledTimes(1);
  });

  it("announces result counts and busy table refresh state when provided", () => {
    render(
      <Table ariaLabel="Busy Table" resultCount={3} resultLabel="results" busy>
        <TableBody>
          <TableRow>
            <TableCell>Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    expect(screen.getByRole("table", { name: "Busy Table" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Updating 3 results shown.");
  });

  it("handles long continuous strings without breaking mobile layout", () => {
    const longString = "verylongstringwithoutspacesthatmightoverflowthecontainer".repeat(5);

    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell mobileLabel="Label">{longString}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const cell = screen.getByRole("cell");
    expect(cell).toHaveClass("break-words", "min-w-0");

    const innerContainer = cell.querySelector("div");
    expect(innerContainer).toHaveClass("break-words", "min-w-0", "flex-1", "lg:contents");
  });

  it("announces list window ranges with reduced-motion-safe transition classes", () => {
    render(
      <ListWindowSelector
        value={20}
        onChange={vi.fn()}
        totalItems={45}
        visibleCount={20}
        itemLabel="tasks"
        ariaLabel="Select number of task rows"
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 to 20 of 45 tasks.");
    const selector = document.querySelector("[data-list-window-selector]") as HTMLElement;
    expect(selector.style.transitionDuration).toBeTruthy();
    expect(document.querySelector(".motion-reduce\\:transition-none")).toBeTruthy();
  });
});
