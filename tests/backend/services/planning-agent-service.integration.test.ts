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

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("PlanningAgentService Integration", () => {
  beforeEach(() => {
    vi.spyOn(WorkspaceManager.prototype, "createSnapshotWorkspace")
      .mockResolvedValue("docker-volume://planning-test");
    vi.spyOn(WorkspaceManager.prototype, "removeWorktree")
      .mockResolvedValue(undefined);
    vi.spyOn(WorkspaceManager.prototype, "readWorkspaceFile")
      .mockResolvedValue("## Category: Patterns\n- prefer consistent planning context\n");
  });

  async function setupTestHarness() {
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
    const sprint = projectRepository.createSprint(project.id, {
      name: "Planning Sprint",
      goal: "Initial Goal",
    });

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
