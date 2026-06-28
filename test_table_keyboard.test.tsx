/** @vitest-environment jsdom */
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Table, TableHeader, TableBody, TableRow, TableCell } from "./dashboard/src/v2/components/ui/Table.js";
import { expect, test, vi } from "vitest";

test("TableRow keyboard support", () => {
  const onClick = vi.fn();
  render(
    <Table>
      <TableBody>
        <TableRow onClick={onClick} data-testid="row">
          <TableCell>Data</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );

  const row = screen.getByTestId("row");
  fireEvent.keyDown(row, { key: "Enter" });
  expect(onClick).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(row, { key: " " });
  expect(onClick).toHaveBeenCalledTimes(2);
});
