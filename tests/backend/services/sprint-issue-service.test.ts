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
  lastRunAt: null,
  lastRunStatus: null,
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

  it("defaults GitHub issue search to open issues sorted by updated time", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("sort")).toBe("updated");
      expect(parsed.searchParams.get("order")).toBe("desc");
      expect(parsed.searchParams.get("q")).toContain("repo:acme/widgets");
      expect(parsed.searchParams.get("q")).toContain("is:issue");
      expect(parsed.searchParams.get("q")).toContain("state:open");
      return new Response(JSON.stringify({
        items: [
          {
            number: 7,
            title: "Import backlog",
            html_url: "https://github.com/acme/widgets/issues/7",
            state: "open",
            body: "Short body",
            created_at: "2026-05-17T09:00:00.000Z",
            updated_at: "2026-05-17T10:00:00.000Z",
            labels: [{ name: "ux" }],
            assignees: [{ login: "alice" }],
            user: { login: "bob" },
            milestone: { title: "v1" },
            comments: 3,
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
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

    const issues = await service.searchIssues(project.id, {
      provider: "github",
      repository: "acme/widgets",
      hostDomain: "github.com",
    });

    expect(issues).toEqual([
      expect.objectContaining({
        provider: "github",
        sourceProvider: "github",
        issueAuthor: "bob",
        issueReporter: "bob",
        issueMilestone: "v1",
        issueCommentCount: 3,
        createdAt: "2026-05-17T09:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("translates advanced GitHub and GitLab issue filters into provider queries", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.hostname === "api.github.com") {
        expect(parsed.searchParams.get("sort")).toBe("created");
        expect(parsed.searchParams.get("order")).toBe("asc");
        expect(parsed.searchParams.get("q")).toContain("repo:acme/widgets");
        expect(parsed.searchParams.get("q")).toContain('label:"ux bug"');
        expect(parsed.searchParams.get("q")).toContain("assignee:alice");
        expect(parsed.searchParams.get("q")).toContain("author:bob");
        expect(parsed.searchParams.get("q")).toContain("milestone:v1");
        expect(parsed.searchParams.get("q")).toContain("created:>=2026-05-01");
        expect(parsed.searchParams.get("q")).toContain("updated:<=2026-05-31");
        expect(parsed.searchParams.get("q")).toContain("#42");
        return new Response(JSON.stringify({
          items: [
            {
              number: 42,
              title: "Import backlog",
              html_url: "https://github.com/acme/widgets/issues/42",
              state: "open",
              body: "GitHub body",
              created_at: "2026-05-17T09:00:00.000Z",
              updated_at: "2026-05-17T10:00:00.000Z",
              labels: [{ name: "ux bug" }],
              assignees: [{ login: "alice" }],
              user: { login: "bob" },
              milestone: { title: "v1" },
              comments: 9,
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      expect(parsed.pathname).toContain("/api/v4/projects/acme%2Fwidgets/issues");
      expect(parsed.searchParams.get("state")).toBe("opened");
      expect(parsed.searchParams.get("search")).toBe("issue import");
      expect(parsed.searchParams.get("iids[]")).toBe("123");
      expect(parsed.searchParams.get("labels")).toBe("backend,triage");
      expect(parsed.searchParams.get("assignee_username")).toBe("alice");
      expect(parsed.searchParams.get("author_username")).toBe("carol");
      expect(parsed.searchParams.get("milestone")).toBe("v2");
      expect(parsed.searchParams.get("created_after")).toBe("2026-05-01");
      expect(parsed.searchParams.get("updated_before")).toBe("2026-05-31");
      expect(parsed.searchParams.get("order_by")).toBe("popularity");
      expect(parsed.searchParams.get("sort")).toBe("desc");
      return new Response(JSON.stringify([
        {
          iid: 123,
          title: "Import backlog",
          web_url: "https://gitlab.example.com/acme/widgets/-/issues/123",
          state: "opened",
          description: "GitLab body",
          created_at: "2026-05-17T09:00:00.000Z",
          updated_at: "2026-05-17T10:00:00.000Z",
          labels: ["backend", "triage"],
          assignees: [{ username: "alice", name: "Alice" }],
          author: { username: "carol", name: "Carol" },
          milestone: { name: "v2" },
          issue_type: "Task",
          priority: "high",
          user_notes_count: 4,
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => ({ ...project, gitProvider: "gitlab", gitHostDomain: "gitlab.example.com" }),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "ghp_test",
          gitlabToken: "glpat_test",
        },
      }),
    });

    const [githubIssues, gitlabIssues] = await Promise.all([
      service.searchIssues(project.id, {
        provider: "github",
        repository: "acme/widgets",
        hostDomain: "github.com",
        search: "import backlog",
        labels: ["ux bug"],
        assignee: "alice",
        author: "bob",
        milestone: "v1",
        issueText: "#42",
        createdAfter: "2026-05-01",
        updatedBefore: "2026-05-31",
        sortField: "created",
        sortDirection: "asc",
        limit: 50,
      }),
      service.searchIssues(project.id, {
        provider: "gitlab",
        repository: "acme/widgets",
        hostDomain: "gitlab.example.com",
        search: "issue import",
        labels: ["backend", "triage"],
        assignee: "alice",
        reporter: "carol",
        milestone: "v2",
        issueText: "123",
        createdAfter: "2026-05-01",
        updatedBefore: "2026-05-31",
        sortField: "comments",
        sortDirection: "desc",
        limit: 25,
      }),
    ]);

    expect(githubIssues[0]).toEqual(expect.objectContaining({
      provider: "github",
      sourceProvider: "github",
      issueAuthor: "bob",
      issueReporter: "bob",
      issueMilestone: "v1",
      issueCommentCount: 9,
    }));
    expect(gitlabIssues[0]).toEqual(expect.objectContaining({
      provider: "gitlab",
      sourceProvider: "gitlab",
      issueAuthor: "carol",
      issueReporter: "carol",
      issueMilestone: "v2",
      issueType: "Task",
      issuePriority: "high",
      issueCommentCount: 4,
      createdAt: "2026-05-17T09:00:00.000Z",
    }));
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
