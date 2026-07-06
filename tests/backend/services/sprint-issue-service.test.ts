import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeIssuePromptContextInputs, SprintIssueService } from "../../../src/services/sprint-issue-service.js";
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

  it("requires a GitLab token when searching GitLab issues", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => ({ ...project, gitProvider: "gitlab", gitHostDomain: "gitlab.example.com" }),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          gitlabToken: "",
        },
      }),
    });

    await expect(service.searchIssues(project.id, {
      provider: "gitlab",
      repository: "acme/widgets",
      hostDomain: "gitlab.example.com",
      search: "import",
    })).rejects.toThrow("GitLab token is not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("infers the repository target from project git metadata", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("q")).toContain("repo:acme/widgets");
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
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

    await expect(service.searchIssues(project.id, {
      provider: "github",
    })).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the GitHub Enterprise API base URL for enterprise issue search", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://ghe.acme.test");
      expect(parsed.pathname).toBe("/api/v3/search/issues");
      expect(parsed.searchParams.get("per_page")).toBe("100");
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => ({ ...project, gitHostDomain: "ghe.acme.test" }),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "ghp_test",
        },
      }),
    });

    await service.searchIssues(project.id, {
      provider: "github",
      repository: " acme/widgets ",
      hostDomain: " GHE.ACME.TEST/ ",
      labels: [" ux ", "", "ux"],
      assignee: " alice ",
      limit: 500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the GitLab host domain API URL and clamps search limits", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://gitlab.example.com");
      expect(parsed.pathname).toBe("/api/v4/projects/acme%2Fwidgets/issues");
      expect(parsed.searchParams.get("per_page")).toBe("1");
      expect(parsed.searchParams.get("labels")).toBe("backend");
      expect(parsed.searchParams.get("assignee_username")).toBe("alice");
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
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
          gitlabToken: "glpat_test",
        },
      }),
    });

    await service.searchIssues(project.id, {
      provider: "gitlab",
      repository: " /acme/widgets/ ",
      hostDomain: " GitLab.Example.Com/ ",
      labels: [" backend ", "", "backend"],
      assignee: " alice ",
      limit: 0,
    });

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

  it("loads Jira issue prompt context without comments when conversation append is disabled", async () => {
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
      includeConversation: false,
    }]);

    expect(contexts[0]?.issueBodyMarkdown).toBe("Full Jira description");
    expect(contexts[0]?.issueConversationMarkdown).toBe("");
    expect(contexts[0]?.includeConversation).toBe(false);
  });

  it("requires Jira configuration for Jira search", async () => {
    const jiraApiClient = {
      searchIssues: vi.fn(),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        jira: {
          ...DEFAULT_DASHBOARD_SETTINGS.jira,
          host: "",
          apiToken: "",
        },
      }),
      jiraApiClient: jiraApiClient as any,
    });

    await expect(service.searchIssues(project.id, {
      provider: "jira",
      search: "OPS",
    })).rejects.toThrow("Jira site URL and API token must be configured in Settings -> Integrations.");
    expect(jiraApiClient.searchIssues).not.toHaveBeenCalled();
  });

  it("searches Jira issues through the generic issue service and clamps limits", async () => {
    const jiraApiClient = {
      searchIssues: vi.fn(async () => [{
        key: "OPS-42",
        title: "Import Jira backlog",
        url: "https://acme.atlassian.net/browse/OPS-42",
        state: "In Progress",
        labels: ["integration"],
        assignees: ["Pierre"],
        projectKey: "OPS",
        issueType: "Story",
        priority: "High",
        bodyPreview: "Build a reusable issue lookup.",
        createdAt: "2026-05-19T10:00:00.000+0000",
        updatedAt: "2026-05-20T10:00:00.000+0000",
        issueAuthor: "Alice",
        issueReporter: "Alice",
        issueMilestone: "v1",
        issueCommentCount: 4,
        sourceProvider: "jira",
      }]),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        jira: {
          ...DEFAULT_DASHBOARD_SETTINGS.jira,
          host: "https://acme.atlassian.net/",
          email: "ops@acme.test",
          apiToken: "jira-token",
          defaultProject: "OPS",
        },
      }),
      jiraApiClient: jiraApiClient as any,
    });

    const issues = await service.searchIssues(project.id, {
      provider: "jira",
      search: "OPS-42",
      assigneeText: "me",
      labels: ["backend"],
      limit: 500,
    });

    expect(jiraApiClient.searchIssues).toHaveBeenCalledWith(
      "https://acme.atlassian.net/",
      "ops@acme.test",
      "jira-token",
      expect.objectContaining({
        projectKey: "OPS",
        search: "OPS-42",
        assigneeText: "me",
        labels: ["backend"],
        limit: 100,
      }),
      100,
    );
    expect(issues).toEqual([
      expect.objectContaining({
        provider: "jira",
        sourceProvider: "jira",
        hostDomain: "acme.atlassian.net",
        repository: "OPS",
        projectKey: "OPS",
        issueNumber: 42,
        issueKey: "OPS-42",
        issuePriority: "High",
        bodyPreview: "Build a reusable issue lookup.",
        updatedAt: "2026-05-20T10:00:00.000+0000",
      }),
    ]);
  });

  it("clamps direct Jira search maxResults before calling the Jira client", async () => {
    const jiraApiClient = {
      searchIssues: vi.fn(async () => []),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      jiraApiClient: jiraApiClient as any,
    });

    await service.searchJiraIssues("https://acme.atlassian.net", "ops@acme.test", "jira-token", {
      projectKey: "OPS",
      maxResults: 500,
    });

    expect(jiraApiClient.searchIssues).toHaveBeenCalledWith(
      "https://acme.atlassian.net",
      "ops@acme.test",
      "jira-token",
      expect.objectContaining({
        projectKey: "OPS",
        limit: 100,
        maxResults: 100,
      }),
    );
  });

  it("resolves explicit Jira keys into full prompt contexts with deduplication", async () => {
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
        commentsMarkdown: "Jira comment",
        createdAt: "2026-05-19T10:00:00.000+0000",
        updatedAt: "2026-05-20T10:00:00.000+0000",
        issueAuthor: "Alice",
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

    const contexts = await service.getIssuePromptContextsForReferences(project.id, {
      provider: "jira",
      issueRefs: ["OPS-123", "ops-123", "not-an-issue"],
    });

    expect(jiraApiClient.getIssue).toHaveBeenCalledTimes(1);
    expect(jiraApiClient.getIssue).toHaveBeenCalledWith(
      "https://acme.atlassian.net",
      "ops@acme.test",
      "jira-token",
      "OPS-123",
    );
    expect(contexts).toEqual([
      expect.objectContaining({
        provider: "jira",
        repository: "OPS",
        projectKey: "OPS",
        issueNumber: 123,
        issueKey: "OPS-123",
        issueBodyMarkdown: "Full Jira description",
        issueConversationMarkdown: "Jira comment",
        issueAuthor: "Alice",
        issueUpdatedAt: "2026-05-20T10:00:00.000+0000",
      }),
    ]);
  });

  it("resolves explicit GitHub and GitLab IDs into full prompt contexts", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/widgets/issues/42")) {
        return new Response(JSON.stringify({
          number: 42,
          title: "Improve import UX",
          html_url: "https://github.com/acme/widgets/issues/42",
          state: "open",
          body: "GitHub body",
          user: { login: "alice" },
          labels: [{ name: "ux" }],
          assignees: [{ login: "pierre" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/repos/acme/widgets/issues/42/comments?per_page=100")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/v4/projects/acme%2Fwidgets/issues/7")) {
        return new Response(JSON.stringify({
          iid: 7,
          title: "Fix importer",
          web_url: "https://gitlab.example.com/acme/widgets/-/issues/7",
          state: "opened",
          description: "GitLab body",
          author: { username: "carol" },
          labels: ["backend"],
          assignees: [{ username: "alice" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/v4/projects/acme%2Fwidgets/issues/7/notes?per_page=100&sort=asc&order_by=created_at")) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
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
          gitlabToken: "glpat_test",
        },
      }),
    });

    const githubContexts = await service.getIssuePromptContextsForReferences(project.id, {
      provider: "github",
      issueNumbers: [42],
      issueRefs: ["#42", "bad"],
    });
    const gitlabContexts = await service.getIssuePromptContextsForReferences(project.id, {
      provider: "gitlab",
      repository: "acme/widgets",
      hostDomain: "gitlab.example.com",
      issueRefs: ["!7", "7", "OPS-7"],
    });

    expect(githubContexts).toEqual([
      expect.objectContaining({
        provider: "github",
        repository: "acme/widgets",
        issueNumber: 42,
        issueBodyMarkdown: "GitHub body",
      }),
    ]);
    expect(gitlabContexts).toEqual([
      expect.objectContaining({
        provider: "gitlab",
        hostDomain: "gitlab.example.com",
        repository: "acme/widgets",
        issueNumber: 7,
        issueBodyMarkdown: "GitLab body",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("filters invalid explicit issue references without remote calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const jiraApiClient = {
      getIssue: vi.fn(),
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
          apiToken: "jira-token",
        },
      }),
      jiraApiClient: jiraApiClient as any,
    });

    await expect(service.getIssuePromptContextsForReferences(project.id, {
      provider: "jira",
      issueRefs: ["not-an-issue", "#not-a-number"],
    })).resolves.toEqual([]);
    expect(jiraApiClient.getIssue).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes issue prompt inputs with deduplication and a 50-item cap", () => {
    const validInputs = Array.from({ length: 55 }, (_, index) => ({
      provider: "github",
      hostDomain: " GitHub.com ",
      repository: " /acme/widgets/ ",
      issueNumber: index + 1,
      title: ` Issue ${index + 1} `,
      url: ` https://github.com/acme/widgets/issues/${index + 1} `,
      labels: [" ux ", "", "ux", " backend "],
      assignees: [" alice ", "", "alice", " bob "],
    }));
    const normalized = normalizeIssuePromptContextInputs([
      ...validInputs,
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "acme/widgets",
        issueNumber: 1,
        title: "Duplicate issue",
        url: "https://github.com/acme/widgets/issues/1",
      },
      {
        provider: "bitbucket",
        hostDomain: "bitbucket.org",
        repository: "acme/widgets",
        issueNumber: 99,
        title: "Invalid provider",
        url: "https://bitbucket.org/acme/widgets/issues/99",
      },
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "acme/widgets",
        issueNumber: 0,
        title: "Invalid number",
        url: "https://github.com/acme/widgets/issues/0",
      },
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "acme/widgets",
        issueNumber: 100,
        title: "Missing URL",
        url: " ",
      },
    ] as any);

    expect(normalized).toHaveLength(50);
    expect(normalized[0]).toEqual(expect.objectContaining({
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 1,
      title: "Issue 1",
      url: "https://github.com/acme/widgets/issues/1",
      issueKey: "#1",
      labels: ["ux", "backend"],
      assignees: ["alice", "bob"],
      includeConversation: true,
    }));
    expect(normalized.filter((issue) => issue.issueNumber === 1)).toHaveLength(1);
    expect(normalized.some((issue) => issue.issueNumber === 99 || issue.issueNumber === 100)).toBe(false);
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

  it("transitions imported Jira linked issues through the configured transition", async () => {
    const linkedIssue: SprintLinkedIssueRecord = {
      id: "issue-1",
      projectId: project.id,
      sprintId: "sprint-1",
      provider: "jira",
      hostDomain: "acme.atlassian.net",
      repository: "OPS",
      issueNumber: 42,
      issueKey: "OPS-42",
      title: "Ship Jira import",
      url: "https://acme.atlassian.net/browse/OPS-42",
      state: "To Do",
      labels: [],
      assignees: [],
      closeState: "open",
      closeError: null,
      closedAt: null,
      createdAt: "2026-05-17T00:00:00.000Z",
    };
    const replaceSprintLinkedIssues = vi.fn(() => [linkedIssue]);
    const jiraApiClient = {
      getTransitions: vi.fn(async () => [{ id: "31", name: "in work" }]),
      transitionIssue: vi.fn(async () => undefined),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        replaceSprintLinkedIssues,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        jira: {
          ...DEFAULT_DASHBOARD_SETTINGS.jira,
          host: "https://acme.atlassian.net",
          email: "",
          apiToken: "jira-token",
          importTransitionName: "In Work",
        },
      }),
      jiraApiClient: jiraApiClient as any,
    });

    const result = await service.importLinkedIssues("sprint-1", project.id, [{
      provider: "jira",
      hostDomain: "acme.atlassian.net",
      repository: "OPS",
      issueNumber: 42,
      issueKey: "OPS-42",
      title: "Ship Jira import",
      url: "https://acme.atlassian.net/browse/OPS-42",
    }]);

    expect(replaceSprintLinkedIssues).toHaveBeenCalledWith(project.id, "sprint-1", [expect.objectContaining({
      provider: "jira",
      issueKey: "OPS-42",
    })]);
    expect(jiraApiClient.getTransitions).toHaveBeenCalledWith(
      "https://acme.atlassian.net",
      "",
      "jira-token",
      "OPS-42",
    );
    expect(jiraApiClient.transitionIssue).toHaveBeenCalledWith(
      "https://acme.atlassian.net",
      "",
      "jira-token",
      "OPS-42",
      "31",
    );
    expect(result).toEqual({ linkedIssues: [linkedIssue], warnings: [] });
  });

  it("skips imported Jira transitions when the import transition setting is disabled", async () => {
    const linkedIssue = {
      id: "issue-1",
      provider: "jira",
      issueKey: "OPS-42",
    } as SprintLinkedIssueRecord;
    const jiraApiClient = {
      getTransitions: vi.fn(),
      transitionIssue: vi.fn(),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        replaceSprintLinkedIssues: vi.fn(() => [linkedIssue]),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        jira: {
          ...DEFAULT_DASHBOARD_SETTINGS.jira,
          autoTransitionLinkedIssuesOnImport: false,
          host: "https://acme.atlassian.net",
          apiToken: "jira-token",
        },
      }),
      jiraApiClient: jiraApiClient as any,
    });

    const result = await service.importLinkedIssues("sprint-1", project.id, []);

    expect(jiraApiClient.getTransitions).not.toHaveBeenCalled();
    expect(jiraApiClient.transitionIssue).not.toHaveBeenCalled();
    expect(result).toEqual({ linkedIssues: [linkedIssue], warnings: [] });
  });

  it("keeps imported Jira linked issues when the configured import transition is missing", async () => {
    const linkedIssue = {
      id: "issue-1",
      provider: "jira",
      issueKey: "OPS-42",
    } as SprintLinkedIssueRecord;
    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    };
    const jiraApiClient = {
      getTransitions: vi.fn(async () => [{ id: "41", name: "Done" }]),
      transitionIssue: vi.fn(),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        replaceSprintLinkedIssues: vi.fn(() => [linkedIssue]),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        jira: {
          ...DEFAULT_DASHBOARD_SETTINGS.jira,
          host: "https://acme.atlassian.net",
          apiToken: "jira-token",
          importTransitionName: "In Work",
        },
      }),
      jiraApiClient: jiraApiClient as any,
      logger: logger as any,
    });

    const result = await service.importLinkedIssues("sprint-1", project.id, []);

    expect(jiraApiClient.transitionIssue).not.toHaveBeenCalled();
    expect(result.linkedIssues).toEqual([linkedIssue]);
    expect(result.warnings).toEqual([{
      issueId: "issue-1",
      issueKey: "OPS-42",
      message: "Transition 'In Work' not found for Jira issue OPS-42",
    }]);
    expect(logger.warn).toHaveBeenCalledWith("Failed to transition imported Jira issue", expect.objectContaining({
      issueKey: "OPS-42",
      error: "Transition 'In Work' not found for Jira issue OPS-42",
    }));
  });

  it("does not transition GitHub or GitLab linked issues during import", async () => {
    const linkedIssues = [
      { id: "issue-1", provider: "github", issueKey: "#42" },
      { id: "issue-2", provider: "gitlab", issueKey: "!7" },
    ] as SprintLinkedIssueRecord[];
    const jiraApiClient = {
      getTransitions: vi.fn(),
      transitionIssue: vi.fn(),
    };

    const service = new SprintIssueService({
      projectManagementRepository: {
        replaceSprintLinkedIssues: vi.fn(() => linkedIssues),
      } as any,
      getDashboardSettings: vi.fn(() => DEFAULT_DASHBOARD_SETTINGS),
      jiraApiClient: jiraApiClient as any,
    });

    const result = await service.importLinkedIssues("sprint-1", project.id, []);

    expect(jiraApiClient.getTransitions).not.toHaveBeenCalled();
    expect(jiraApiClient.transitionIssue).not.toHaveBeenCalled();
    expect(result).toEqual({ linkedIssues, warnings: [] });
  });
});
