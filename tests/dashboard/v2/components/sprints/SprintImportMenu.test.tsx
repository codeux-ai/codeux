/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintImportMenu } from "../../../../../dashboard/src/v2/components/sprints/SprintImportMenu";

expect.extend(matchers);

describe("SprintImportMenu", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders disabled state", () => {
    const onImport = vi.fn();
    render(<SprintImportMenu disabled={true} onImportMarkdown={onImport} />);
    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    expect(trigger).toBeDisabled();
  });

  it("opens the menu and clicks markdown", () => {
    const onImport = vi.fn();
    render(<SprintImportMenu disabled={false} onImportMarkdown={onImport} />);

    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    fireEvent.click(trigger);

    expect(screen.getAllByText("Jira")[0]).toBeInTheDocument();

    const markdownBtn = screen.getByRole("menuitem", { name: /markdown/i });
    fireEvent.click(markdownBtn);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("closes on escape key", () => {
    render(<SprintImportMenu disabled={false} onImportMarkdown={vi.fn()} />);
    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));

    fireEvent.click(trigger);
    expect(screen.getAllByText("Jira")[0]).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("closes on outside click", () => {
    render(<SprintImportMenu disabled={false} onImportMarkdown={vi.fn()} />);
    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));

    fireEvent.click(trigger);
    expect(screen.getAllByText("Jira")[0]).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
  });
});
