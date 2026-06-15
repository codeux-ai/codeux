import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { OverviewTelemetryQuery } from "../../../../src/repositories/execution/overview-telemetry-query.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-overview-query-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("OverviewTelemetryQuery", () => {
  it("handles empty telemetrySprintRunIds gracefully (no active or paused sprints)", async () => {
    const { executionRepository } = await createRepositories();

    // No projects or sprint runs created
    const snapshot = executionRepository.getOverviewTelemetrySnapshot();

    expect(snapshot.activeProjects).toHaveLength(0);
    expect(snapshot.attentionProjects).toHaveLength(0);
    expect(snapshot.recentEvents).toHaveLength(0);
  });

  it("deterministically sorts and limits combined task_run_events and sprint_run_events", async () => {
    const { storage, executionRepository, projectRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Test Project",
      sourceType: "local",
      sourceRef: "/test",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Test Sprint",
      number: 1,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Test task",
      promptMarkdown: "Do work",
    });

    const run = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "dashboard",
      triggeredBy: "user:test",
      executorMode: "mixed",
      status: "running",
    });

    const db = storage.getDatabase();

    // Create 50 sprint run events, and 50 task run events, mixed timestamps. Total 100. Limit is 80.
    for (let i = 0; i < 50; i++) {
      db.prepare(`
        INSERT INTO sprint_run_events (sprint_run_id, event_type, originator, created_at)
        VALUES (?, 'sprint_started', 'system', ?)
      `).run(run.id, `2026-01-01T10:00:${String(i).padStart(2, "0")}.000Z`); // removed extra 10:00:${String(i).padStart(2, "0")}.000Z`);
    }

    const tr = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: run.id,
      taskId: task.id,
      state: 'pending'
    });

    for (let i = 0; i < 50; i++) {
      db.prepare(`
        INSERT INTO task_run_events (task_run_id, event_type, originator, created_at)
        VALUES (?, 'task_started', 'system', ?)
      `).run(tr.id, `2026-01-01T10:01:${String(i).padStart(2, "0")}.000Z`); // removed extra 10:01:${String(i).padStart(2, "0")}.000Z`);
    }

    const snapshot = executionRepository.getOverviewTelemetrySnapshot();

    expect(snapshot.recentEvents).toHaveLength(80);
    // The most recent 50 should all be task_run_events (from 10:01)
    for (let i = 0; i < 50; i++) {
        expect(snapshot.recentEvents[i]!.scopeType).toBe('task_run');
    }
    // The remaining 30 should be the most recent sprint_run_events (from 10:00:20 to 10:00:49)
    for (let i = 50; i < 80; i++) {
        expect(snapshot.recentEvents[i]!.scopeType).toBe('sprint_run');
    }
    // Check descending order strictly
    for (let i = 0; i < 79; i++) {
        expect(
            new Date(snapshot.recentEvents[i]!.createdAt).getTime() >=
            new Date(snapshot.recentEvents[i+1]!.createdAt).getTime()
        ).toBe(true);
    }
  });

  it("safely handles more sprint run IDs than a single SQLite placeholder chunk", async () => {
    const { storage, executionRepository, projectRepository } = await createRepositories();

    // Using transaction for speed
    const db = storage.getDatabase().getRawDatabase();
    // db.exec("BEGIN");

    const runIds: string[] = [];
    // We want to exceed a standard chunk size, e.g., 100.
    const runCount = 150;

    // Create base project/sprint to avoid creating 150 of them
    const pId = projectRepository.createProject({
        name: `P1`,
        sourceType: "local",
        sourceRef: `/test/1`,
    }).id;
    const sId = projectRepository.createSprint(pId, {
        name: `S1`,
        number: 1,
        status: "running",
    }).id;

    for (let i = 0; i < runCount; i++) {
        const rId = executionRepository.createSprintRun({
            projectId: pId,
            sprintId: sId,
            triggerType: "dashboard",
            triggeredBy: "user:test",
            executorMode: "mixed",
            status: "running",
        }).id;
        runIds.push(rId);

        storage.getDatabase().prepare(`
            INSERT INTO sprint_run_events (sprint_run_id, event_type, originator, created_at)
            VALUES (?, 'sprint_started', 'system', ?)
        `).run(rId, '2026-01-01T10:00:00.000Z');
    }

    // db.exec("COMMIT");

    // Bypass getOverviewTelemetrySnapshot limit to test the chunking method directly
    const query = new OverviewTelemetryQuery(storage.getDatabase(), storage);
    // use dynamic access to bypass private access modifier in test
    const events = (query as any).loadRecentEvents(runIds);

    // If chunking works, it shouldn't throw "too many SQL variables"
    // And since it limits to 80, we should get exactly 80 back.
    expect(events).toHaveLength(80);
  });
});
