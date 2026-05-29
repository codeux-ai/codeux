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
import { PlanningParseError } from "../../../src/services/planning-json-extractor.js";
import type { IProviderRunner } from "../../../src/infrastructure/providers/cli/provider-runner.js";
import { WorkspaceManager } from "../../../src/infrastructure/providers/cli/workspace-manager.js";
import * as providerRetryPolicy from "../../../src/shared/providers/provider-retry-policy.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});



describe("PlanningAgentService", () => {
  beforeEach(() => {
    vi.spyOn(WorkspaceManager.prototype, "createSnapshotWorkspace")
      .mockResolvedValue("docker-volume://planning-test");
    vi.spyOn(WorkspaceManager.prototype, "removeWorktree")
      .mockResolvedValue(undefined);
    vi.spyOn(WorkspaceManager.prototype, "readWorkspaceFile")
      .mockResolvedValue("## Category: Patterns\n- prefer consistent planning context\n");
  });

  it("uses the Planning agent reply to improve prompts and create tasks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-agent-"));
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
            inputTokens: 20,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 30,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: '{"goal":"Sharper sprint prompt from the Planning agent."}',
            nativeSessionId: null,
          },
          text: '{"goal":"Sharper sprint prompt from the Planning agent."}',
        })
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          nativeSessionId: null,
          usageTelemetry: {
            inputTokens: 40,
            cachedInputTokens: 0,
            outputTokens: 20,
            reasoningOutputTokens: 0,
            totalTokens: 60,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: JSON.stringify({
              goal: "Sharper sprint prompt from the Planning agent.",
              tasks: [
                {
                  key: "TASK-1",
                  title: "Redesign sprint gallery",
                  description: "Refresh the top sprint cells and completed-state visuals.",
                  promptMarkdown: "## Objective\nUpdate the sprint gallery UI and completed-state styling.\n\n## Scope\n- UI components\n\n## Implementation Requirements\n1. Refresh cells\n\n## Constraints\n- Keep it fast\n\n## Verification\n- Visual check",
                  priority: "high",
                  executorType: "auto",
                  dependsOn: [],
                },
                {
                  key: "TASK-2",
                  title: "Wire planning actions",
                  description: "Connect improve and planning flows to the isolated runtime.",
                  promptMarkdown: "## Objective\nHook the sprint modal into Planning agent endpoints and verify behavior.\n\n## Scope\n- Modal components\n\n## Implementation Requirements\n1. Connect actions\n\n## Constraints\n- Use isolated runtime\n\n## Verification\n- Integration test",
                  priority: "medium",
                  executorType: "docker_cli",
                  dependsOn: ["TASK-1"],
                },
              ],
            }),
            nativeSessionId: null,
          },
          text: JSON.stringify({
            goal: "Sharper sprint prompt from the Planning agent.",
            tasks: [
              {
                key: "TASK-1",
                title: "Redesign sprint gallery",
                description: "Refresh the top sprint cells and completed-state visuals.",
                promptMarkdown: "## Objective\nUpdate the sprint gallery UI and completed-state styling.\n\n## Scope\n- UI components\n\n## Implementation Requirements\n1. Refresh cells\n\n## Constraints\n- Keep it fast\n\n## Verification\n- Visual check",
                priority: "high",
                executorType: "auto",
                dependsOn: [],
              },
              {
                key: "TASK-2",
                title: "Wire planning actions",
                description: "Connect improve and planning flows to the isolated runtime.",
                promptMarkdown: "## Objective\nHook the sprint modal into Planning agent endpoints and verify behavior.\n\n## Scope\n- Modal components\n\n## Implementation Requirements\n1. Connect actions\n\n## Constraints\n- Use isolated runtime\n\n## Verification\n- Integration test",
                priority: "medium",
                executorType: "docker_cli",
                dependsOn: ["TASK-1"],
              },
            ],
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

    const project = projectRepository.createProject({
      name: "Worker Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Planning Sprint",
      goal: "Polish the sprint page and make planning automatic.",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    const improved = await service.improveSprintPrompt(project.id, {
      name: sprint.name,
      goal: sprint.goal,
    });
    expect(improved.goal).toBe("Sharper sprint prompt from the Planning agent.");

    const planned = await service.planSprint(project.id, sprint.id, { autoStart: true });
    expect(planned.createdTaskIds).toHaveLength(2);
    expect(planned.started).toBe(true);
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith(project.id, sprint.id);

    const createdTasks = projectRepository.listTasks(project.id, sprint.id);
    expect(createdTasks).toHaveLength(2);
    expect(createdTasks[1]?.dependsOnTaskIds).toHaveLength(1);
    expect(createdTasks[1]?.executorType).toBe("docker_cli");
  });

  it("plans through a virtual worker when the project worker mode is virtual", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-virtual-"));
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
            inputTokens: 220,
            cachedInputTokens: 40,
            outputTokens: 80,
            reasoningOutputTokens: 15,
            totalTokens: 300,
            usageSource: "reported",
            rawUsageJson: { provider: "codex", phase: "improve" },
            transcriptText: '{"goal":"Virtual worker improved sprint prompt."}',
            nativeSessionId: null,
          },
          text: '{"goal":"Virtual worker improved sprint prompt."}',
        })
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          nativeSessionId: null,
          usageTelemetry: {
            inputTokens: 540,
            cachedInputTokens: 60,
            outputTokens: 190,
            reasoningOutputTokens: 20,
            totalTokens: 730,
            usageSource: "reported",
            rawUsageJson: { provider: "codex", phase: "plan" },
            transcriptText: JSON.stringify({
              goal: "Virtual worker improved sprint prompt.",
              tasks: [
                {
                  key: "TASK-1",
                  title: "Plan via virtual worker",
                  description: "Ensure planning runs without a connected MCP listener.",
                  promptMarkdown: "## Objective\nUse the virtual worker runtime to produce sprint tasks.\n\n## Scope\n- Planning service\n\n## Implementation Requirements\n1. Run virtual\n\n## Constraints\n- No live MCP\n\n## Verification\n- Tasks created",
                  priority: "medium",
                  executorType: "auto",
                  dependsOn: [],
                },
              ],
            }),
            nativeSessionId: null,
          },
          text: JSON.stringify({
            goal: "Virtual worker improved sprint prompt.",
            tasks: [
              {
                key: "TASK-1",
                title: "Plan via virtual worker",
                description: "Ensure planning runs without a connected MCP listener.",
                promptMarkdown: "## Objective\nUse the virtual worker runtime to produce sprint tasks.\n\n## Scope\n- Planning service\n\n## Implementation Requirements\n1. Run virtual\n\n## Constraints\n- No live MCP\n\n## Verification\n- Tasks created",
                priority: "medium",
                executorType: "auto",
                dependsOn: [],
              },
            ],
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

    const project = projectRepository.createProject({
      name: "Virtual Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Virtual Planning Sprint",
      goal: "Plan with no live MCP worker attached.",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "codex",
      },
    });

    const improved = await service.improveSprintPrompt(project.id, {
      name: sprint.name,
      goal: sprint.goal,
    });
    expect(improved.goal).toBe("Virtual worker improved sprint prompt.");
    expect(improved.workerConnectionId).toBeNull();

    const planned = await service.planSprint(project.id, sprint.id, { autoStart: true });
    expect(planned.createdTaskIds).toHaveLength(1);
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith(project.id, sprint.id);

    expect(providerRunner.runProviderForText).toHaveBeenCalledTimes(2);
    const planPrompt = vi.mocked(providerRunner.runProviderForText).mock.calls[1]?.[0]?.prompt ?? "";
    expect(planPrompt).toContain("Plan as a DAG, not as a flat checklist.");
    expect(planPrompt).toContain("Each task key must use `T01`, `T02`, `T03`, ... in topological order.");
    expect(planPrompt).toContain("## Example Output A");
    expect(planPrompt).toContain("## Example Output B");
    expect(planPrompt).toContain("## Objective\\n...\\n\\n## Scope");
    const createdTasks = projectRepository.listTasks(project.id, sprint.id);
    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0]?.title).toBe("Plan via virtual worker");

    const statsSnapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(statsSnapshot.usage.totalTokens).toBe(1_030);
    expect(statsSnapshot.sprints[0]).toMatchObject({
      label: "Sprint 1 · Virtual Planning Sprint",
      usage: expect.objectContaining({
        totalTokens: 730,
      }),
    });
    expect(statsSnapshot.purposes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "planning",
        usage: expect.objectContaining({
          totalTokens: 1_030,
          invocationCount: 2,
        }),
      }),
    ]));
  });

  it("retries virtual planning on rate limit and records invocation error metadata", async () => {
    vi.spyOn(providerRetryPolicy, "sleepWithSignal").mockResolvedValue();

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-rate-limit-"));
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
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          stdout: "",
          stderr: "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'",
          code: 1,
          signal: null,
          nativeSessionId: "native-rate-limit",
          usageTelemetry: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
            usageSource: "unavailable",
            rawUsageJson: {},
            transcriptText: "",
            nativeSessionId: null,
          },
          text: "",
        })
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          nativeSessionId: "native-ok",
          usageTelemetry: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 20,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: '{"goal":"Recovered after rate limit."}',
            nativeSessionId: "native-ok",
          },
          text: '{"goal":"Recovered after rate limit."}',
        }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Rate Limited Planning Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
      },
      cliWorkflow: {
        retryOnRateLimit: true,
        rateLimitRetryDelaySeconds: 1,
      },
    });

    const improvePromise = service.improveSprintPrompt(project.id, {
      name: "Retry sprint",
      goal: "Retry on rate limit",
    });

    const improved = await improvePromise;

    expect(improved.goal).toBe("Recovered after rate limit.");
    expect(providerRunner.runProviderForText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(providerRunner.runProviderForText).mock.calls[1]?.[0]?.continueSessionId).toBe("native-rate-limit");

    const [invocation] = executionRepository.listExecutionInvocations({ projectId: project.id });
    expect(invocation).toMatchObject({
      status: "completed",
      provider: "gemini",
      model: expect.any(String),
      lastErrorCategory: "RATE_LIMITED",
      lastErrorMessage: expect.stringContaining("rate-limited"),
    });

    const messages = executionRepository.listExecutionInvocationMessages(invocation.id);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          errorCategory: "RATE_LIMITED",
          model: invocation.model,
        }),
      }),
    ]));
    expect(providerRetryPolicy.sleepWithSignal).toHaveBeenCalledWith(1_000, undefined);
  });

  it("stops virtual planning rate-limit retries after the configured max", async () => {
    const sleepSpy = vi.spyOn(providerRetryPolicy, "sleepWithSignal").mockResolvedValue();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-rate-limit-max-"));
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
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          stdout: "",
          stderr: "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'",
          code: 1,
          signal: null,
          nativeSessionId: "native-rate-limit",
          usageTelemetry: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 10,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: "",
            nativeSessionId: "native-rate-limit",
          },
          text: "",
        })
        .mockResolvedValueOnce({
          ok: false,
          stdout: "",
          stderr: "code: 429, message: 'No capacity available for model gemini-3.1-pro-preview on the server'",
          code: 1,
          signal: null,
          nativeSessionId: "native-rate-limit",
          usageTelemetry: {
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 10,
            usageSource: "reported",
            rawUsageJson: {},
            transcriptText: "",
            nativeSessionId: "native-rate-limit",
          },
          text: "",
        }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Rate Limited Planning Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
      },
      cliWorkflow: {
        retryOnRateLimit: true,
        rateLimitRetryDelaySeconds: 1,
        maxRateLimitRetries: 1,
      },
    });

    await expect(service.improveSprintPrompt(project.id, {
      name: "Retry sprint",
      goal: "Retry on rate limit",
    })).rejects.toThrow("rate-limited");

    expect(providerRunner.runProviderForText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(providerRunner.runProviderForText).mock.calls[1]?.[0]?.continueSessionId).toBe("native-rate-limit");
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts virtual planning JSON with prose but rejects legacy shape fields", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-loose-"));
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
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          text: 'Here is the refined prompt:\n```json\n{"goal":"Loose improved prompt"}\n```',
        })
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          text: [
            "Planned sprint:",
            "{",
            '  "goal": "Loose improved prompt",',
            '  "tasks": [',
            "    {",
            '      "key": "TASK-1",',
            '      "title": "First task",',
            '      "description": "Setup work",',
            '      "promptMarkdown": "## Objective\\nPerform the setup work\\n\\n## Scope\\n- Setup\\n\\n## Implementation Requirements\\n1. Setup\\n\\n## Constraints\\n- None\\n\\n## Verification\\n- Done",',
            '      "priority": "HIGH",',
            '      "executorType": "AUTO",',
            '      "dependsOn": []',
            "    },",
            "    {",
            '      "key": "TASK-2",',
            '      "title": "Second task",',
            '      "description": "Follow-up",',
            '      "promptMarkdown": "## Objective\\nFinish the follow-up work\\n\\n## Scope\\n- Follow-up\\n\\n## Implementation Requirements\\n1. Follow-up\\n\\n## Constraints\\n- None\\n\\n## Verification\\n- Done",',
            '      "dependsOn": ["TASK-1"],',
            '      "executorType": "MCP_WORKER"',
            "    }",
            "  ]",
            "}",
          ].join("\n"),
        }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: {
        orchestrateSprint: vi.fn(async () => ({ ok: true })),
      } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Loose Virtual Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Loose Planning Sprint",
      goal: "Plan from permissive JSON.",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
      },
    });

    const improved = await service.improveSprintPrompt(project.id, {
      name: sprint.name,
      goal: sprint.goal,
    });
    expect(improved.goal).toBe("Loose improved prompt");

    await service.planSprint(project.id, sprint.id, { autoStart: false });
    const createdTasks = projectRepository.listTasks(project.id, sprint.id);
    expect(createdTasks).toHaveLength(2);
    expect(createdTasks[0]?.priority).toBe("high");
    expect(createdTasks[1]?.executorType).toBe("auto");
    expect(createdTasks[1]?.dependsOnTaskIds).toHaveLength(1);
  });

  it("supports virtual provider and model overrides and explicit replanning", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-overrides-"));
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
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        text: JSON.stringify({
          goal: "Overridden improved prompt.",
          tasks: [
            {
              key: "T01",
              title: "Overridden task",
              description: "Desc",
              promptMarkdown: "## Objective\nPrompt\n\n## Scope\n- Scope\n\n## Implementation Requirements\n1. Req\n\n## Constraints\n- Const\n\n## Verification\n- Verif",
              priority: "medium",
              executorType: "auto",
              dependsOn: [],
            },
          ],
        }),
        usageTelemetry: {
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 50,
          reasoningOutputTokens: 0,
          totalTokens: 150,
          usageSource: "reported",
          rawUsageJson: {},
          transcriptText: "",
          nativeSessionId: null,
        },
        nativeSessionId: "native-123",
      }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: {
        orchestrateSprint: vi.fn(async () => ({ ok: true })),
      } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Override Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Override Sprint",
      goal: "Goal",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "gemini",
      },
      aiProvider: {
        providers: {
          gemini: {
            apiKey: "gemini-key",
            model: "default-model",
            thinkingMode: "enabled",
          },
          codex: {
            apiKey: "codex-key",
            model: "codex-model",
            thinkingMode: "disabled",
          },
        },
      },
    });

    // Test virtual provider + model override
    await service.improveSprintPrompt(project.id, {
      name: "Sprint",
      goal: "Prompt",
      overrides: {
        virtualProvider: "codex",
        virtualModel: "custom-model",
      },
    });
    expect(providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      model: "custom-model",
    }));

    // Test replanning
    projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Old Task" });
    expect(projectRepository.listTasks(project.id, sprint.id)).toHaveLength(1);

    await service.planSprint(project.id, sprint.id, {
      autoStart: false,
      replan: true,
      overrides: {
        virtualProvider: "gemini",
        virtualModel: "plan-model",
      },
    });

    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Overridden task");
    expect(providerRunner.runProviderForText).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: "gemini",
      model: "plan-model",
    }));
  });

  it("forwards OpenCode custom provider settings for virtual planning", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-opencode-"));
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
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        text: '{"goal":"OpenCode planned sprint prompt."}',
        usageTelemetry: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          usageSource: "reported",
          rawUsageJson: {},
          transcriptText: "",
          nativeSessionId: null,
        },
        nativeSessionId: null,
      }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "OpenCode Planning Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const systemSettings = settingsRepository.getSystemSettings();
    settingsRepository.saveSystemSettings({
      ...systemSettings,
      integrations: {
        ...systemSettings.integrations,
        providers: {
          ...systemSettings.integrations.providers,
          opencode: {
            ...systemSettings.integrations.providers.opencode,
            apiKey: "opencode-custom-key",
            openCodeAuthMode: "CUSTOM_PROVIDER",
            openCodeProviderId: "ollama",
            openCodeModelId: "glm-4.7-flash",
            openCodeBaseUrl: "http://127.0.0.1:11434/v1",
            openCodeEnvKey: "OLLAMA_API_KEY",
            openCodePackage: "@ai-sdk/openai-compatible",
          },
        },
      },
    });
    settingsRepository.saveProjectSettings(project.id, {
      workers: {
        executionMode: "VIRTUAL",
        virtualWorkerProvider: "opencode",
      },
      aiProvider: {
        providers: {
          opencode: {
            enabled: true,
            model: "ollama/glm-4.7-flash",
            thinkingMode: "HIGH",
          },
        },
      },
    });

    await service.improveSprintPrompt(project.id, {
      name: "OpenCode Sprint",
      goal: "Use the custom OpenCode provider for planning.",
    });

    expect(providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      provider: "opencode",
      model: "ollama/glm-4.7-flash",
      apiKey: "opencode-custom-key",
      openCodeAuthMode: "CUSTOM_PROVIDER",
      openCodeProviderId: "ollama",
      openCodeModelId: "glm-4.7-flash",
      openCodeBaseUrl: "http://127.0.0.1:11434/v1",
      openCodeEnvKey: "OLLAMA_API_KEY",
      openCodePackage: "@ai-sdk/openai-compatible",
    }));
  });

  it("targets a specific planning agent preset via overrides", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-preset-override-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".code-ux", "agents", "planning_agent.md"),
      "Default planning instructions.\n",
      "utf8",
    );

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const connectionRepository = new ConnectionChatRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        text: JSON.stringify({
          goal: "Custom goal",
          tasks: [{ key: "T01", title: "Custom task", description: "D", promptMarkdown: "## Objective\\nP\\n\\n## Scope\\n- S\\n\\n## Implementation Requirements\\n1. R\\n\\n## Constraints\\n- C\\n\\n## Verification\\n- V", priority: "medium", executorType: "auto", dependsOn: [] }],
        }),
        usageTelemetry: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "reported", rawUsageJson: {}, transcriptText: "", nativeSessionId: null },
      }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: repoPath });
    const sprint = projectRepository.createSprint(project.id, { name: "S1", goal: "G1" });

    const customPlanner = agentPresetRepository.createAgentPreset(project.id, {
      name: "Specialized Planner",
      instructionMarkdown: "SPECIFIC_INSTRUCTIONS_FOR_PLANNING",
      labels: ["planning"],
    });

    await service.planSprint(project.id, sprint.id, {
      autoStart: false,
      overrides: {
        planningAgentPresetId: customPlanner.id,
        virtualProvider: "gemini",
      },
    });

    const calls = vi.mocked(providerRunner.runProviderForText).mock.calls;
    const lastPrompt = calls[calls.length - 1]?.[0]?.prompt ?? "";
    expect(lastPrompt).toContain("SPECIFIC_INSTRUCTIONS_FOR_PLANNING");
    expect(lastPrompt).not.toContain("Default planning instructions.");
  });

  it("uses default planning and manual worker routing from project settings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-routing-defaults-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".code-ux", "agents", "planning_agent.md"),
      "Default planning instructions.\n",
      "utf8",
    );

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const connectionRepository = new ConnectionChatRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });
    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        text: JSON.stringify({
          goal: "Routed goal",
          tasks: [{ key: "T01", title: "Routed task", description: "D", promptMarkdown: "## Objective\\nP\\n\\n## Scope\\n- S\\n\\n## Implementation Requirements\\n1. R\\n\\n## Constraints\\n- C\\n\\n## Verification\\n- V", priority: "medium", executorType: "auto", dependsOn: [] }],
        }),
        usageTelemetry: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "reported", rawUsageJson: {}, transcriptText: "", nativeSessionId: null },
      }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: repoPath });
    const sprint = projectRepository.createSprint(project.id, { name: "S1", goal: "G1" });
    const defaultPlanner = agentPresetRepository.createAgentPreset(project.id, {
      name: "Default Planning Override",
      instructionMarkdown: "DEFAULT_PLANNER_FROM_SETTINGS",
      labels: [],
    });
    const defaultWorker = agentPresetRepository.createAgentPreset(project.id, {
      name: "Default Worker Override",
      instructionMarkdown: "DEFAULT_WORKER_FROM_SETTINGS",
      labels: [],
    });

    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        routing: {
          planning: { agentPresetId: defaultPlanner.id },
          taskCoding: {
            mode: "MANUAL",
            agentPresetId: defaultWorker.id,
            orchestratorAgentPresetIds: [],
          },
        },
      },
    });

    await service.planSprint(project.id, sprint.id, { autoStart: false });

    const prompt = vi.mocked(providerRunner.runProviderForText).mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain("DEFAULT_PLANNER_FROM_SETTINGS");
    expect(prompt).not.toContain("Default planning instructions.");
    expect(projectRepository.listTasks(project.id, sprint.id)[0]?.agentPresetId).toBe(defaultWorker.id);
  });

  it("aborts a virtual improveSprintPrompt request immediately without leaving side-effects", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-abort-improve-"));
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
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockImplementation(() => new Promise(() => {
        // never resolves — simulates a long-running provider call
      })),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Abort Improve Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "gemini" },
    });

    const ac = new AbortController();
    const improvePromise = service.improveSprintPrompt(
      project.id,
      { name: "Sprint", goal: "Some goal" },
      ac.signal,
    );

    // Abort before the provider can respond
    ac.abort();

    await expect(improvePromise).rejects.toThrow();

    // Verify the signal was passed to the provider runner
    const runCalls = vi.mocked(providerRunner.runProviderForText).mock.calls;
    if (runCalls.length > 0) {
      expect(runCalls[0]?.[0]?.signal).toBe(ac.signal);
    }
  });

  it("aborts a virtual planSprint replan request without deleting existing tasks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-abort-plan-"));
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
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockImplementation(() => new Promise(() => {
        // never resolves — simulates a long-running provider call
      })),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Abort Plan Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Abort Sprint",
      goal: "Goal",
    });

    // Create an existing task that must survive the aborted replan
    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Existing task that must survive",
    });
    expect(projectRepository.listTasks(project.id, sprint.id)).toHaveLength(1);

    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "gemini" },
    });

    const ac = new AbortController();
    const planPromise = service.planSprint(
      project.id,
      sprint.id,
      { autoStart: false, replan: true, overrides: { virtualProvider: "gemini" } },
      ac.signal,
    );

    ac.abort();

    await expect(planPromise).rejects.toThrow();

    // The existing task must still be present — replan must not delete tasks when aborted
    const tasksAfterAbort = projectRepository.listTasks(project.id, sprint.id);
    expect(tasksAfterAbort).toHaveLength(1);
    expect(tasksAfterAbort[0]?.title).toBe("Existing task that must survive");
  });

  it("retries virtual planning requests on invalid JSON and recovers on success", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-retry-"));
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

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          text: "I cannot give you JSON, but here are my thoughts. We need two tasks.",
          usageTelemetry: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30, usageSource: "reported", rawUsageJson: {}, transcriptText: "", nativeSessionId: "native-123" },
          nativeSessionId: "native-123",
        })
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          code: 0,
          signal: null,
          text: JSON.stringify({
            goal: "Goal",
            tasks: [{ key: "T01", title: "Task 1", description: "D", promptMarkdown: "## Objective\nP\n\n## Scope\n- S\n\n## Implementation Requirements\n1. R\n\n## Constraints\n- C\n\n## Verification\n- V", priority: "high", executorType: "auto", dependsOn: [] }],
          }),
          usageTelemetry: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 0, totalTokens: 90, usageSource: "reported", rawUsageJson: {}, transcriptText: "", nativeSessionId: "native-123" },
          nativeSessionId: "native-123",
        }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Retry Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Retry Sprint",
      goal: "Goal",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "claude-code" },
      cliWorkflow: { maxPlanningJsonRetries: 3 },
    });

    await service.planSprint(project.id, sprint.id, { autoStart: false });

    const calls = vi.mocked(providerRunner.runProviderForText).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]?.continueSessionId).toBe("native-123");
    expect(calls[1]?.[0]?.prompt).toContain("Your previous output could not be parsed as valid JSON");

    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Task 1");
  });

  it("exhausts virtual planning retry budget and throws", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-exhaust-"));
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

    const providerRunner: IProviderRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        text: "Still not JSON.",
        usageTelemetry: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0, totalTokens: 20, usageSource: "reported", rawUsageJson: {}, transcriptText: "", nativeSessionId: "native-123" },
        nativeSessionId: "native-123",
      }),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
      providerRunner,
    });

    const project = projectRepository.createProject({
      name: "Exhaust Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Exhaust Sprint",
      goal: "Goal",
    });

    settingsRepository.saveProjectSettings(project.id, {
      workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "claude-code" },
      cliWorkflow: { maxParsingRetries: 2, maxPlanningJsonRetries: 2 },
    });

    await expect(service.planSprint(project.id, sprint.id, { autoStart: false }))
      .rejects.toThrow("Planning agent reply was not valid JSON.");

    const calls = vi.mocked(providerRunner.runProviderForText).mock.calls;
    // 1 initial attempt + 2 retries = 3 calls
    expect(calls).toHaveLength(3);
    expect(calls[1]?.[0]?.continueSessionId).toBe("native-123");
    expect(calls[2]?.[0]?.continueSessionId).toBe("native-123");
  });

  it("emits planning_parse_failure_blocked event when JSON parsing fails completely", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-planning-agent-failure-"));
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
          transcriptText: "This is completely malformed text that has no JSON.",
          nativeSessionId: null,
        },
        text: "This is completely malformed text that has no JSON.",
      }),
      invokeMcpTool: vi.fn(),
    };

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: new ConnectionChatRepository(storage),
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
      settingsRepository,
      providerRunner,
      executionRepository,
    });

    const project = projectRepository.createProject({
      name: "Test Project",
      key: "TEST",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Test failure",
      showcasePinned: true,
    });

    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "mcp",
      triggeredBy: "system",
      executorMode: "mixed",
      status: "running"
    });

    await expect(service.planSprint(project.id, sprint.id, { autoStart: false, sprintRunId: sprintRun.id })).rejects.toThrow(PlanningParseError);

    const events = executionRepository.listSprintRunEvents(sprintRun.id, 10);
    const failureEvent = events.find(e => e.eventType === "planning_parse_failure_blocked");
    expect(failureEvent).toBeDefined();
    expect(failureEvent?.payload).toMatchObject({
      reason: expect.stringContaining("JSON"),
      attempts: 0,
      rawResponse: "This is completely malformed text that has no JSON."
    });
  }, 30000);
});
