import { afterEach, describe, expect, it, vi } from "vitest";
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
import * as providerRetryPolicy from "../../../src/shared/providers/provider-retry-policy.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("PlanningAgentService", () => {
  it("uses the Planning agent reply to improve prompts and create tasks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-agent-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      executionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: executionControlService as any,
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

    const connection = connectionRepository.upsertConnection({
      connectionKey: "planning-worker",
      displayName: "Planning Worker",
      role: "worker",
      transport: "stdio",
      status: "listening",
      capabilities: {
        listenMode: true,
      },
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const originalPostDashboardMessage = connectionRepository.postDashboardMessage.bind(connectionRepository);
    let replyIndex = 0;
    vi.spyOn(connectionRepository, "postDashboardMessage").mockImplementation((projectId, input) => {
      const message = originalPostDashboardMessage(projectId, input);
      const replyBodies = [
        '{"goal":"Sharper sprint prompt from the Planning agent."}',
        JSON.stringify({
          goal: "Sharper sprint prompt from the Planning agent.",
          tasks: [
            {
              key: "TASK-1",
              title: "Redesign sprint gallery",
              description: "Refresh the top sprint cells and completed-state visuals.",
              promptMarkdown: "Update the sprint gallery UI and completed-state styling.",
              priority: "high",
              executorType: "auto",
              dependsOn: [],
            },
            {
              key: "TASK-2",
              title: "Wire planning actions",
              description: "Connect improve and planning flows to worker-backed endpoints.",
              promptMarkdown: "Hook the sprint modal into Planning agent endpoints and verify behavior.",
              priority: "medium",
              executorType: "mcp_worker",
              dependsOn: ["TASK-1"],
            },
          ],
        }),
      ];
      const replyBody = replyBodies[replyIndex] || replyBodies[replyBodies.length - 1]!;
      replyIndex += 1;
      setTimeout(() => {
        connectionRepository.postListenReply({
          connectionKey: connection.connectionKey,
          threadId: message.threadId,
          bodyMarkdown: replyBody,
          replyToMessageId: message.id,
        });
      }, 10);
      return message;
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
    expect(createdTasks[1]?.executorType).toBe("mcp_worker");
  });

  it("accepts a listen-mode listener connection for planning flows", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-listener-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: {
        orchestrateSprint: vi.fn(async () => ({ ok: true })),
      } as any,
    });

    const project = projectRepository.createProject({
      name: "Listener Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    connectionRepository.upsertConnection({
      connectionKey: "gemini-cli",
      displayName: "Gemini CLI",
      role: "listener",
      transport: "stdio",
      status: "listening",
      capabilities: {
        listenMode: true,
      },
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const originalPostDashboardMessage = connectionRepository.postDashboardMessage.bind(connectionRepository);
    vi.spyOn(connectionRepository, "postDashboardMessage").mockImplementation((projectId, input) => {
      const message = originalPostDashboardMessage(projectId, input);
      setTimeout(() => {
        connectionRepository.postListenReply({
          connectionKey: "gemini-cli",
          threadId: message.threadId,
          bodyMarkdown: '{"goal":"Improved by listener connection."}',
          replyToMessageId: message.id,
        });
      }, 10);
      return message;
    });

    const improved = await service.improveSprintPrompt(project.id, {
      name: "Listener Sprint",
      goal: "Raw sprint prompt",
    });

    expect(improved.goal).toBe("Improved by listener connection.");
  });

  it("plans through a virtual worker when the project worker mode is virtual", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-virtual-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
            totalTokens: 355,
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
            totalTokens: 810,
            usageSource: "reported",
            rawUsageJson: { provider: "codex", phase: "plan" },
            transcriptText: JSON.stringify({
              goal: "Virtual worker improved sprint prompt.",
              tasks: [
                {
                  key: "TASK-1",
                  title: "Plan via virtual worker",
                  description: "Ensure planning runs without a connected MCP listener.",
                  promptMarkdown: "Use the virtual worker runtime to produce sprint tasks.",
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
                promptMarkdown: "Use the virtual worker runtime to produce sprint tasks.",
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
    expect(statsSnapshot.usage.totalTokens).toBe(1_165);
    expect(statsSnapshot.sprints[0]).toMatchObject({
      label: "Sprint 1 · Virtual Planning Sprint",
      usage: expect.objectContaining({
        totalTokens: 810,
      }),
    });
    expect(statsSnapshot.purposes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "planning",
        usage: expect.objectContaining({
          totalTokens: 1_165,
          invocationCount: 2,
        }),
      }),
    ]));
  });

  it("retries virtual planning on rate limit and records invocation error metadata", async () => {
    vi.spyOn(providerRetryPolicy, "sleepWithSignal").mockResolvedValue();

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-rate-limit-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-rate-limit-max-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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

  it("accepts loose virtual planning JSON with prose, subtasks, prompt, and dependencies fields", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-loose-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
            '  "subtasks": [',
            "    {",
            '      "id": "TASK-1",',
            '      "name": "First task",',
            '      "description": "Setup work",',
            '      "prompt": "Perform the setup work",',
            '      "priority": "HIGH",',
            '      "executorType": "AUTO"',
            "    },",
            "    {",
            '      "id": "TASK-2",',
            '      "name": "Second task",',
            '      "instructions": "Finish the follow-up work",',
            '      "dependencies": ["TASK-1"],',
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
    expect(createdTasks[1]?.executorType).toBe("mcp_worker");
    expect(createdTasks[1]?.dependsOnTaskIds).toHaveLength(1);
  });

  it("supports worker, virtual provider, and model overrides and explicit replanning", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-overrides-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
              promptMarkdown: "Prompt",
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
        executionMode: "CONNECTED_MCP",
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

    // Test virtual provider + model override even when connected workers are the project default
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

    // Test worker override (CONNECTED_MCP)
    const workerConnection = connectionRepository.upsertConnection({
      connectionKey: "custom-worker",
      displayName: "Custom Worker",
      role: "worker",
      transport: "stdio",
      status: "listening",
      capabilities: { listenMode: true },
      projectIds: [project.id],
    });

    const originalPostDashboardMessage = connectionRepository.postDashboardMessage.bind(connectionRepository);
    vi.spyOn(connectionRepository, "postDashboardMessage").mockImplementation((projectId, input) => {
      const message = originalPostDashboardMessage(projectId, input);
      setTimeout(() => {
        connectionRepository.postListenReply({
          connectionKey: "custom-worker",
          threadId: input.threadId,
          bodyMarkdown: '{"goal":"Improved by custom worker."}',
          replyToMessageId: message.id,
        });
      }, 10);
      return message;
    });

    const improved = await service.improveSprintPrompt(project.id, {
      name: "Sprint",
      goal: "Prompt",
      overrides: { workerId: workerConnection.id },
    });
    expect(improved.goal).toBe("Improved by custom worker.");
    expect(improved.workerConnectionId).toBe(workerConnection.id);

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

  it("targets a specific planning agent preset via overrides", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-preset-override-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
          tasks: [{ key: "T01", title: "Custom task", description: "D", promptMarkdown: "P", priority: "medium", executorType: "auto", dependsOn: [] }],
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

  it("aborts a virtual improveSprintPrompt request immediately without leaving side-effects", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-abort-improve-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-abort-plan-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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

  it("aborts a connected-worker polling loop when signal fires", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-abort-connected-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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

    const service = new PlanningAgentService({
      projectManagementRepository: projectRepository,
      connectionChatRepository: connectionRepository,
      settingsRepository,
      agentPresetSyncService: syncService,
      executionControlService: { orchestrateSprint: vi.fn() } as any,
    });

    const project = projectRepository.createProject({
      name: "Abort Connected Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    connectionRepository.upsertConnection({
      connectionKey: "abort-worker",
      displayName: "Abort Worker",
      role: "worker",
      transport: "stdio",
      status: "listening",
      capabilities: { listenMode: true },
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    // Do NOT mock postDashboardMessage to post a reply — the poll loop will wait forever
    const ac = new AbortController();
    const improvePromise = service.improveSprintPrompt(
      project.id,
      { name: "Sprint", goal: "A goal" },
      ac.signal,
    );

    // Give the poll loop one tick to start, then abort
    await new Promise((resolve) => setTimeout(resolve, 50));
    ac.abort();

    await expect(improvePromise).rejects.toThrow();
  });

  it("retries virtual planning requests on invalid JSON and recovers on success", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-retry-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
            tasks: [{ key: "T01", title: "Task 1", description: "D", promptMarkdown: "P", priority: "high", executorType: "auto", dependsOn: [] }],
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-planning-exhaust-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".sprint-os", "agents", "planning_agent.md"),
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
      cliWorkflow: { maxPlanningJsonRetries: 2 },
    });

    await expect(service.planSprint(project.id, sprint.id, { autoStart: false }))
      .rejects.toThrow("Planning agent reply was not valid JSON.");

    const calls = vi.mocked(providerRunner.runProviderForText).mock.calls;
    // 1 initial attempt + 2 retries = 3 calls
    expect(calls).toHaveLength(3);
    expect(calls[1]?.[0]?.continueSessionId).toBe("native-123");
    expect(calls[2]?.[0]?.continueSessionId).toBe("native-123");
  });
});
