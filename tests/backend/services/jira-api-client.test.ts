import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJiraSearchJql, listProjectStatuses, searchIssues } from "../../../src/services/jira-api-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jira-api-client", () => {
  it("builds guided Jira search filters into JQL", () => {
    expect(buildJiraSearchJql({
      projectKey: "ops",
      search: "OPS-123",
      status: "in_progress",
      assigneeText: "dev@example.com",
      reporterText: "me",
      issueType: "Bug",
      priority: "High",
      labels: ["customer escalation", "p0"],
      updatedAfter: "2026-05-01",
      updatedBefore: "2026-05-31",
      sortField: "priority",
      sortDirection: "asc",
    })).toBe('project = OPS AND key = OPS-123 AND statusCategory = "In Progress" AND assignee = "dev@example.com" AND reporter = currentUser() AND issuetype = "Bug" AND priority = "High" AND updated >= "2026-05-01" AND updated <= "2026-05-31" AND labels in ("customer escalation", "p0") ORDER BY priority ASC');
  });

  it("keeps text assignee shortcuts for current user and unassigned issues", () => {
    expect(buildJiraSearchJql({ assigneeText: "me" })).toBe("statusCategory != Done AND assignee = currentUser() ORDER BY updated DESC");
    expect(buildJiraSearchJql({ assigneeText: "currentUser()" })).toBe("statusCategory != Done AND assignee = currentUser() ORDER BY updated DESC");
    expect(buildJiraSearchJql({ assigneeText: "unassigned" })).toBe("statusCategory != Done AND assignee is EMPTY ORDER BY updated DESC");
  });

  it("uses exact Jira status names instead of status category filters", () => {
    expect(buildJiraSearchJql({
      projectKey: "ops",
      status: "done",
      statusNames: [" Ready for QA ", "Blocked \"External\"", "Ready for QA"],
    })).toBe('project = OPS AND status in ("Ready for QA", "Blocked \\"External\\"") ORDER BY updated DESC');
  });

  it("lists project statuses by flattening issue type groups and de-duplicating statuses", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://acme.atlassian.net/rest/api/3/project/OPS/statuses");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer token",
        Accept: "application/json",
      }));
      return new Response(JSON.stringify([
        {
          id: "10001",
          name: "Story",
          statuses: [
            { id: "3", name: "Done" },
            { id: "1", name: "To Do" },
            { id: "2", name: "In Progress" },
          ],
        },
        {
          id: "10002",
          name: "Bug",
          statuses: [
            { id: "2", name: "In Progress" },
            { id: "4", name: " done " },
            { name: "Blocked" },
            { name: " blocked " },
          ],
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjectStatuses("https://acme.atlassian.net/", "", "token", "OPS")).resolves.toEqual([
      { id: "blocked", name: "Blocked", issueTypes: ["Bug"] },
      { id: "3", name: "Done", issueTypes: ["Bug", "Story"] },
      { id: "2", name: "In Progress", issueTypes: ["Bug", "Story"] },
      { id: "1", name: "To Do", issueTypes: ["Story"] },
    ]);
  });

  it("searches Jira with the enhanced search endpoint and maps issue metadata", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
        jql: "project = OPS AND statusCategory != Done ORDER BY updated DESC",
        maxResults: 100,
        fields: ["summary", "status", "assignee", "labels", "project", "description", "issuetype", "priority", "updated", "created", "reporter", "fixVersions", "comment"],
      }));
      return new Response(JSON.stringify({
        issues: [
          {
            key: "OPS-42",
            fields: {
              summary: "Import Jira backlog",
              status: { name: "In Progress" },
              assignee: { displayName: "Pierre" },
              reporter: { displayName: "Alice" },
              labels: ["jira"],
              project: { key: "OPS" },
              issuetype: { name: "Story" },
              priority: { name: "High" },
              created: "2026-05-19T10:00:00.000+0000",
              updated: "2026-05-20T10:00:00.000+0000",
              fixVersions: [{ name: "v1" }],
              comment: { total: 4, comments: [{ body: { type: "text", text: "ignored" } }] },
              description: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Full Jira issue body." }] }],
              },
            },
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchIssues("https://acme.atlassian.net/", "dev@example.com", "token", {
      projectKey: "OPS",
      limit: 250,
    })).resolves.toEqual([
      expect.objectContaining({
        key: "OPS-42",
        title: "Import Jira backlog",
        state: "In Progress",
        assignees: ["Pierre"],
        issueType: "Story",
        priority: "High",
        bodyPreview: "Full Jira issue body.",
        createdAt: "2026-05-19T10:00:00.000+0000",
        updatedAt: "2026-05-20T10:00:00.000+0000",
        issueReporter: "Alice",
        issueMilestone: "v1",
        issueCommentCount: 4,
        sourceProvider: "jira",
      }),
    ]);
  });
});
