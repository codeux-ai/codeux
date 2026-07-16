import { describe, expect, it, vi } from "vitest";
import type {
  CreateSprintRunInput,
  SprintRunRecord,
  UpdateSprintRunInput,
} from "../../../src/contracts/execution-types.js";
import {
  SprintRunLifecycleService,
  type SprintRunLifecycleServiceDeps,
} from "../../../src/services/sprint-run-lifecycle-service.js";

function createSprintRunRecord(
  id: string,
  input: CreateSprintRunInput,
): SprintRunRecord {
  return {
    id,
    projectId: input.projectId,
    sprintId: input.sprintId,
    status: input.status ?? "queued",
    triggerType: input.triggerType ?? "system",
    triggeredBy: input.triggeredBy ?? null,
    executorMode: input.executorMode ?? "mixed",
    startedAt: null,
    finishedAt: null,
    lastHeartbeatAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createHarness(initialProjectPaths: Record<string, string> = {
  "project-1": "/repos/project-1",
  "project-2": "/repos/project-2",
}) {
  const projectPaths = new Map(Object.entries(initialProjectPaths));
  const runs = new Map<string, SprintRunRecord>();
  const releasesByRepoPath = new Map<string, Array<ReturnType<typeof vi.fn>>>();
  let nextRunId = 1;

  const acquireProjectGitHelper = vi.fn((repoPath: string): (() => Promise<void>) => {
    const release = vi.fn(async () => undefined);
    const releases = releasesByRepoPath.get(repoPath) ?? [];
    releases.push(release);
    releasesByRepoPath.set(repoPath, releases);
    return release;
  });

  const executionRepository = {
    acquireLease: vi.fn(),
    appendSprintRunEvent: vi.fn(),
    createSprintRun: vi.fn((input: CreateSprintRunInput): SprintRunRecord => {
      const run = createSprintRunRecord(`run-${nextRunId++}`, input);
      runs.set(run.id, run);
      return run;
    }),
    finalizeSprintRunCancellationIfIdle: vi.fn((sprintRunId: string): SprintRunRecord | null => {
      const run = runs.get(sprintRunId);
      if (!run || run.status !== "cancel_requested") {
        return null;
      }
      const updated = { ...run, status: "cancelled" as const };
      runs.set(sprintRunId, updated);
      return updated;
    }),
    getSprintRun: vi.fn((sprintRunId: string): SprintRunRecord | null => runs.get(sprintRunId) ?? null),
    releaseLease: vi.fn(),
    renewLease: vi.fn(),
    updateSprintRun: vi.fn((sprintRunId: string, input: UpdateSprintRunInput): SprintRunRecord => {
      const run = runs.get(sprintRunId);
      if (!run) {
        throw new Error(`Unknown sprint run: ${sprintRunId}`);
      }
      const updated = { ...run, ...input };
      runs.set(sprintRunId, updated);
      return updated;
    }),
  };
  const projectManagementRepository = {
    getProject: vi.fn((projectId: string) => {
      const baseDir = projectPaths.get(projectId);
      return baseDir === undefined ? null : { baseDir };
    }),
    getRawSprintStatus: vi.fn(() => "running"),
    updateSprint: vi.fn(),
  };

  const service = new SprintRunLifecycleService({
    executionRepository: executionRepository as unknown as SprintRunLifecycleServiceDeps["executionRepository"],
    projectManagementRepository: projectManagementRepository as unknown as SprintRunLifecycleServiceDeps["projectManagementRepository"],
    acquireProjectGitHelper,
  });

  return {
    acquireProjectGitHelper,
    executionRepository,
    projectPaths,
    releasesByRepoPath,
    runs,
    service,
  };
}

describe("SprintRunLifecycleService project Git helper ownership", () => {
  it("keeps one run lease across every active state and releases it on pause", () => {
    const harness = createHarness();
    const run = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "queued",
    });
    const release = harness.releasesByRepoPath.get("/repos/project-1")?.[0];

    harness.service.markRunning(run.id);
    harness.service.updateRun(run.id, { status: "cancel_requested" });

    expect(harness.acquireProjectGitHelper).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    harness.service.updateRun(run.id, { status: "paused" });
    harness.service.updateRun(run.id, { status: "completed" });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reacquires a fresh lease when a paused run resumes", () => {
    const harness = createHarness();
    const run = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "paused",
    });

    expect(harness.acquireProjectGitHelper).not.toHaveBeenCalled();

    harness.service.markRunning(run.id);
    const firstRelease = harness.releasesByRepoPath.get("/repos/project-1")?.[0];
    harness.service.updateRun(run.id, { status: "paused" });
    harness.service.markRunning(run.id);
    const secondRelease = harness.releasesByRepoPath.get("/repos/project-1")?.[1];
    harness.service.updateRun(run.id, { status: "failed" });

    expect(harness.acquireProjectGitHelper).toHaveBeenCalledTimes(2);
    expect(firstRelease).toHaveBeenCalledTimes(1);
    expect(secondRelease).toHaveBeenCalledTimes(1);
  });

  it("tracks overlapping runs independently while routing leases by project path", () => {
    const harness = createHarness();
    const firstProjectRun = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "running",
    });
    const overlappingProjectRun = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-2",
      status: "running",
    });
    const secondProjectRun = harness.service.createRun({
      projectId: "project-2",
      sprintId: "sprint-3",
      status: "running",
    });
    const projectOneReleases = harness.releasesByRepoPath.get("/repos/project-1") ?? [];
    const projectTwoRelease = harness.releasesByRepoPath.get("/repos/project-2")?.[0];

    expect(harness.acquireProjectGitHelper.mock.calls.map(([repoPath]) => repoPath)).toEqual([
      "/repos/project-1",
      "/repos/project-1",
      "/repos/project-2",
    ]);

    harness.service.updateRun(firstProjectRun.id, { status: "completed" });
    expect(projectOneReleases[0]).toHaveBeenCalledTimes(1);
    expect(projectOneReleases[1]).not.toHaveBeenCalled();
    expect(projectTwoRelease).not.toHaveBeenCalled();

    harness.service.updateRun(overlappingProjectRun.id, { status: "cancelled" });
    harness.service.updateRun(secondProjectRun.id, { status: "completed" });
    expect(projectOneReleases[1]).toHaveBeenCalledTimes(1);
    expect(projectTwoRelease).toHaveBeenCalledTimes(1);
  });

  it("rehydrates ownership when recovery marks an existing run as running", () => {
    const harness = createHarness();
    const recoveredRun = createSprintRunRecord("recovered-run", {
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "queued",
    });
    harness.runs.set(recoveredRun.id, recoveredRun);

    harness.service.markRunning(recoveredRun.id);

    expect(harness.acquireProjectGitHelper).toHaveBeenCalledOnce();
    expect(harness.acquireProjectGitHelper).toHaveBeenCalledWith("/repos/project-1");
  });

  it("retains cancellation-requested ownership until idle finalization succeeds", () => {
    const harness = createHarness();
    const run = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "cancel_requested",
    });
    const release = harness.releasesByRepoPath.get("/repos/project-1")?.[0];

    harness.executionRepository.finalizeSprintRunCancellationIfIdle.mockReturnValueOnce(null);
    expect(harness.service.finalizeCancellationIfIdle(run.id)).toBeNull();
    expect(release).not.toHaveBeenCalled();

    expect(harness.service.finalizeCancellationIfIdle(run.id)?.status).toBe("cancelled");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retries acquisition after a missing project becomes available", () => {
    const harness = createHarness({});
    const run = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "queued",
    });

    expect(harness.acquireProjectGitHelper).not.toHaveBeenCalled();

    harness.projectPaths.set("project-1", "/repos/project-1");
    harness.service.markRunning(run.id);

    expect(harness.acquireProjectGitHelper).toHaveBeenCalledOnce();
    expect(harness.acquireProjectGitHelper).toHaveBeenCalledWith("/repos/project-1");
  });

  it("restores a cancellation-requested lease during the first recovered heartbeat", () => {
    const harness = createHarness();
    const recoveredRun = createSprintRunRecord("recovered-run", {
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "cancel_requested",
    });
    harness.runs.set(recoveredRun.id, recoveredRun);

    expect(harness.service.renewHeartbeat({
      sprintRunId: recoveredRun.id,
      sprintId: recoveredRun.sprintId,
    })).toBe(false);

    expect(harness.acquireProjectGitHelper).toHaveBeenCalledOnce();
    expect(harness.executionRepository.renewLease).not.toHaveBeenCalled();
  });

  it("contains asynchronous helper-release failures after dropping ownership", async () => {
    const harness = createHarness();
    const run = harness.service.createRun({
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "running",
    });
    const failedRelease = harness.releasesByRepoPath.get("/repos/project-1")?.[0];
    failedRelease?.mockRejectedValueOnce(new Error("release failed"));

    harness.service.updateRun(run.id, { status: "completed" });
    await Promise.resolve();

    expect(failedRelease).toHaveBeenCalledOnce();
    expect(() => harness.service.updateRun(run.id, { status: "cancelled" })).not.toThrow();
    expect(failedRelease).toHaveBeenCalledOnce();
  });
});
