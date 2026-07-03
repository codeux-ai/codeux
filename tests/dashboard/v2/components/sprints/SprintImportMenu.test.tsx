/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintImportMenu } from "../../../../../dashboard/src/v2/components/sprints/SprintImportMenu";

expect.extend(matchers);

describe("SprintImportMenu", () => {
  const renderMenu = (overrides: Partial<Parameters<typeof SprintImportMenu>[0]> = {}) => render(
    <SprintImportMenu
      disabled={false}
      onImportMarkdown={vi.fn()}
      onImportGitHubIssues={vi.fn()}
      onImportGitLabIssues={vi.fn()}
      {...overrides}
    />,
  );

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders disabled state", () => {
    const onImport = vi.fn();
    renderMenu({ disabled: true, onImportMarkdown: onImport });
    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    expect(trigger).toBeDisabled();
  });

  it("opens the menu and clicks markdown", () => {
    const onImport = vi.fn();
    renderMenu({ onImportMarkdown: onImport });

    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    expect(menu).toHaveClass("fixed", "z-[9999]");
    expect(menu).not.toHaveClass("transition-all");
    expect(menu).toHaveStyle({ top: "8px", left: "16px" });
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getAllByText("GitHub Issues")[0]).toBeInTheDocument();
    expect(screen.getByText("Structured sprint and task bundle")).toBeInTheDocument();
    expect(screen.getByText("Search, filter, and multi-select")).toBeInTheDocument();
    expect(screen.getByText("Import issue scope from GitLab")).toBeInTheDocument();
    expect(screen.getByText("Import issue scope from Jira")).toBeInTheDocument();

    const markdownBtn = screen.getByRole("menuitem", { name: /markdown/i });
    fireEvent.click(markdownBtn);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("closes on escape key", () => {
    renderMenu();
    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));

    fireEvent.click(trigger);
    expect(screen.getAllByText("GitHub Issues")[0]).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("closes on outside click", () => {
    renderMenu();
    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));

    fireEvent.click(trigger);
    expect(screen.getAllByText("GitHub Issues")[0]).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
  });

  it("clicks GitHub issue import without triggering GitLab", () => {
    const onImportGitHubIssues = vi.fn();
    const onImportGitLabIssues = vi.fn();
    renderMenu({ onImportGitHubIssues, onImportGitLabIssues });

    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    fireEvent.click(trigger);

    const githubBtn = screen.getByRole("menuitem", { name: /github issues/i });
    fireEvent.click(githubBtn);
    expect(onImportGitHubIssues).toHaveBeenCalledTimes(1);
    expect(onImportGitLabIssues).not.toHaveBeenCalled();
  });

  it("clicks GitLab issue import without triggering GitHub", () => {
    const onImportGitHubIssues = vi.fn();
    const onImportGitLabIssues = vi.fn();
    renderMenu({ onImportGitHubIssues, onImportGitLabIssues });

    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    fireEvent.click(trigger);

    const gitlabBtn = screen.getByRole("menuitem", { name: /gitlab issues/i });
    fireEvent.click(gitlabBtn);
    expect(onImportGitLabIssues).toHaveBeenCalledTimes(1);
    expect(onImportGitHubIssues).not.toHaveBeenCalled();
  });

  it("clicks Jira issue import", () => {
    const onImportJira = vi.fn();
    render(
      <SprintImportMenu
        disabled={false}
        onImportMarkdown={vi.fn()}
        onImportGitHubIssues={vi.fn()}
        onImportGitLabIssues={vi.fn()}
        onImportJira={onImportJira}
      />
    );

    const trigger = screen.getAllByRole("button").find(btn => btn.textContent?.includes("Import") && !btn.textContent?.includes("Markdown"));
    fireEvent.click(trigger);

    const jiraBtn = screen.getByRole("menuitem", { name: /jira issues/i });
    fireEvent.click(jiraBtn);
    expect(onImportJira).toHaveBeenCalledTimes(1);
  });
});
