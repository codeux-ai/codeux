import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerSprintRoutes } from "../../../src/server/sprint-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

const createApp = (deps: DashboardDependencies): express.Express => {
  const app = express();
  app.use(express.json());
  registerSprintRoutes(app, deps);
  return app;
};

describe("sprint issue search routes", () => {
  it("parses and clamps repository issue search filters", async () => {
    const searchIssues = vi.fn(async () => []);
    const app = createApp({
      sprintIssueService: {
        searchIssues,
      },
    } as unknown as DashboardDependencies);

    const response = await request(app).get(
      "/api/projects/project-1/issues?provider=github&repository=acme/widgets&hostDomain=github.com&search=import&state=all&labels=ux,bug&assignee=alice&author=bob&reporter=carol&milestone=v1&issueText=%2342&createdAfter=2026-05-01&createdBefore=2026-05-31&updatedAfter=2026-06-01&updatedBefore=2026-06-30&sortField=comments&sortDirection=asc&limit=999"
    );

    expect(response.status).toBe(200);
    expect(searchIssues).toHaveBeenCalledWith("project-1", expect.objectContaining({
      provider: "github",
      repository: "acme/widgets",
      hostDomain: "github.com",
      search: "import",
      state: "all",
      labels: ["ux", "bug"],
      assignee: "alice",
      author: "bob",
      reporter: "carol",
      milestone: "v1",
      issueText: "#42",
      createdAfter: "2026-05-01",
      createdBefore: "2026-05-31",
      updatedAfter: "2026-06-01",
      updatedBefore: "2026-06-30",
      sortField: "comments",
      sortDirection: "asc",
      limit: 100,
    }));
  });

  it("parses Jira guided search filters and clamps the limit", async () => {
    const searchJiraIssues = vi.fn(async () => []);
    const app = createApp({
      searchJiraIssues,
    } as unknown as DashboardDependencies);

    const response = await request(app).get(
      "/api/projects/project-1/jira/search?projectKey=OPS&search=login%20failure&issueKey=OPS-42&status=in_progress&assignee=me&assigneeText=alice&reporterText=bob&issueType=Bug&priority=High&labels=triage,backend&updatedAfter=2026-05-01&updatedBefore=2026-05-31&sortField=priority&sortDirection=asc&limit=250"
    );

    expect(response.status).toBe(200);
    expect(searchJiraIssues).toHaveBeenCalledWith("project-1", expect.objectContaining({
      projectKey: "OPS",
      search: "login failure",
      issueKey: "OPS-42",
      status: "in_progress",
      assignee: "me",
      assigneeText: "alice",
      reporterText: "bob",
      issueType: "Bug",
      priority: "High",
      labels: ["triage", "backend"],
      updatedAfter: "2026-05-01",
      updatedBefore: "2026-05-31",
      sortField: "priority",
      sortDirection: "asc",
      limit: 100,
    }));
  });

  it("rejects invalid issue search enums and dates", async () => {
    const app = createApp({
      sprintIssueService: { searchIssues: vi.fn(async () => []) },
      searchJiraIssues: vi.fn(async () => []),
    } as unknown as DashboardDependencies);

    expect((await request(app).get("/api/projects/project-1/issues?sortField=bogus")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/jira/search?updatedAfter=not-a-date")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/jira/search?status=bogus")).status).toBe(400);
  });
});
