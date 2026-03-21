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

const tempDirs: string[] = [];

afterEach(async () => {
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
    expect(createdTasks[0]?.promptMarkdown).toBe("Perform the setup work");
    expect(createdTasks[0]?.priority).toBe("high");
    expect(createdTasks[1]?.executorType).toBe("mcp_worker");
    expect(createdTasks[1]?.dependsOnTaskIds).toHaveLength(1);
  });
});
