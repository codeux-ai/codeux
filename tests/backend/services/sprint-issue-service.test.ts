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
  it("requires a GitHub token when searching GitHub issues", async () => {
    const runCommand = vi.fn();
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

    await expect(service.searchIssues(project.id, {
      provider: "github",
      search: "import",
      labels: ["ux"],
    })).rejects.toThrow("GitHub token is not configured.");
    expect(runCommand).not.toHaveBeenCalled();
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

  it("requires a GitHub token for GitHub issue prompt context", async () => {
    const runCommand = vi.fn();
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

    await expect(service.getIssuePromptContexts(project.id, [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      includeConversation: true,
    }])).rejects.toThrow("GitHub token is not configured.");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("loads Jira issue prompt context with comments when requested", async () => {
    const jiraApiClient = {
      getIssue: vi.fn(async () => ({
        key: "OPS-123",
        title: "Ship Jira import",
        url: "https://acme.atlassian.net/browse/OPS-123",
        state: "In Progress",
        labels: ["integration"],
        assignees: ["Pierre"],
        projectKey: "OPS",
        descriptionMarkdown: "Full Jira description",
        commentsMarkdown: "##### Comment 1 - @unknown\n\nJira comment",
      })),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        jira: {
          ...DEFAULT_DASHBOARD_SETTINGS.jira,
          host: "https://acme.atlassian.net",
          email: "ops@acme.test",
          apiToken: "jira-token",
        },
      }),
      jiraApiClient: jiraApiClient as any,
    });

    const contexts = await service.getIssuePromptContexts(project.id, [{
      provider: "jira",
      hostDomain: "acme.atlassian.net",
      repository: "OPS",
      projectKey: "OPS",
      issueNumber: 123,
      issueKey: "OPS-123",
      title: "Ship Jira import",
      url: "https://acme.atlassian.net/browse/OPS-123",
      includeConversation: true,
    }]);

    expect(jiraApiClient.getIssue).toHaveBeenCalledWith(
      "https://acme.atlassian.net",
      "ops@acme.test",
      "jira-token",
      "OPS-123",
    );
    expect(contexts[0]).toEqual(expect.objectContaining({
      provider: "jira",
      issueBodyMarkdown: "Full Jira description",
      issueConversationMarkdown: "##### Comment 1 - @unknown\n\nJira comment",
      labels: ["integration"],
      assignees: ["Pierre"],
    }));
  });

  it("records an error instead of using local gh when auto-closing GitHub issues without a token", async () => {
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

    expect(runCommand).not.toHaveBeenCalled();
    expect(updateSprintLinkedIssueCloseState).toHaveBeenCalledWith("issue-1", expect.objectContaining({
      closeState: "close_failed",
      closeError: "GitHub token is not configured.",
    }));
    expect(result.closed).toBe(0);
    expect(result.failed).toBe(1);
  });
});
