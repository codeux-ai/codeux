import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerSprintRoutes } from "../../../src/server/sprint-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

function createApp(deps: DashboardDependencies): express.Express {
  const app = express();
  app.use(express.json());
  registerSprintRoutes(app, deps);
  return app;
}

describe("sprint imported task routes", () => {
  it("attaches imported tasks to an existing sprint", async () => {
    const createImportedTasks = vi.fn().mockReturnValue([
      {
        id: "task-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskKey: "T01",
        title: "Fix CI",
        promptMarkdown: "## Objective\nFix CI",
        description: "Imported failed-CI work item.",
        status: "pending",
        priority: "high",
        executorType: "auto",
        agentPresetId: "ci-agent",
        sortOrder: 0,
        dependsOnTaskIds: [],
        isIndependent: true,
        isMerged: false,
        mergeIndicator: null,
        sourceType: "import:failed_ci",
        sourcePath: "https://github.com/acme/widgets/actions/runs/55",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const app = createApp({
      getSprint: vi.fn().mockReturnValue({ id: "sprint-1", projectId: "project-1" }),
      createImportedTasks,
    } as unknown as DashboardDependencies);

    const response = await request(app)
      .post("/api/projects/project-1/sprints/sprint-1/imported-tasks")
      .send({
        tasks: [
          {
            kind: "failed_ci",
            title: "Fix CI",
            sourceUrl: "https://github.com/acme/widgets/actions/runs/55",
            provider: "github",
            repository: "acme/widgets",
            workflowRunId: "55",
            workflowRunUrl: "https://github.com/acme/widgets/actions/runs/55",
            errorMessage: "npm test failed",
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body[0]).toMatchObject({
      sourceType: "import:failed_ci",
      sourcePath: "https://github.com/acme/widgets/actions/runs/55",
      agentPresetId: "ci-agent",
    });
    expect(createImportedTasks).toHaveBeenCalledWith("project-1", "sprint-1", [
      expect.objectContaining({
        kind: "failed_ci",
        title: "Fix CI",
        workflowRunId: "55",
      }),
    ]);
  });

  it("creates imported tasks immediately after creating a sprint", async () => {
    const createdSprint = {
      id: "sprint-1",
      projectId: "project-1",
      number: 1,
      slug: "sprint-1",
      name: "Sprint 1",
      originalPrompt: null,
      goal: "Ship it",
      status: "idle",
      showcasePinned: true,
      startDate: null,
      endDate: null,
      featureBranch: null,
      baseCommitSha: null,
      tasksCount: 0,
      completion: 0,
      linkedIssues: [],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    let sprintSnapshot = createdSprint;

    const createSprint = vi.fn().mockImplementation(() => {
      sprintSnapshot = createdSprint;
      return createdSprint;
    });
    const createImportedTasks = vi.fn().mockImplementation((_projectId: string, _sprintId: string, tasks) => {
      sprintSnapshot = {
        ...sprintSnapshot,
        tasksCount: tasks.length,
      };
      return tasks.map((task: { kind: string; title: string }, index: number) => ({
        id: `task-${index + 1}`,
        projectId: "project-1",
        sprintId: "sprint-1",
        taskKey: `T0${index + 1}`,
        title: task.title,
        promptMarkdown: `## Objective\n${task.kind}`,
        description: "",
        status: "pending",
        priority: "medium",
        executorType: "auto",
        agentPresetId: null,
        sortOrder: index,
        dependsOnTaskIds: [],
        isIndependent: true,
        isMerged: false,
        mergeIndicator: null,
        sourceType: `import:${task.kind}`,
        sourcePath: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      }));
    });

    const app = createApp({
      getSprint: vi.fn().mockImplementation(() => sprintSnapshot),
      createSprint,
      createImportedTasks,
    } as unknown as DashboardDependencies);

    const response = await request(app)
      .post("/api/projects/project-1/sprints")
      .send({
        name: "Sprint 1",
        goal: "Ship it",
        importedTasks: [
          {
            kind: "quality",
            title: "Quality follow-up",
            sourceUrl: "https://github.com/acme/widgets/issues/99",
            provider: "github",
            repository: "acme/widgets",
            labels: ["quality"],
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.tasksCount).toBe(1);
    expect(createSprint).toHaveBeenCalledWith("project-1", expect.objectContaining({
      name: "Sprint 1",
      goal: "Ship it",
      importedTasks: [
        expect.objectContaining({
          kind: "quality",
          title: "Quality follow-up",
        }),
      ],
    }));
    expect(createImportedTasks).toHaveBeenCalledWith("project-1", "sprint-1", [
      expect.objectContaining({
        kind: "quality",
        title: "Quality follow-up",
      }),
    ]);
  });
});
