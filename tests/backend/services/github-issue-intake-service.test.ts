import { describe, expect, it, vi } from "vitest";
import { GithubIssueIntakeService } from "../../../src/services/github-issue-intake-service.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { GithubIntakeRepository } from "../../../src/repositories/github-intake-repository.js";

const issue = (overrides: Record<string, unknown> = {}) => ({
  provider: "github" as const,
  hostDomain: "github.com",
  repository: "acme/app",
  issueNumber: 7,
  issueKey: "#7",
  title: "Do the thing",
  url: "https://github.com/acme/app/issues/7",
  state: "open",
  labels: ["codeux:ready"],
  assignees: [],
  bodyPreview: "Implement the thing",
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T01:00:00Z",
  issueAuthor: "bot",
  issueReporter: "bot",
  issueMilestone: null,
  issueType: null,
  issuePriority: null,
  issueCommentCount: 0,
  sourceProvider: "github" as const,
  ...overrides,
});

function fixture(active = 0) {
  const observed = { id: "intake-1", idempotencyKey: "p1|github|github.com|acme/app|issue|7|2026-09-14T01:00:00Z|implement|v1" };
  const repository = {
    upsertSeen: vi.fn(() => observed),
    claimWithinCapacity: vi.fn(() => active >= 2 ? { status: "capacity" as const } : { status: "claimed" as const, item: observed }),
    attachDispatch: vi.fn(),
    withTransaction: vi.fn((operation: () => unknown) => operation()),
    setStatus: vi.fn(),
    reconcileProjectState: vi.fn(() => ({ completed: 0, failed: 0, held: 0 })),
  };
  const project = {
    getProject: vi.fn(() => ({
      id: "p1", slug: "acme-app", name: "Acme App", baseDir: "", repoUrl: "https://github.com/acme/app.git",
      sourceType: "git", sourceRef: "https://github.com/acme/app.git", initializationMode: "existing", gitProvider: "github",
      gitHostDomain: "github.com", defaultBranch: "main", featureBranchPrefix: "feature/", status: "active",
      sprintsCount: 0, openTasks: 0, completedTasks: 0, isRunning: false, settingsOverrides: {}, agentBindings: [],
      lastRunAt: null, lastRunStatus: null, createdAt: "", updatedAt: "",
    })),
    createSprint: vi.fn(() => ({ id: "sprint-1", name: "Issue 7" })),
    updateSprint: vi.fn(),
  };
  const planner = { planSprint: vi.fn(async () => ({ ok: true, createdTaskIds: ["task-1"] })) };
  const search = vi.fn(async () => [issue()]);
  return { repository, project, planner, search, service: new GithubIssueIntakeService({
    intakeRepository: repository,
    projectManagementRepository: project,
    planningAgentService: planner,
    sprintIssueService: { searchIssues: search },
  }) };
}

