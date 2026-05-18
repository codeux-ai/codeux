import { afterEach, describe, expect, it, vi } from "vitest";
import { SprintIssueService } from "../../../src/services/sprint-issue-service.js";
import type { ProjectSummary, SprintLinkedIssueRecord } from "../../../src/contracts/project-management-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const project: ProjectSummary = {
  id: "project-1",
  slug: "project",
  name: "Project",
  baseDir: "/repo",
  repoUrl: "https://github.com/acme/widgets.git",
  sourceType: "git",
  sourceRef: "https://github.com/acme/widgets.git",
  gitProvider: "github",
  gitHostDomain: "github.com",
  defaultBranch: "main",
  featureBranchPrefix: "feature/",
  status: "idle",
  sprintsCount: 0,
  openTasks: 0,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  createdAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SprintIssueService", () => {
  it("falls back to local gh auth when GitHub token is empty", async () => {
    const runCommand = vi.fn(async () => ({
      ok: true,
      stderr: "",
      stdout: JSON.stringify([
        {
          number: 42,
          title: "Improve import UX",
          url: "https://github.com/acme/widgets/issues/42",
          state: "OPEN",
          body: "Make importing issues easier.",
          updatedAt: "2026-05-17T00:00:00.000Z",
          labels: [{ name: "ux" }],
          assignees: [{ login: "pierre" }],
        },
      ]),
    }));

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "",
        },
      }),
      runCommand,
    });

    const issues = await service.searchIssues(project.id, {
      provider: "github",
      search: "import",
      labels: ["ux"],
    });

    expect(runCommand).toHaveBeenCalledWith("gh", expect.arrayContaining([
      "issue",
      "list",
      "--repo",
      "acme/widgets",
      "--search",
      "import",
      "--label",
      "ux",
    ]));
    expect(issues).toEqual([
      expect.objectContaining({
        provider: "github",
        repository: "acme/widgets",
        issueNumber: 42,
        title: "Improve import UX",
        labels: ["ux"],
        assignees: ["pierre"],
      }),
    ]);
  });

  it("loads full GitHub issue prompt context with comments when requested", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/widgets/issues/42")) {
        return new Response(JSON.stringify({
          number: 42,
          title: "Improve import UX",
          html_url: "https://github.com/acme/widgets/issues/42",
          state: "open",
          body: "Full issue body\n\n- acceptance criterion",
          user: { login: "alice" },
          created_at: "2026-05-16T10:00:00.000Z",
          updated_at: "2026-05-17T10:00:00.000Z",
          labels: [{ name: "ux" }],
          assignees: [{ login: "pierre" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/repos/acme/widgets/issues/42/comments?per_page=100")) {
        return new Response(JSON.stringify([
          {
            body: "First comment body",
            html_url: "https://github.com/acme/widgets/issues/42#issuecomment-1",
            user: { login: "bob" },
            created_at: "2026-05-17T11:00:00.000Z",
            updated_at: "2026-05-17T11:30:00.000Z",
          },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "ghp_test",
        },
      }),
    });

    const contexts = await service.getIssuePromptContexts(project.id, [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      issueKey: "#42",
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      includeConversation: true,
    }]);

    expect(contexts[0]).toEqual(expect.objectContaining({
      provider: "github",
      issueBodyMarkdown: "Full issue body\n\n- acceptance criterion",
      issueAuthor: "alice",
      includeConversation: true,
    }));
    expect(contexts[0]?.issueConversationMarkdown).toContain("##### Comment 1 - @bob");
    expect(contexts[0]?.issueConversationMarkdown).toContain("First comment body");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loads GitHub issue text without comments when conversation append is disabled", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      number: 42,
      title: "Improve import UX",
      html_url: "https://github.com/acme/widgets/issues/42",
      state: "open",
      body: "Full issue body",
      user: { login: "alice" },
      labels: [],
      assignees: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "ghp_test",
        },
      }),
    });

    const contexts = await service.getIssuePromptContexts(project.id, [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      includeConversation: false,
    }]);

    expect(contexts[0]?.issueBodyMarkdown).toBe("Full issue body");
    expect(contexts[0]?.issueConversationMarkdown).toBe("");
    expect(contexts[0]?.includeConversation).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads GitHub prompt context through gh issue view when no token is configured", async () => {
    const runCommand = vi.fn(async () => ({
      ok: true,
      stderr: "",
      stdout: JSON.stringify({
        number: 42,
        title: "Improve import UX",
        url: "https://github.com/acme/widgets/issues/42",
        state: "OPEN",
        body: "Full issue body",
        createdAt: "2026-05-16T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        author: { login: "alice" },
        labels: [{ name: "ux" }],
        assignees: [{ login: "pierre" }],
        comments: [
          {
            body: "CLI comment",
            url: "https://github.com/acme/widgets/issues/42#issuecomment-1",
            createdAt: "2026-05-17T11:00:00.000Z",
            author: { login: "bob" },
          },
        ],
      }),
    }));

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "",
        },
      }),
      runCommand,
    });

    const contexts = await service.getIssuePromptContexts(project.id, [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      includeConversation: true,
    }]);

    expect(runCommand).toHaveBeenCalledWith("gh", expect.arrayContaining([
      "issue",
      "view",
      "42",
      "--repo",
      "acme/widgets",
      "--comments",
    ]));
    expect(contexts[0]?.issueBodyMarkdown).toBe("Full issue body");
    expect(contexts[0]?.issueConversationMarkdown).toContain("CLI comment");
  });

  it("falls back to local gh auth when auto-closing linked GitHub issues", async () => {
    const linkedIssue: SprintLinkedIssueRecord = {
      id: "issue-1",
      projectId: project.id,
      sprintId: "sprint-1",
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      issueKey: "#42",
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      state: "open",
      labels: ["ux"],
      assignees: ["pierre"],
      closeState: "open",
      closeError: null,
      closedAt: null,
      createdAt: "2026-05-17T00:00:00.000Z",
    };
    const runCommand = vi.fn(async () => ({ ok: true, stderr: "", stdout: "" }));
    const updateSprintLinkedIssueCloseState = vi.fn();

    const service = new SprintIssueService({
      projectManagementRepository: {
        listSprintLinkedIssues: () => [linkedIssue],
        updateSprintLinkedIssueCloseState,
        getSprint: () => ({ projectId: project.id }),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCloseLinkedIssues: true,
          githubToken: "",
        },
      }),
      runCommand,
    });

    const result = await service.closeLinkedIssues(project.id, "sprint-1");

    expect(runCommand).toHaveBeenCalledWith("gh", [
      "issue",
      "close",
      "42",
      "--repo",
      "acme/widgets",
    ]);
    expect(updateSprintLinkedIssueCloseState).toHaveBeenCalledWith("issue-1", expect.objectContaining({
      closeState: "closed",
      issueState: "closed",
    }));
    expect(result.closed).toBe(1);
  });
});
