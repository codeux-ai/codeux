import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";
import { PlanningAgentService } from "../../../src/services/planning-agent-service.js";
import type { IProviderRunner } from "../../../src/infrastructure/providers/cli/provider-runner.js";
import { WorkspaceManager } from "../../../src/infrastructure/providers/cli/workspace-manager.js";
import * as gitBranchSyncService from "../../../src/services/git-branch-sync-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("PlanningAgentService Integration", () => {
  beforeEach(() => {
    vi.spyOn(gitBranchSyncService, "syncRemoteBranchIfAvailable")
      .mockResolvedValue(true);
    vi.spyOn(WorkspaceManager.prototype, "createSnapshotWorkspace")
      .mockResolvedValue("docker-volume://planning-test");
    vi.spyOn(WorkspaceManager.prototype, "createOrReuseSnapshotWorkspace")
      .mockResolvedValue("docker-volume://planning-test");
    vi.spyOn(WorkspaceManager.prototype, "removeWorktree")
      .mockResolvedValue(undefined);
    vi.spyOn(WorkspaceManager.prototype, "readWorkspaceFile")
      .mockResolvedValue("## Category: Patterns\n- prefer consistent planning context\n");
  });

  async function setupTestHarness(sprintInput: { name?: string; goal: string } = {
    name: "Planning Sprint",
    goal: "Initial Goal",
  }) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-agent-int-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".code-ux", "agents", "planning_agent.md"),
      "Turn sprint goals into concrete executable tasks.\n",
      "utf8",
    );

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const connectionRepository = new ConnectionChatRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));

    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const executionControlService = {
      orchestrateSprint: vi.fn(async () => ({ ok: true })),
    } as const;

    const project = projectRepository.createProject({
      name: "Worker Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, sprintInput);

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
      cliWorkflow: {
        executionMode: "DOCKER",
        provider: "gemini",
      },
    });

    return {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    };
  }

  const validPromptMarkdown = "## Objective\nUpdate the sprint gallery UI and completed-state styling.\n\n## Scope\n- UI components\n\n## Implementation Requirements\n1. Refresh cells\n\n## Constraints\n- Keep it fast\n\n## Verification\n- Visual check";

  function createPlanningProviderRunner(payload: unknown): IProviderRunner {
    return {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue(providerTextResult(JSON.stringify(payload))),
    };
  }

  function providerTextResult(text: string) {
    return {
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        nativeSessionId: null,
        usageTelemetry: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          totalTokens: 20,
          usageSource: "reported",
          rawUsageJson: {},
          transcriptText: "",
          nativeSessionId: null,
        },
        text,
      };
  }

  function createPlanningTextProviderRunner(texts: string[]): IProviderRunner {
    const runProviderForText = vi.fn();
    for (const text of texts) {
      runProviderForText.mockResolvedValueOnce(providerTextResult(text));
    }
    return {
      runProvider: vi.fn(),
      runProviderForText,
    };
  }

  function planningProviderPayload(title: string): Record<string, unknown> {
    return {
      goal: "Updated sprint goal",
      tasks: [
        {
          key: "T01",
          title,
          description: `${title} description.`,
          promptMarkdown: validPromptMarkdown,
          priority: "high",
          executorType: "auto",
          dependsOn: [],
        },
      ],
    };
  }

  function findCompletedExecutionPlanMessage(
    executionRepository: ExecutionRepository,
    invocationId: string,
  ) {
    return executionRepository.listExecutionInvocationMessages(invocationId).find((message) => {
      const widgetMetadata = message.metadata?.widget_metadata as Record<string, unknown> | undefined;
      return widgetMetadata?.type === "planning_request" && widgetMetadata.status === "completed";
    });
  }

  function reflectionResult(score: number): string {
    return JSON.stringify({
      criteria: [
        {
          id: "autostart_gate",
          score,
          rationale: score >= 8 ? "The plan is ready to start." : "The plan needs more review before starting.",
          improvementInstructions: score >= 8 ? "" : "Tighten the executable task definition.",
        },
      ],
    });
  }

  function enablePlanningSelfReflection(
    settingsRepository: SettingsRepository,
    projectId: string,
    maxImprovementAttempts: number,
  ): void {
    settingsRepository.saveProjectSettings(projectId, {
      agents: {
        selfReflection: {
          planning: {
            enabled: true,
            criteria: [
              {
                id: "autostart_gate",
                label: "Autostart gate",
                prompt: "The plan is safe and complete enough to start automatically.",
                threshold: 0.8,
              },
            ],
            maxImprovementAttempts,
          },
        },
      },
      cliWorkflow: {
        maxPlanningJsonRetries: 0,
        maxParsingRetries: 0,
      },
    });
  }

  it("successfully plans a sprint, mapping dependencies and recording invocation lifecycle", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        nativeSessionId: null,
        usageTelemetry: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 10,
          reasoningOutputTokens: 0,
          totalTokens: 20,
          usageSource: "reported",
          rawUsageJson: {},
          transcriptText: "",
          nativeSessionId: null,
        },
        text: JSON.stringify({
          goal: "Updated sprint goal",
          tasks: [
            {
              key: "T01",
              title: "T1",
              description: "D1",
              promptMarkdown: validPromptMarkdown,
              priority: "high",
              executorType: "auto",
              dependsOn: [],
            },
            {
              key: "T02",
              title: "T2",
              description: "D2",
              promptMarkdown: validPromptMarkdown,
              priority: "medium",
              executorType: "docker_cli",
              dependsOn: ["T01"],
            },
          ]
        }),
      }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner,
    });

    await service.planSprint(project.id, sprint.id, {});

    // Verify task persistence
    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(2);

    // T01 should have no dependencies
    const task1 = tasks.find(t => t.title === "T1")!;
    expect(task1).toBeDefined();
    expect(task1.dependsOnTaskIds || []).toEqual([]);
    expect(task1.priority).toBe("high");

    // T02 should depend on T01
    const task2 = tasks.find(t => t.title === "T2")!;
    expect(task2).toBeDefined();
    expect(task2.dependsOnTaskIds || []).toEqual([task1.id]);
    expect(task2.priority).toBe("medium");

    // Sprint goal is not updated by planSprint!
    const updatedSprint = projectRepository.getSprint(sprint.id);
    expect(updatedSprint!.goal).toBe("Updated sprint goal");

    // Verify invocation lifecycle
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id });
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0];
    expect(invocation.status).toBe("completed");
    expect(invocation.type).toBe("planning");

    const messages = executionRepository.listExecutionInvocationMessages(invocation.id);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe("user");
    expect(messages[0].contentMarkdown).toContain("Turn sprint goals into concrete executable tasks.");
  });

  it("refreshes remote planning snapshots from the effective default branch instead of the current checkout", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();
    settingsRepository.saveProjectSettings(project.id, {
      git: {
        defaultBranch: "dev",
        githubMode: "REMOTE",
      },
    });
    const resolveCurrentBranchSpy = vi.spyOn(WorkspaceManager.prototype, "resolveCurrentBranch");
    const providerRunner = createPlanningProviderRunner(planningProviderPayload("Plan from remote dev"));
    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner,
    });

    await service.planSprint(project.id, sprint.id, {});

    expect(gitBranchSyncService.syncRemoteBranchIfAvailable).toHaveBeenCalledWith(
      project.baseDir,
      "dev",
      expect.objectContaining({
        githubToken: expect.any(String),
      }),
    );
    expect(WorkspaceManager.prototype.createSnapshotWorkspace).toHaveBeenCalledWith(
      project.baseDir,
      `planning-${project.id}-${sprint.id}`,
      {
        branch: "dev",
        fallbackBranch: undefined,
        remoteOnly: true,
      },
      { singleBranch: true },
    );
    expect(resolveCurrentBranchSpy).not.toHaveBeenCalled();
  });

  it("persists sprint-specific execution plan metadata for separate planning invocations", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint: firstSprint,
    } = await setupTestHarness({
      name: "First Planning Sprint",
      goal: "Plan the first sprint.",
    });
    const secondSprint = projectRepository.createSprint(project.id, {
      name: "Second Planning Sprint",
      goal: "Plan the second sprint.",
    });

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningTextProviderRunner([
        JSON.stringify(planningProviderPayload("First sprint task")),
        JSON.stringify(planningProviderPayload("Second sprint task")),
      ]),
    });

    const firstResult = await service.planSprint(project.id, firstSprint.id, {});
    const secondResult = await service.planSprint(project.id, secondSprint.id, {});

    const firstInvocation = executionRepository
      .listExecutionInvocations({ projectId: project.id, sprintId: firstSprint.id })
      .find((record) => record.sprintId === firstSprint.id);
    const secondInvocation = executionRepository
      .listExecutionInvocations({ projectId: project.id, sprintId: secondSprint.id })
      .find((record) => record.sprintId === secondSprint.id);
    expect(firstInvocation).toBeDefined();
    expect(secondInvocation).toBeDefined();

    const firstMessage = findCompletedExecutionPlanMessage(executionRepository, firstInvocation!.id);
    const secondMessage = findCompletedExecutionPlanMessage(executionRepository, secondInvocation!.id);
    const firstPlan = firstMessage?.metadata?.executionPlan as {
      projectId: string;
      sprintId: string;
      sprintName: string;
      taskCount: number;
      createdTaskIds: string[];
      tasks: Array<{ title: string }>;
    } | undefined;
    const secondPlan = secondMessage?.metadata?.executionPlan as {
      projectId: string;
      sprintId: string;
      sprintName: string;
      taskCount: number;
      createdTaskIds: string[];
      tasks: Array<{ title: string }>;
    } | undefined;

    expect(firstPlan).toMatchObject({
      projectId: project.id,
      sprintId: firstSprint.id,
      sprintName: "First Planning Sprint",
      taskCount: 1,
      createdTaskIds: firstResult.createdTaskIds,
      tasks: [{ title: "First sprint task" }],
    });
    expect(secondPlan).toMatchObject({
      projectId: project.id,
      sprintId: secondSprint.id,
      sprintName: "Second Planning Sprint",
      taskCount: 1,
      createdTaskIds: secondResult.createdTaskIds,
      tasks: [{ title: "Second sprint task" }],
    });
    expect(firstPlan?.sprintId).not.toBe(secondPlan?.sprintId);
    expect(firstMessage?.contentMarkdown).toContain("- `T01` - First sprint task");
    expect(secondMessage?.contentMarkdown).toContain("- `T01` - Second sprint task");
  });

  it("auto-starts after planning when self-reflection is disabled", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningProviderRunner(planningProviderPayload("Autostart disabled reflection task")),
    });

    const result = await service.planSprint(project.id, sprint.id, { autoStart: true });

    expect(result.started).toBe(true);
    expect(projectRepository.listTasks(project.id, sprint.id)).toHaveLength(1);
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledTimes(1);
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith(project.id, sprint.id);
  });

  it("auto-starts after planning self-reflection passes", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();
    enablePlanningSelfReflection(settingsRepository, project.id, 0);

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningTextProviderRunner([
        JSON.stringify(planningProviderPayload("Passing reflected task")),
        reflectionResult(9),
      ]),
    });

    const result = await service.planSprint(project.id, sprint.id, { autoStart: true });

    expect(result.started).toBe(true);
    expect(projectRepository.listTasks(project.id, sprint.id)).toHaveLength(1);
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledTimes(1);
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith(project.id, sprint.id);
    const invocation = executionRepository.listExecutionInvocations({ projectId: project.id })[0];
    const messages = executionRepository.listExecutionInvocationMessages(invocation.id);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          reflection: expect.objectContaining({
            finalDecision: "passed",
            passed: true,
          }),
        }),
      }),
    ]));
  });

  it("does not auto-start when planning self-reflection reaches max attempts without passing", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();
    enablePlanningSelfReflection(settingsRepository, project.id, 0);

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningTextProviderRunner([
        JSON.stringify(planningProviderPayload("Non-passing reflected task")),
        reflectionResult(5),
      ]),
    });

    const result = await service.planSprint(project.id, sprint.id, { autoStart: true });

    expect(result.started).toBe(false);
    expect(projectRepository.listTasks(project.id, sprint.id)).toHaveLength(1);
    expect(executionControlService.orchestrateSprint).not.toHaveBeenCalled();
    const invocation = executionRepository.listExecutionInvocations({ projectId: project.id })[0];
    const messages = executionRepository.listExecutionInvocationMessages(invocation.id);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          reflection: expect.objectContaining({
            finalDecision: "max_attempts_reached",
            passed: false,
          }),
        }),
      }),
    ]));
  });

  it("assigns a planning title to an untitled sprint", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness({ goal: "Initial Goal" });

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningProviderRunner({
        title: "API Contract Cleanup",
        goal: "Initial Goal",
        tasks: [
          {
            key: "T01",
            title: "T1",
            description: "D1",
            promptMarkdown: validPromptMarkdown,
            priority: "high",
            executorType: "auto",
            dependsOn: [],
          },
        ],
      }),
    });

    await service.planSprint(project.id, sprint.id, {});

    const updatedSprint = projectRepository.getSprint(sprint.id);
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id });
    const messages = executionRepository.listExecutionInvocationMessages(invocations[0].id);
    expect(sprint.isGeneratedName).toBe(true);
    expect(messages[0].contentMarkdown).toContain("Sprint Title Status: unset/generated; you may provide a concise title");
    expect(updatedSprint?.name).toBe("API Contract Cleanup");
    expect(updatedSprint?.isGeneratedName).toBe(false);
  });

  it("preserves a custom placeholder-like sprint title when planning returns a title", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness({ name: "Untitled sprint 1", goal: "Initial Goal" });

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningProviderRunner({
        title: "Provider Suggested Title",
        goal: "Initial Goal",
        tasks: [
          {
            key: "T01",
            title: "T1",
            description: "D1",
            promptMarkdown: validPromptMarkdown,
            priority: "high",
            executorType: "auto",
            dependsOn: [],
          },
        ],
      }),
    });

    await service.planSprint(project.id, sprint.id, {});

    const updatedSprint = projectRepository.getSprint(sprint.id);
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id });
    const messages = executionRepository.listExecutionInvocationMessages(invocations[0].id);
    expect(sprint.isGeneratedName).toBe(false);
    expect(messages[0].contentMarkdown).toContain("Sprint Title Status: custom user title; do not rename it");
    expect(updatedSprint?.name).toBe("Untitled sprint 1");
    expect(updatedSprint?.isGeneratedName).toBe(false);
  });

  it("preserves a custom sprint title when planning returns a title", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness({ name: "Custom Planning Sprint", goal: "Initial Goal" });

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner: createPlanningProviderRunner({
        title: "Provider Suggested Title",
        goal: "Initial Goal",
        tasks: [
          {
            key: "T01",
            title: "T1",
            description: "D1",
            promptMarkdown: validPromptMarkdown,
            priority: "high",
            executorType: "auto",
            dependsOn: [],
          },
        ],
      }),
    });

    await service.planSprint(project.id, sprint.id, { replan: true });

    const updatedSprint = projectRepository.getSprint(sprint.id);
    expect(sprint.isGeneratedName).toBe(false);
    expect(updatedSprint?.name).toBe("Custom Planning Sprint");
  });

  it("recovers from malformed JSON and successfully completes planning", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          nativeSessionId: null,
          usageTelemetry: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 20,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: "",
            nativeSessionId: null,
          },
          text: "I am an AI, here is the JSON:\n```json\n{ malformed\n```",
        })
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          nativeSessionId: null,
          usageTelemetry: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 20,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: "",
            nativeSessionId: null,
          },
          text: JSON.stringify({
            goal: "Updated sprint goal",
            tasks: [
              {
                key: "T01",
                title: "T1",
                description: "D1",
                promptMarkdown: validPromptMarkdown,
                priority: "high",
                executorType: "auto",
                dependsOn: [],
              }
            ]
          }),
        }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner,
    });

    await service.planSprint(project.id, sprint.id, {});

    // Verify task persistence
    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(1);

    // Verify invocation lifecycle
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id });
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0];
    expect(invocation.status).toBe("completed");
  });

  it("fails completely when encountering irrecoverable parse failures", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      settingsRepository,
      syncService,
      executionControlService,
      project,
      sprint,
    } = await setupTestHarness();

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn()
        .mockResolvedValue({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          nativeSessionId: null,
          usageTelemetry: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 20,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: "",
            nativeSessionId: null,
          },
          text: "I cannot give you JSON.",
        }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      providerRunner,
    });

    await expect(service.planSprint(project.id, sprint.id, {})).rejects.toThrow();

    // Verify no tasks were saved
    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(0);

    // Verify invocation lifecycle
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id });
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0];
    expect(invocation.status).toBe("failed");
    expect(invocation.errorMessage).toContain("Planning agent reply was not valid JSON");
  });
});
