/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Pagination } from "../../../../src/v2/components/navigation/Pagination.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe("Pagination", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when totalPages is 1 or less", () => {
    const { container } = render(<Pagination currentPage={1} totalPages={1} onPageChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders correct number of page buttons", () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={1} totalPages={3} onPageChange={onPageChange} />);
    
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks the current page as active", () => {
    render(<Pagination currentPage={2} totalPages={3} onPageChange={() => {}} />);
    
    const activeBtn = screen.getByRole("button", { name: "Go to page 2" });
    expect(activeBtn).toHaveAttribute("aria-current", "page");
    expect(activeBtn).toHaveClass("bg-signal-500");
  });

  it("disables previous button on first page", () => {
    render(<Pagination currentPage={1} totalPages={3} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous Page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next Page" })).not.toBeDisabled();
  });

  it("disables next button on last page", () => {
    render(<Pagination currentPage={3} totalPages={3} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Next Page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous Page" })).not.toBeDisabled();
  });

  it("calls onPageChange when a page button is clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={1} totalPages={3} onPageChange={onPageChange} />);
    
    fireEvent.click(screen.getByText("2"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange when next/prev buttons are clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={2} totalPages={3} onPageChange={onPageChange} />);
    
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Previous Page" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("renders ellipses for many pages", () => {
    render(<Pagination currentPage={5} totalPages={10} onPageChange={() => {}} />);
    expect(screen.getAllByText("...")).toHaveLength(2);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});
