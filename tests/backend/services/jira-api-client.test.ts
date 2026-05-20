import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJiraSearchJql, searchIssues } from "../../../src/services/jira-api-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jira-api-client", () => {
  it("builds guided Jira search filters into JQL", () => {
    expect(buildJiraSearchJql({
      projectKey: "ops",
      search: "login failure",
      status: "in_progress",
      assigneeText: "dev@example.com",
      labels: ["customer escalation", "p0"],
    })).toBe('project = OPS AND text ~ "login failure" AND statusCategory = "In Progress" AND assignee = "dev@example.com" AND labels in ("customer escalation", "p0") ORDER BY updated DESC');
  });

  it("keeps text assignee shortcuts for current user and unassigned issues", () => {
    expect(buildJiraSearchJql({ assigneeText: "me" })).toBe("statusCategory != Done AND assignee = currentUser() ORDER BY updated DESC");
    expect(buildJiraSearchJql({ assigneeText: "unassigned" })).toBe("statusCategory != Done AND assignee is EMPTY ORDER BY updated DESC");
  });

  it("searches Jira with the enhanced search endpoint and maps issue metadata", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
        jql: "project = OPS AND statusCategory != Done ORDER BY updated DESC",
        maxResults: 25,
      }));
      return new Response(JSON.stringify({
        issues: [
          {
            key: "OPS-42",
            fields: {
              summary: "Import Jira backlog",
              status: { name: "In Progress" },
              assignee: { displayName: "Pierre" },
              labels: ["jira"],
              project: { key: "OPS" },
              issuetype: { name: "Story" },
              priority: { name: "High" },
              updated: "2026-05-20T10:00:00.000+0000",
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
      status: "open",
      maxResults: 25,
    })).resolves.toEqual([
      expect.objectContaining({
        key: "OPS-42",
        title: "Import Jira backlog",
        state: "In Progress",
        assignees: ["Pierre"],
        issueType: "Story",
        priority: "High",
        bodyPreview: "Full Jira issue body.",
        updatedAt: "2026-05-20T10:00:00.000+0000",
      }),
    ]);
  });
});
