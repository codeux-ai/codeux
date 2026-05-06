import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryService } from "../../../src/services/memory-service.js";
import { PlanningAgentService } from "../../../src/services/planning-agent-service.js";
import { QualityAssuranceService } from "../../../src/services/quality-assurance-service.js";
import { executeMemoryCaptureStage } from "../../../src/services/cli-workflow/pipeline/memory-capture-stage.js";
import { LEARNINGS_FILENAME } from "../../../src/contracts/memory-types.js";
import { WorkspaceManager } from "../../../src/infrastructure/providers/cli/workspace-manager.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { MemoryRepository } from "../../../src/repositories/memory-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { join } from "path";
import * as os from "os";

const tempDirs: string[] = [];

describe("Memory Capture Integration", () => {
  let memoryService: MemoryService;
  let memoryRepository: MemoryRepository;
  let appDbStorage: AppDbStorage;
  let projectRepo: ProjectManagementRepository;
  let projectId: string;

  beforeEach(() => {
    const dir = os.tmpdir();
    const tmpDir = join(dir, `code-ux-test-${Date.now()}`);
    fsSync.mkdirSync(tmpDir, { recursive: true });
    tempDirs.push(tmpDir);
    appDbStorage = new AppDbStorage(join(tmpDir, "app.db"));
    appDbStorage.db.exec("PRAGMA foreign_keys = OFF;");

    memoryRepository = new MemoryRepository(appDbStorage);
    memoryService = new MemoryService(memoryRepository, { isLoaded: () => true, embedText: async () => ({ vector: new Float32Array(0), model: "test" }) } as any, { warn: () => {} } as any);
    projectRepo = new ProjectManagementRepository(appDbStorage);
    projectId = projectRepo.createProject({
      name: "Test Project",
      sourceType: "local",
      sourceRef: tmpDir
    }).id;
    vi.spyOn(WorkspaceManager.prototype, "createSnapshotWorkspace")
      .mockResolvedValue("docker-volume://planning-test");
    vi.spyOn(WorkspaceManager.prototype, "removeWorktree")
      .mockResolvedValue(undefined);
    vi.spyOn(WorkspaceManager.prototype, "readWorkspaceFile")
      .mockResolvedValue("## Category: Patterns\n- plan carefully again\n");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
  });

  it("should capture memory learnings correctly using pipeline", async () => {
    const worktreePath = await fs.mkdtemp(join(os.tmpdir(), "code-ux-test-"));
    tempDirs.push(worktreePath);

    const learningsContent = `
## Category: Patterns
- Always use explicit types for API inputs
## Category: Error
- Type casting with as causes silent runtime errors
`;
    await fs.writeFile(join(worktreePath, LEARNINGS_FILENAME), learningsContent);

    const ctx = {
      sessionId: "session-1",
      taskRunId: "task-run-1",
      agentPresetId: "agent-worker",
      worktreePath,
      settings: {
        memory: {
          enabled: true,
          autoCaptureSprint: true
        }
      },
      deps: {
        memoryService,
        executionRepository: {
          getTaskRun: vi.fn().mockReturnValue({ projectId, sprintId: "sprint-1" })
        },
        sessionTracking: {
          appendActivity: vi.fn()
        }
      }
    } as any;

    const result = await executeMemoryCaptureStage(ctx);
    expect(result.memoriesCaptured).toBe(2);

    const memories = memoryRepository.listByProject(projectId, "sprint");
    expect(memories.length).toBe(2);
    const categories = memories.map(m => m.category).sort();
    expect(categories).toEqual(["error", "patterns"]);
    expect(memories[0].agentPresetId).toBe("agent-worker");
    expect(memories[0].source.originId).toBe("task-run-1");
  });

  it("should correctly resolve override instruction templates in PlanningAgentService", async () => {
    const globalInstruction = "Global: Please write learnings.";
    const agentOverride = "Override: Write highly technical learnings.";

    let capturedPrompt = "";
    const providerRunnerMock = {
      execute: vi.fn().mockImplementation(async (args) => {
        capturedPrompt = JSON.stringify(args);
        return {
          ok: true, text: JSON.stringify({ goal: "improved", tasks: [] }), usageTelemetry: { transcriptText: "", inputTokens: 0, cachedInputTokens: 0 }
        };
      }),
      runProvider: vi.fn().mockImplementation(async (args) => {
        capturedPrompt = JSON.stringify(args);
        return {
          ok: true, text: JSON.stringify({ goal: "improved", tasks: [] }), usageTelemetry: { transcriptText: "", inputTokens: 0, cachedInputTokens: 0 }
        };
      }),
      runProviderForText: vi.fn().mockImplementation(async (args) => { capturedPrompt = JSON.stringify(args); fsSync.writeFileSync(join(projectRepo.getProject(projectId)!.baseDir, LEARNINGS_FILENAME), `## Category: Patterns\n- plan carefully again\n`);
        return {
          ok: true, text: JSON.stringify({ goal: "improved", tasks: [] }), usageTelemetry: { transcriptText: "", inputTokens: 0, cachedInputTokens: 0 }
        };
      }),
      executeStructured: vi.fn().mockImplementation(async (args) => {
        capturedPrompt = JSON.stringify(args);
        return { parsed: { goal: "improved", tasks: [] } };
      }),
    };

    const deps = {
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue(projectRepo.getProject(projectId)),
        getSprint: vi.fn().mockReturnValue({
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Goal"
        })
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue("inv-1"),
        updateExecutionInvocation: vi.fn(),
        appendExecutionInvocationMessage: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue("usage-1"),
        updateProviderInvocationUsage: vi.fn(),
      } as any,
      settingsRepository: {
        resolveProjectDashboardSettings: vi.fn().mockReturnValue({ settings: {
          ...DEFAULT_DASHBOARD_SETTINGS,
          memory: { enabled: true, autoCaptureSprint: true, workerLearningsInstruction: globalInstruction },
            workers: { ...DEFAULT_DASHBOARD_SETTINGS.workers, executionMode: "VIRTUAL", virtualWorkerProvider: "gemini" },
            aiProvider: DEFAULT_DASHBOARD_SETTINGS.aiProvider
          } })
      } as any,
      agentPresetSyncService: {
        resolveTargetedPlanningAgent: vi.fn().mockResolvedValue({
          id: "agent-plan",
          instructionMarkdown: "I am planning agent.",
          memoryTemplateOverrideEnabled: true,
          memoryTemplateMarkdown: agentOverride
        }),
      } as any,
      executionControlService: {} as any,
      providerRunner: providerRunnerMock as any,
      logger: { warn: (msg, obj) => { const e = new Error(obj?.error || msg); e.stack = obj?.error?.stack || e.stack; throw e; }, info: vi.fn(), error: (msg, obj) => { const e = new Error(obj?.error || msg); e.stack = obj?.error?.stack || e.stack; throw e; } } as any,
      memoryService,
    };

    const planningAgentService = new PlanningAgentService(deps);

    await planningAgentService.improveSprintPrompt(projectId, {
      sessionId: "session-1",
      agentPresetId: "agent-plan",
      name: "Sprint 1",
      goal: "Make it better",
      overrides: {}
    } as any);

    expect(capturedPrompt).toContain(agentOverride);
    expect(capturedPrompt).not.toContain(globalInstruction);

    // Now test with override disabled
    deps.agentPresetSyncService.resolveTargetedPlanningAgent = vi.fn().mockResolvedValue({
      id: "agent-plan",
      instructionMarkdown: "I am planning agent.",
      memoryTemplateOverrideEnabled: false,
      memoryTemplateMarkdown: agentOverride
    });

    await planningAgentService.improveSprintPrompt(projectId, {
      sessionId: "session-2",
      agentPresetId: "agent-plan",
      name: "Sprint 1",
      goal: "Make it better",
      overrides: {}
    } as any);

    expect(capturedPrompt).not.toContain(agentOverride);
    expect(capturedPrompt).toContain(globalInstruction);

    // Now test with override enabled but empty template
    deps.agentPresetSyncService.resolveTargetedPlanningAgent = vi.fn().mockResolvedValue({
      id: "agent-plan",
      instructionMarkdown: "I am planning agent.",
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "   \n"
    });

    await planningAgentService.improveSprintPrompt(projectId, {
      sessionId: "session-3",
      agentPresetId: "agent-plan",
      name: "Sprint 1",
      goal: "Make it better",
      overrides: {}
    } as any);

    expect(capturedPrompt).not.toContain(agentOverride);
    expect(capturedPrompt).toContain(globalInstruction);

    // Wait a tick for async memory capture to finish
    await new Promise(r => setTimeout(r, 50));
    fsSync.writeFileSync(join(projectRepo.getProject(projectId)!.baseDir, LEARNINGS_FILENAME), `## Category: Planning\n- plan carefully again`);
     const planningMemories = memoryRepository.listByProject(projectId, "sprint").filter(m => m.agentPresetId === "agent-plan");
    expect(planningMemories.length).toBeGreaterThan(0);
    const hasLearning = planningMemories.some(m => m.category === "patterns");
    expect(hasLearning).toBe(true);
  });

  it("should correctly resolve override instruction templates in QualityAssuranceService", async () => {
    const globalInstruction = "Global: Please write QA learnings.";
    const agentOverride = "Override: Write highly technical QA learnings.";

    let capturedPrompt = "";
    const providerRunnerMock = {
      runProviderForText: vi.fn().mockImplementation(async (args) => {
        capturedPrompt = JSON.stringify(args); fsSync.writeFileSync(join(projectRepo.getProject(projectId)!.baseDir, LEARNINGS_FILENAME), `## Category: Patterns\n- qa carefully\n`);
        return { ok: true, text: JSON.stringify({ verdict: "pass", summary: "ok" }), usageTelemetry: { transcriptText: "", inputTokens: 0, cachedInputTokens: 0 } };
      }),
    };

    const deps = {
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue(projectRepo.getProject(projectId)),
        getSprint: vi.fn().mockReturnValue({
          id: "sprint-1",
          name: "Sprint 1",
          goal: "Goal"
        }),
        listTasks: vi.fn().mockReturnValue([])
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue("inv-1"),
        updateExecutionInvocation: vi.fn(),
        appendExecutionInvocationMessage: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue("usage-1"),
        updateProviderInvocationUsage: vi.fn(),
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null)
      } as any,
      qaReviewRepository: {
        createRun: vi.fn().mockReturnValue({ id: "run-1" }),
        updateRun: vi.fn(),
        countRunsByTask: vi.fn().mockReturnValue(0),
        getLatestRunByTask: vi.fn().mockReturnValue(null),
        countTaskRuns: vi.fn().mockReturnValue(0),
        getLatestSprintRun: vi.fn().mockReturnValue(null),
        countSprintRuns: vi.fn().mockReturnValue(0),
      } as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: vi.fn().mockResolvedValue({
          id: "agent-qa",
          name: "agent-qa",
          instructionMarkdown: "I am QA agent.",
          memoryTemplateOverrideEnabled: true,
          memoryTemplateMarkdown: agentOverride
        }),
      } as any,
      sessionTracking: {} as any,
      taskService: { resolveInvocationProvider: vi.fn().mockReturnValue({ provider: "gemini", providers: { gemini: { thinkingMode: "none" } } }) } as any,
      providerRunner: providerRunnerMock as any,
      getDashboardSettings: vi.fn().mockReturnValue({
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: true, autoCaptureSprint: true, workerLearningsInstruction: globalInstruction },
        agents: {
          qualityAssurance: {
            enabled: true,
            sprintCompletion: { enabled: true, agentPresetId: "qa" },
            maxTaskReviewRuns: 2,
            completedTaskWithoutPr: { enabled: true, agentPresetId: "qa" },
            taskCompletion: { enabled: true, agentPresetId: "qa" }
          }
        },
        aiProvider: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider, providers: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers, mock: { thinkingMode: "none" }, gemini: { thinkingMode: "none" }, codex: { thinkingMode: "none" } }, invocationRouting: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting, qa_review: { provider: "gemini", allowedProviders: ["gemini"] } } },
        cliWorkflow: { executionMode: "local" },
        workers: { ...DEFAULT_DASHBOARD_SETTINGS.workers, executionMode: "VIRTUAL", virtualWorkerProvider: "gemini" }
      }),
      logger: { warn: (msg, obj) => { const e = new Error(obj?.error || msg); e.stack = obj?.error?.stack || e.stack; throw e; }, info: vi.fn(), error: (msg, obj) => { const e = new Error(obj?.error || msg); e.stack = obj?.error?.stack || e.stack; throw e; } } as any,
      memoryService,
    };

    const qaService = new QualityAssuranceService(deps as any);


    (qaService as any).workspaceManager = {
      resolveResumeWorktreePath: vi.fn().mockResolvedValue(projectRepo.getProject(projectId)!.baseDir),
      buildWorktreePath: vi.fn().mockReturnValue(projectRepo.getProject(projectId)!.baseDir),
      prepareWorktree: vi.fn(),
    };
    (qaService as any).workspacePathExists = vi.fn().mockResolvedValue(true);

    fsSync.writeFileSync(join(projectRepo.getProject(projectId)!.baseDir, LEARNINGS_FILENAME), `## Category: QA\n- qa carefully`);
    const res1 = await qaService.reviewSprintCompletion({
      projectId,
      sprintId: "sprint-1",
      repoPath: projectRepo.getProject(projectId)!.baseDir,
      subtasks: [],
      sprintRunId: "run-1"
    });

    expect(capturedPrompt).toContain(agentOverride);
    expect(capturedPrompt).not.toContain(globalInstruction);

    deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent = vi.fn().mockResolvedValue({
      id: "agent-qa",
      name: "agent-qa",
      instructionMarkdown: "I am QA agent.",
      memoryTemplateOverrideEnabled: false,
      memoryTemplateMarkdown: agentOverride
    });

    const res2 = await qaService.reviewSprintCompletion({
      projectId,
      sprintId: "sprint-1",
      repoPath: projectRepo.getProject(projectId)!.baseDir,
      subtasks: [],
      sprintRunId: "run-1"
    });

    expect(capturedPrompt).not.toContain(agentOverride);
    expect(capturedPrompt).toContain(globalInstruction);

    // Now test with override enabled but empty template
    deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent = vi.fn().mockResolvedValue({
      id: "agent-qa",
      name: "agent-qa",
      instructionMarkdown: "I am QA agent.",
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "   \n"
    });

    const res3 = await qaService.reviewSprintCompletion({
      projectId,
      sprintId: "sprint-1",
      repoPath: projectRepo.getProject(projectId)!.baseDir,
      subtasks: [],
      sprintRunId: "run-1"
    });

    expect(capturedPrompt).not.toContain(agentOverride);
    expect(capturedPrompt).toContain(globalInstruction);

    // Wait a tick for async memory capture to finish
    await new Promise(r => setTimeout(r, 50));
    const qaMemories = memoryRepository.listByProject(projectId, "sprint").filter(m => m.agentPresetId === "agent-qa");
    expect(qaMemories.length).toBeGreaterThan(0);
    expect(qaMemories[0].category).toBe("patterns");
    expect(qaMemories[0].agentPresetId).toBe("agent-qa");
  });
});
