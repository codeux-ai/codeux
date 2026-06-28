/** @vitest-environment jsdom */
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Table, TableHeader, TableBody, TableRow, TableCell } from "../../../dashboard/src/v2/components/ui/Table.js";
import { expect, test, vi } from "vitest";
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

test("Table features", () => {
  const onClick = vi.fn();
  const onSort = vi.fn();
  render(
    <Table caption="My Caption" ariaLabel="Test Table">
      <TableHeader>
        <TableCell isHeader onSort={onSort}>Sort me</TableCell>
      </TableHeader>
      <TableBody>
        <TableRow onClick={onClick} selected>
          <TableCell mobileLabel="Mobile Column">Data</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );

  const row = screen.getByRole("row", { selected: true });
  fireEvent.click(row);
  expect(onClick).toHaveBeenCalled();

  const sortBtn = screen.getByRole("button", { name: "Sort me" });
  fireEvent.click(sortBtn);
  expect(onSort).toHaveBeenCalled();
});
