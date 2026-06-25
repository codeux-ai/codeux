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

    // Click write mode
    tabs[0].click();

    // Now write mode is active, the tabpanel should be the editor (textarea wrapper, no aria-label needed if implicit)
    await waitFor(() => {
      const tabpanels = screen.getAllByRole("tabpanel");
      const editorTabpanel = tabpanels.find(t => t.getAttribute("id") === "markdown-editor");
      expect(editorTabpanel).not.toBeUndefined();
    });
  });
});
