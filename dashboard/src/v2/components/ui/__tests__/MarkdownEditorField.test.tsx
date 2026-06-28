/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { MarkdownEditorField } from "../MarkdownEditorField";

describe("MarkdownEditorField Accessibility", () => {
  it("renders correctly with tablist, tabs, and tabpanels", async () => {
    render(
      <MarkdownEditorField
        value="Initial Content"
        onChange={() => {}}
      />
    );

    const tablist = screen.getByRole("tablist", { name: "Markdown Editor Mode" });
    expect(tablist).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent(/Write/i);
    expect(tabs[1]).toHaveTextContent(/Preview/i);

    // Initial state is preview because value has content
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");

    const tabpanel = screen.getByRole("tabpanel", { name: "Markdown Preview" });
    expect(tabpanel).toBeInTheDocument();
    expect(tabpanel).toHaveAttribute("aria-labelledby", "md-tab-preview");

    expect(tabs[0]).not.toHaveAttribute("aria-pressed");
    expect(tabs[1]).not.toHaveAttribute("aria-pressed");

    // Click write mode
    tabs[0].click();

    // Now write mode is active, the tabpanel should be the editor (textarea wrapper, no aria-label needed if implicit)
    await waitFor(() => {
      const tabpanels = screen.getAllByRole("tabpanel");
      const editorTabpanel = tabpanels.find(t => t.getAttribute("id") === "markdown-editor");
      expect(editorTabpanel).not.toBeUndefined();
      expect(editorTabpanel).toHaveAttribute("aria-labelledby", "md-tab-write");
    });
  });

  it("supports keyboard navigation with arrow keys, home, and end", async () => {
    render(
      <MarkdownEditorField
        value="" // empty initial state means 'write' is active
        onChange={() => {}}
      />
    );

    const tablist = screen.getByRole("tablist", { name: "Markdown Editor Mode" });
    const tabs = screen.getAllByRole("tab");

    // Initially write is active
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    // ArrowRight changes to preview
    tablist.focus();
    const rightEvent = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true });
    tablist.dispatchEvent(rightEvent);

    await waitFor(() => {
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    });

    // ArrowLeft changes back to write
    const leftEvent = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true });
    tablist.dispatchEvent(leftEvent);

    await waitFor(() => {
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    });

    // End changes to preview
    const endEvent = new KeyboardEvent("keydown", { key: "End", bubbles: true });
    tablist.dispatchEvent(endEvent);

    await waitFor(() => {
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    });

    // Home changes to write
    const homeEvent = new KeyboardEvent("keydown", { key: "Home", bubbles: true });
    tablist.dispatchEvent(homeEvent);

    await waitFor(() => {
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    });
  });
});
