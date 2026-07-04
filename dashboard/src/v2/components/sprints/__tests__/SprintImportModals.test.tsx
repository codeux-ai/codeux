// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

import { SprintIssueImportModal } from "../SprintIssueImportModal.js";
import { SprintJiraImportModal } from "../SprintJiraImportModal.js";
import type { ProjectSummary } from "../../../types.js";

expect.extend(matchers);

const searchProjectIssues = vi.fn();
const searchJiraIssues = vi.fn();
const fetchProjectIssuePromptContexts = vi.fn();
const fetchProjectEffectiveSettings = vi.fn();

vi.mock("../../../lib/project-api.js", () => ({
  searchProjectIssues: (...args: unknown[]) => searchProjectIssues(...args),
  searchJiraIssues: (...args: unknown[]) => searchJiraIssues(...args),
  fetchProjectIssuePromptContexts: (...args: unknown[]) => fetchProjectIssuePromptContexts(...args),
}));

vi.mock("../../../lib/settings-api.js", () => ({
  fetchProjectEffectiveSettings: (...args: unknown[]) => fetchProjectEffectiveSettings(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const project: ProjectSummary = {
  id: "project-1",
  slug: "simple-test",
  name: "Simple Test",
  baseDir: "/workspace/simple-test",
  repoUrl: "https://github.com/codeux-ai/codeux.git",
  sourceType: "git",
  sourceRef: "https://github.com/codeux-ai/codeux.git",
  gitProvider: "github",
  gitHostDomain: "github.com",
  defaultBranch: "dev",
  featureBranchPrefix: null,
  status: "idle",
  sprintsCount: 0,
  openTasks: 0,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("Sprint import modals", () => {
  it("labels repository issue filters and announces the empty state", async () => {
    searchProjectIssues.mockResolvedValue([]);

    render(
      <SprintIssueImportModal
        project={project}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Import Backlog Scope" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Repository" })).toHaveValue("codeux-ai/codeux");
    expect(screen.getByRole("textbox", { name: "Search issues" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Issue state" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("No issues found for the current filters.");
    });
  });

  it("labels Jira filters and announces the empty state", async () => {
    fetchProjectEffectiveSettings.mockResolvedValue({
      settings: { jira: { defaultProject: "OPS" } },
      sources: {},
    });
    searchJiraIssues.mockResolvedValue([]);

    render(
      <SprintJiraImportModal
        projectId="project-1"
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Import Backlog Scope" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Jira project key" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search Jira issues" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Jira status" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Jira assignee" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("No Jira issues found for the current filters.");
    });
  });
});
