/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { SectionNav } from "../../../../src/v2/components/navigation/SectionNav.js";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

describe("SectionNav", () => {
  const items = [
    { id: "section1", label: "Section 1" },
    { id: "section2", label: "Section 2" },
  ];

  beforeEach(() => {
    // Mock window.scrollTo
    window.scrollTo = vi.fn();
    // Mock document.getElementById
    const mockElement = document.createElement("div");
    mockElement.focus = vi.fn();
    vi.spyOn(document, "getElementById").mockReturnValue(mockElement);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders all navigation items", () => {
    render(<SectionNav items={items} />);
    expect(screen.getByText("Section 1")).toBeInTheDocument();
    expect(screen.getByText("Section 2")).toBeInTheDocument();
  });

  it("marks the active item", () => {
    render(<SectionNav items={items} activeId="section1" />);
    const btn = screen.getByRole("button", { name: "Section 1" });
    expect(btn).toHaveClass("text-signal-500");
  });

  it("calls onSelect and scrolls to element on click", () => {
    const onSelect = vi.fn();
    render(<SectionNav items={items} onSelect={onSelect} />);
    
    fireEvent.click(screen.getByText("Section 2"));
    
    expect(onSelect).toHaveBeenCalledWith("section2");
    expect(document.getElementById).toHaveBeenCalledWith("section2");
  });

  it("updates active state when prop changes", () => {
    const { rerender } = render(<SectionNav items={items} activeId="section1" />);
    expect(screen.getByRole("button", { name: "Section 1" })).toHaveClass("text-signal-500");
    
    rerender(<SectionNav items={items} activeId="section2" />);
    expect(screen.getByRole("button", { name: "Section 2" })).toHaveClass("text-signal-500");
  });
});