describe("GithubIssueIntakeService", () => {
  it("claims before creating one linked sprint and plans with a stable request id", async () => {
    const f = fixture();
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["CODEUX:READY"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.admitted).toBe(1);
    expect(f.repository.claimWithinCapacity).toHaveBeenCalledBefore(f.project.createSprint);
    expect(f.project.createSprint.mock.calls[0][1].linkedIssues?.[0].metadata).toMatchObject({ policyVersion: "v1" });
    expect(f.planner.planSprint).toHaveBeenCalledWith("p1", "sprint-1", { autoStart: true, maxTasks: 1, clientRequestId: expect.stringContaining("github-intake:") }, undefined);
    expect(f.repository.attachDispatch).toHaveBeenCalledWith("intake-1", { sprintId: "sprint-1" });
  });

  it("reconciles completed dispatches before considering new capacity", async () => {
    const f = fixture();
    const reconcileDispatches = vi.fn(async () => undefined);
    const service = new GithubIssueIntakeService({
      intakeRepository: f.repository,
      projectManagementRepository: f.project,
      planningAgentService: f.planner,
      sprintIssueService: { searchIssues: f.search },
      reconcileDispatches,
    });
    await service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(reconcileDispatches).toHaveBeenCalledBefore(f.repository.reconcileProjectState);
  });

  it("holds excluded issues and capacity without creating or planning", async () => {
    const f = fixture(2);
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], excludedLabels: ["blocked"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.skipped).toBe(1);
    expect(f.project.createSprint).not.toHaveBeenCalled();
    expect(f.planner.planSprint).not.toHaveBeenCalled();
  });

  it("does not create or plan when the same observed issue is already claimed", async () => {
    const f = fixture();
    f.repository.claimWithinCapacity.mockReturnValueOnce({ status: "unavailable" });
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.skipped).toBe(1);
    expect(f.project.createSprint).not.toHaveBeenCalled();
    expect(f.planner.planSprint).not.toHaveBeenCalled();
  });

  it("replays an unchanged durable observation without creating or planning twice", async () => {
    const storage = new AppDbStorage(":memory:");
    try {
      storage.getDatabase().prepare(`INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run("p1", "acme-app", "Acme App", ".", "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z");
      const f = fixture();
      f.project.createSprint.mockImplementation(() => {
        storage.getDatabase().prepare(`INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run("sprint-1", "p1", 1, "issue-7", "Issue 7", "planning", "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z");
        return { id: "sprint-1", name: "Issue 7" };
      });
      const service = new GithubIssueIntakeService({
        intakeRepository: new GithubIntakeRepository(storage),
        projectManagementRepository: f.project,
        planningAgentService: f.planner,
        sprintIssueService: { searchIssues: f.search },
      });
      const options = { projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" };
      expect((await service.reconcile(options)).admitted).toBe(1);
      expect((await service.reconcile(options)).admitted).toBe(0);
      expect(f.project.createSprint).toHaveBeenCalledTimes(1);
      expect(f.planner.planSprint).toHaveBeenCalledTimes(1);
    } finally {
      storage.close();
    }
  });

  it("holds an issue without an immutable observed version", async () => {
    const f = fixture();
    f.search.mockResolvedValueOnce([issue({ updatedAt: null })]);
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.held).toBe(1);
    expect(f.repository.setStatus).toHaveBeenCalledWith("intake-1", "held", "missing_observed_version");
    expect(f.project.createSprint).not.toHaveBeenCalled();
    expect(f.planner.planSprint).not.toHaveBeenCalled();
  });

  it("cancels a created sprint and records the original planning failure", async () => {
    const f = fixture();
    f.planner.planSprint.mockRejectedValueOnce(new Error("planner unavailable"));
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.admitted).toBe(0);
    expect(f.project.updateSprint).toHaveBeenCalledWith("sprint-1", { status: "cancelled" });
    expect(f.repository.setStatus).toHaveBeenCalledWith("intake-1", "failed", "dispatch_failed", "planner unavailable");
  });

  it("cancels and records an empty plan instead of claiming an idle sprint as dispatched", async () => {
    const f = fixture();
    f.planner.planSprint.mockResolvedValueOnce({ ok: true, createdTaskIds: [] });
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.admitted).toBe(0);
    expect(f.project.updateSprint).toHaveBeenCalledWith("sprint-1", { status: "cancelled" });
    expect(f.repository.setStatus).toHaveBeenCalledWith("intake-1", "failed", "dispatch_failed", "Planning produced no executable tasks.");
  });

  it("rejects a repository outside the selected project before any GitHub search", async () => {
    const f = fixture();
    await expect(f.service.reconcile({ projectId: "p1", repository: "other/repo", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" })).rejects.toThrow(/exactly match/);
    expect(f.search).not.toHaveBeenCalled();
  });

  it("holds a search observation whose URL escaped the selected repository", async () => {
    const f = fixture();
    f.search.mockResolvedValueOnce([issue({ repository: "acme/app", url: "https://github.com/attacker/other/issues/7" })]);
    const result = await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" });
    expect(result.held).toBe(1);
    expect(f.project.createSprint).not.toHaveBeenCalled();
    expect(f.planner.planSprint).not.toHaveBeenCalled();
    expect(f.repository.setStatus).toHaveBeenCalledWith("intake-1", "held", "foreign_repository_observation");
  });

  it("passes node-flow cancellation into the planning operation", async () => {
    const f = fixture();
    const controller = new AbortController();
    await f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1", signal: controller.signal });
    expect(f.planner.planSprint).toHaveBeenCalledWith("p1", "sprint-1", expect.any(Object), controller.signal);
  });

  it("canonicalizes repository case for search, idempotency, and capacity accounting", async () => {
    const f = fixture();
    f.search.mockResolvedValueOnce([issue({ repository: "ACME/App", url: "https://github.com/ACME/App/issues/7" })]);
    await f.service.reconcile({ projectId: "p1", repository: "ACME/App", requiredLabels: ["codeux:ready"], maxActiveLanes: 1, policyVersion: "v1" });
    expect(f.search.mock.calls[0]?.[1].repository).toBe("acme/app");
    expect(f.repository.claimWithinCapacity.mock.calls[0]?.[2]).toBe("acme/app");
    expect(f.repository.upsertSeen.mock.calls[0]?.[0].repository).toBe("acme/app");
  });

  it("rejects an empty allow-label policy before any GitHub search", async () => {
    const f = fixture();
    await expect(f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: [], maxActiveLanes: 2, policyVersion: "v1" })).rejects.toThrow(/allow label/);
    expect(f.search).not.toHaveBeenCalled();
  });

  it("rejects non-GitHub projects before any GitHub search", async () => {
    const f = fixture();
    const current = f.project.getProject();
    f.project.getProject.mockReturnValueOnce({ ...current, gitProvider: "local", repoUrl: null, sourceRef: "" });
    await expect(f.service.reconcile({ projectId: "p1", repository: "acme/app", requiredLabels: ["codeux:ready"], maxActiveLanes: 2, policyVersion: "v1" })).rejects.toThrow(/GitHub-backed/);
    expect(f.search).not.toHaveBeenCalled();
  });
});
