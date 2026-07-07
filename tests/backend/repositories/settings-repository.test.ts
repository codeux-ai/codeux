import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import {
  BUILTIN_CODE_UX_TECHSTACK_ID,
  CODEX_MODELS,
  DEFAULT_VIRTUAL_WORKER_MODELS,
} from "../../../src/repositories/settings-defaults.js";
import {
  CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
  DESIGN_GUIDANCE_NONE_ID,
} from "../../../src/domain/settings/design-guidance-catalog.js";

const tempDirs: string[] = [];
const openRepos: SettingsRepository[] = [];

const createRepo = async (): Promise<{ repo: SettingsRepository; dbPath: string; dir: string }> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-settings-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "settings.db");
  const repo = new SettingsRepository(dbPath);
  openRepos.push(repo);
  return { repo, dbPath, dir };
};

afterEach(async () => {
  const cacheResetDir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-settings-reset-"));
  tempDirs.push(cacheResetDir);
  const repo = new SettingsRepository(path.join(cacheResetDir, "settings.db"));
  repo.resetAllData();
  repo.close();
  for (const openRepo of openRepos.splice(0).reverse()) {
    try {
      openRepo.close();
    } catch {
      // Already closed by the test.
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SettingsRepository", () => {
  it("returns scoped defaults when db is empty", async () => {
    const { repo } = await createRepo();

    const system = repo.getSystemSettings();
    expect(system.runtime.dashboardPort).toBe(4444);
    expect(system.runtime.consoleLogLevel).toBe("info");
    expect(system.runtime.debugLogFileLevel).toBe("error");
    expect(system.runtime.consoleLogMode).toBe("standard");
    expect(system.runtime.restartSprintPolicy).toBe("continue");
    expect(system.runtime.restartInvocationPolicy).toBe("continue");
    expect(system.defaults.automationLevel).toBe("SEMI_AUTO");
    expect(system.defaults.aiProvider.provider).toBe("jules");
    expect(system.defaults.aiProvider.providers.codex.model).toBe("gpt-5.5");
    expect(system.techstackCatalog.defaultTechstackId).toBe(BUILTIN_CODE_UX_TECHSTACK_ID);
    expect(system.techstackCatalog.entries).toEqual([
      {
        id: BUILTIN_CODE_UX_TECHSTACK_ID,
        label: "Code UX Stack",
        items: [
          { id: "preact", label: "Preact" },
          { id: "tanstack-router", label: "TanStack Router" },
          { id: "gsap", label: "GSAP" },
          { id: "three-js", label: "Three.js" },
          { id: "lucide-icons", label: "Lucide Icons" },
        ],
      },
    ]);
    expect(system.defaults.techstack).toEqual({
      selectedTechstackId: null,
      applicationKind: null,
    });
    expect(system.defaults.designGuidance).toEqual({
      selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
      selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
      hideDefaultStyleguides: false,
      customTechStacks: [],
      customStyleguides: [],
    });
    expect(DEFAULT_VIRTUAL_WORKER_MODELS.codex).toBe("gpt-5.5");
    expect(CODEX_MODELS.slice(0, 4)).toEqual([
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(system.defaults.git.defaultBranch).toBe("main");
    expect(system.defaults.cliWorkflow.containerMountGithubAuth).toBe(false);
    expect(system.defaults.cliWorkflow.containerMountGeminiAuth).toBe(false);
    expect(system.defaults.cliWorkflow.containerMountCodexAuth).toBe(false);
    expect(system.defaults.cliWorkflow.containerMountClaudeCodeAuth).toBe(false);
    expect(system.defaults.workers.maxConcurrency).toBe(100);
    expect(system.defaults.agents.saveToProjectDirectory).toBe(true);
    expect(system.defaults.agents.qualityAssurance.enabled).toBe(true);
    expect(system.defaults.agents.qualityAssurance.maxTaskReviewRuns).toBe(3);
    expect(system.defaults.agents.qualityAssurance.maxSprintReviewRuns).toBe(3);
    expect(system.defaults.agents.qualityAssurance.exhaustionPolicy).toBe("FINISH_TASK");
    expect(system.defaults.agents.qualityAssurance.taskCompletion.enabled).toBe(true);
    expect(system.defaults.agents.qualityAssurance.taskCompletion.agentPresetIds).toEqual([]);
    expect(system.defaults.agents.qualityAssurance.sprintCompletion.enabled).toBe(true);
    expect(system.defaults.agents.qualityAssurance.sprintCompletion.agentPresetIds).toEqual([]);
    expect(system.defaults.agents.qualityAssurance.completedTaskWithoutPr.enabled).toBe(true);
    expect(system.defaults.agents.qualityAssurance.completedTaskWithoutPr.agentPresetIds).toEqual([]);
    expect(system.defaults.agents.selfReflection.planning.enabled).toBe(false);
    expect(system.defaults.agents.selfReflection.planning.maxImprovementAttempts).toBe(1);
    expect(system.defaults.agents.selfReflection.planning.criteria.map((criterion) => criterion.id)).toEqual([
      "correctness",
      "completeness",
      "decomposition_quality",
      "risk_handling",
      "testability",
      "maintainability",
      "security",
      "scope_control",
    ]);
    expect(system.defaults.agents.selfReflection.qualityAssurance.enabled).toBe(false);
    expect(system.defaults.agents.instructionTemplates.planningMissing).toContain("Sprint Planning Missing");
    expect(system.mcpTools.length).toBeGreaterThan(0);

    const projectOverride = repo.getProjectSettings("project-1");
    const sprintOverride = repo.getSprintSettings("sprint-1");
    expect(projectOverride).toEqual({});
    expect(sprintOverride).toEqual({});

    const effectiveProject = repo.resolveProjectDashboardSettings("project-1");
    expect(effectiveProject.settings.aiProvider.providers.codex.apiKey).toBe("");
    expect(effectiveProject.settings.techstackCatalog.defaultTechstackId).toBe(BUILTIN_CODE_UX_TECHSTACK_ID);
    expect(effectiveProject.settings.techstack.selectedTechstackId).toBe(null);
    expect(effectiveProject.settings.techstack.applicationKind).toBe(null);
    expect(effectiveProject.settings.designGuidance.selectedTechStackId).toBe(DESIGN_GUIDANCE_NONE_ID);
    expect(effectiveProject.settings.designGuidance.selectedStyleguideId).toBe(DESIGN_GUIDANCE_NONE_ID);
    expect(effectiveProject.settings.git.githubToken).toBe("");
    expect(effectiveProject.sources["automationLevel"]).toBe("system");
    expect(effectiveProject.sources["designGuidance.selectedStyleguideId"]).toBe("system");
  });

  it("persists system settings and resolves project/sprint overrides", async () => {
    const { repo, dbPath } = await createRepo();

    repo.saveSystemSettings({
      runtime: {
        dashboardPort: 4450,
        consoleLogLevel: "debug",
        debugLogFileLevel: "warn",
        consoleLogMode: "full",
        restartSprintPolicy: "pause",
        restartInvocationPolicy: "restart",
      },
      integrations: {
        julesApiKey: "sys-jules",
        geminiApiKey: "sys-gemini",
        codexApiKey: "sys-codex",
        claudeCodeApiKey: "sys-claude",
        githubToken: "sys-gh",
      },
      defaults: {
        automationLevel: "FULL",
        automationInterventions: {
          autoApprovePlan: true,
          autoAnswerClarification: true,
          autoResumePaused: false,
          clarificationAnswerTemplate: "Proceed.",
          clarificationCooldownSeconds: 300,
        },
        aiProvider: {
          provider: "gemini",
          strategy: "WEIGHTED",
          providers: {
            jules: { enabled: true, model: "default", weight: 50, thinkingMode: "MEDIUM" },
            gemini: { enabled: true, model: "gemini-2.5-pro", weight: 30, thinkingMode: "MEDIUM" },
            codex: { enabled: true, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH" },
            "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "HIGH" },
          },
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          autoCreatePr: true,
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
        },
        ciIntelligence: {
          enabled: true,
          enableLivePrMonitoring: true,
          resolveAllCommentsBeforeMainMerge: true,
          resolveMainMergeConflicts: false,
          resolveAllCommentsBeforeFeatureMerge: true,
          resolveMergeConflicts: false,
          waitForJulesCiAutofix: false,
          julesCiAutofixMaxRetries: 3,
          featurePrAutoMergeMode: "OFF",
          mainBranchAutoMergeMode: "OFF",
        },
        sprintLoopSteps: {
          branchPreflight: true,
          planningPreflight: true,
          loadSubtasks: true,
          sessionSync: true,
          statusDerivation: true,
          startReadyTasks: true,
          mergeProtocol: true,
          actionRequiredProtocol: true,
          statusTable: true,
          watchLoop: true,
          watchLoopIntervalSeconds: 10,
          watchLoopOutputIntervalSeconds: 300,
        },
        cliWorkflow: {
          cleanupWorktreeOnSuccess: true,
          cleanupWorktreeOnFailure: false,
          retryOnReadFileNotFound: true,
          resumeFailedTaskInSameWorkspace: true,
          executionMode: "HOST",
          containerImage: "node:24-bookworm",
          containerSetupScriptPath: "",
          containerCacheSetupScriptImage: false,
          containerMountGitConfig: true,
          containerMountGithubAuth: true,
          containerMountGeminiAuth: true,
          containerMountCodexAuth: true,
          containerMountClaudeCodeAuth: true,
          containerGithubAuthPath: "~/.config/gh",
          containerGeminiAuthPath: "~/.gemini",
          containerCodexAuthPath: "~/.codex",
          containerClaudeCodeAuthPath: "~/.claude",
        },
        agents: {
          saveToProjectDirectory: true,
          instructionTemplates: {
            ...repo.getSystemSettings().defaults.agents.instructionTemplates,
          },
          qualityAssurance: {
            enabled: true,
            maxTaskReviewRuns: 3,
            taskCompletion: {
              enabled: true,
              agentPresetId: "qa-task",
            },
            sprintCompletion: {
              enabled: true,
              agentPresetIds: [" qa-sprint ", "qa-peer", "qa-sprint", ""],
              agentPresetId: "qa-sprint-legacy-ignored",
            },
            completedTaskWithoutPr: {
              enabled: false,
              agentPresetIds: [],
              agentPresetId: null,
            },
          },
          selfReflection: repo.getSystemSettings().defaults.agents.selfReflection,
        },
        skills: [
          { name: "worker", enabled: true, isInternal: true },
        ],
      },
      mcpTools: [
        { name: "manage_tasks", enabled: false, isInternal: true },
      ],
    });

    const projectOverride = repo.saveProjectSettings("project-1", {
      automationLevel: "ALWAYS_ASK",
      git: {
        defaultBranch: "develop",
      },
      aiProvider: {
        provider: "codex",
      },
    });
    expect(projectOverride.automationLevel).toBe("ALWAYS_ASK");
    expect(projectOverride.git?.defaultBranch).toBe("develop");

    const baseProjectSettings = repo.getProjectResolvedSettings("project-1");
    const sprintOverride = repo.saveSprintSettings("sprint-1", baseProjectSettings, {
      sprintLoopSteps: {
        watchLoop: false,
      },
      aiProvider: {
        strategy: "MANUAL",
      },
    });
    expect(sprintOverride.sprintLoopSteps?.watchLoop).toBe(false);

    const reloaded = new SettingsRepository(dbPath);
    const effectiveProject = reloaded.resolveProjectDashboardSettings("project-1");
    expect(effectiveProject.settings.dashboardPort).toBe(4450);
    expect(effectiveProject.settings.consoleLogLevel).toBe("debug");
    expect(effectiveProject.settings.debugLogFileLevel).toBe("warn");
    expect(effectiveProject.settings.consoleLogMode).toBe("full");
    expect(effectiveProject.settings.restartSprintPolicy).toBe("pause");
    expect(effectiveProject.settings.restartInvocationPolicy).toBe("restart");
    expect(effectiveProject.settings.aiProvider.providers.jules.apiKey).toBe("sys-jules");
    expect(effectiveProject.settings.git.githubToken).toBe("sys-gh");
    expect(effectiveProject.settings.automationLevel).toBe("ALWAYS_ASK");
    expect(effectiveProject.settings.git.defaultBranch).toBe("develop");
    expect(effectiveProject.settings.agents.qualityAssurance.enabled).toBe(true);
    expect(effectiveProject.settings.agents.qualityAssurance.maxTaskReviewRuns).toBe(3);
    expect(effectiveProject.settings.agents.qualityAssurance.taskCompletion.agentPresetIds).toEqual(["qa-task"]);
    expect(effectiveProject.settings.agents.qualityAssurance.taskCompletion.agentPresetId).toBe("qa-task");
    expect(effectiveProject.settings.agents.qualityAssurance.sprintCompletion.agentPresetIds).toEqual(["qa-sprint", "qa-peer"]);
    expect(effectiveProject.settings.agents.qualityAssurance.sprintCompletion.agentPresetId).toBe("qa-sprint");
    expect(effectiveProject.settings.agents.qualityAssurance.completedTaskWithoutPr.enabled).toBe(false);
    expect(effectiveProject.settings.agents.qualityAssurance.completedTaskWithoutPr.agentPresetIds).toEqual([]);
    expect(effectiveProject.settings.agents.qualityAssurance.completedTaskWithoutPr.agentPresetId).toBe(null);
    expect(effectiveProject.sources["automationLevel"]).toBe("project");
    expect(effectiveProject.sources["git.defaultBranch"]).toBe("project");

    const effectiveSprint = reloaded.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(effectiveSprint.settings.automationLevel).toBe("ALWAYS_ASK");
    expect(effectiveSprint.settings.sprintLoopSteps.watchLoop).toBe(false);
    expect(effectiveSprint.settings.aiProvider.strategy).toBe("MANUAL");
    expect(effectiveSprint.sources["sprintLoopSteps.watchLoop"]).toBe("sprint");
    expect(effectiveSprint.sources["aiProvider.strategy"]).toBe("sprint");
  });

  it("stores project overrides relative to current system defaults", async () => {
    const { repo } = await createRepo();

    repo.saveSystemSettings({
      ...repo.getSystemSettings(),
      defaults: {
        ...repo.getSystemSettings().defaults,
        automationLevel: "FULL",
        git: {
          ...repo.getSystemSettings().defaults.git,
          defaultBranch: "mainline",
        },
      },
    });

    const savedProjectOverride = repo.saveProjectSettings("project-1", {
      automationLevel: "FULL",
      git: {
        defaultBranch: "develop",
      },
    });

    expect(savedProjectOverride).toEqual({
      git: {
        defaultBranch: "develop",
      },
    });

    const effectiveProject = repo.resolveProjectDashboardSettings("project-1");
    expect(effectiveProject.settings.automationLevel).toBe("FULL");
    expect(effectiveProject.sources["automationLevel"]).toBe("system");
    expect(effectiveProject.settings.git.defaultBranch).toBe("develop");
    expect(effectiveProject.sources["git.defaultBranch"]).toBe("project");
  });

  it("resolves partial persisted scoped settings while preserving default fallbacks", async () => {
    const { repo } = await createRepo();
    const now = new Date().toISOString();
    const db = repo.getDatabase();

    db.prepare(`
      INSERT INTO system_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
    `).run(JSON.stringify({
      runtime: {
        dashboardPort: 4555,
      },
      defaults: {
        git: {
          defaultBranch: "develop",
        },
        agents: {
          qualityAssurance: {
            taskCompletion: {
              enabled: false,
            },
          },
          selfReflection: {
            planning: {
              enabled: true,
              maxImprovementAttempts: 99,
              criteria: [
                {
                  id: " correctness ",
                  label: " Correctness ",
                  prompt: " Check correctness. ",
                  threshold: 2,
                },
                {
                  id: "correctness",
                  label: "Duplicate",
                  prompt: "Duplicate should be ignored.",
                  threshold: 0.1,
                },
                {
                  id: "",
                  label: "Invalid",
                  prompt: "Missing id.",
                  threshold: 0.5,
                },
                {
                  id: "scope_control",
                  label: "Scope control",
                  prompt: "Stay inside scope.",
                  threshold: -1,
                },
              ],
            },
            qualityAssurance: {
              enabled: "yes",
              maxImprovementAttempts: "many",
              criteria: "invalid",
            },
          },
        },
      },
    }), now);
    db.prepare(`
      INSERT INTO project_settings (project_id, payload, updated_at)
      VALUES (?, ?, ?)
    `).run("project-partial", JSON.stringify({
      git: {
        featureBranchPrefix: "work/",
      },
    }), now);
    db.prepare(`
      INSERT INTO sprint_settings (sprint_id, payload, updated_at)
      VALUES (?, ?, ?)
    `).run("sprint-partial", JSON.stringify({
      sprintLoopSteps: {
        watchLoop: false,
      },
    }), now);

    const effectiveProject = repo.resolveProjectDashboardSettings("project-partial");
    expect(effectiveProject.settings.dashboardPort).toBe(4555);
    expect(effectiveProject.settings.consoleLogLevel).toBe("info");
    expect(effectiveProject.settings.git.defaultBranch).toBe("develop");
    expect(effectiveProject.settings.git.featureBranchPrefix).toBe("work/");
    expect(effectiveProject.settings.agents.qualityAssurance.taskCompletion.enabled).toBe(false);
    expect(effectiveProject.settings.agents.qualityAssurance.maxTaskReviewRuns).toBe(3);
    expect(effectiveProject.settings.agents.selfReflection.planning.enabled).toBe(true);
    expect(effectiveProject.settings.agents.selfReflection.planning.maxImprovementAttempts).toBe(10);
    expect(effectiveProject.settings.agents.selfReflection.planning.criteria).toEqual([
      {
        id: "correctness",
        label: "Correctness",
        prompt: "Check correctness.",
        threshold: 1,
      },
      {
        id: "scope_control",
        label: "Scope control",
        prompt: "Stay inside scope.",
        threshold: 0,
      },
    ]);
    expect(effectiveProject.settings.agents.selfReflection.qualityAssurance.enabled).toBe(false);
    expect(effectiveProject.settings.agents.selfReflection.qualityAssurance.criteria.length).toBeGreaterThan(1);
    expect(effectiveProject.sources["git.featureBranchPrefix"]).toBe("project");

    const effectiveSprint = repo.resolveSprintDashboardSettings("project-partial", "sprint-partial");
    expect(effectiveSprint.settings.sprintLoopSteps.watchLoop).toBe(false);
    expect(effectiveSprint.settings.sprintLoopSteps.watchLoopIntervalSeconds).toBe(10);
    expect(effectiveSprint.settings.git.defaultBranch).toBe("develop");
    expect(effectiveSprint.settings.git.featureBranchPrefix).toBe("work/");
    expect(effectiveSprint.sources["sprintLoopSteps.watchLoop"]).toBe("sprint");
  });

  it("sanitizes malformed persisted techstack catalogs while preserving the built-in entry", async () => {
    const { repo } = await createRepo();
    const now = new Date().toISOString();
    const db = repo.getDatabase();

    db.prepare(`
      INSERT INTO system_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
    `).run(JSON.stringify({
      techstackCatalog: {
        defaultTechstackId: "missing-default",
        entries: [
          {
            id: " custom-web ",
            label: " Custom Web ",
            items: [
              { id: " react ", label: " React " },
              { id: "react", label: "Duplicate React" },
              { id: "", label: "Missing id" },
              { id: "invalid id", label: "Invalid id" },
            ],
          },
          {
            id: BUILTIN_CODE_UX_TECHSTACK_ID,
            label: "Overridden Built-in",
            items: [{ id: "fake", label: "Fake" }],
          },
          {
            id: "custom-web",
            label: "Duplicate custom",
            items: [],
          },
          {
            id: "   ",
            label: "Missing id",
            items: [],
          },
        ],
      },
      defaults: {
        techstack: {
          selectedTechstackId: " custom-web ",
          applicationKind: "web",
        },
      },
    }), now);

    const system = repo.getSystemSettings();

    expect(system.techstackCatalog.defaultTechstackId).toBe(BUILTIN_CODE_UX_TECHSTACK_ID);
    expect(system.techstackCatalog.entries).toEqual([
      {
        id: BUILTIN_CODE_UX_TECHSTACK_ID,
        label: "Code UX Stack",
        items: [
          { id: "preact", label: "Preact" },
          { id: "tanstack-router", label: "TanStack Router" },
          { id: "gsap", label: "GSAP" },
          { id: "three-js", label: "Three.js" },
          { id: "lucide-icons", label: "Lucide Icons" },
        ],
      },
      {
        id: "custom-web",
        label: "Custom Web",
        items: [
          { id: "react", label: "React" },
        ],
      },
    ]);
    expect(system.defaults.techstack).toEqual({
      selectedTechstackId: "custom-web",
      applicationKind: "web",
    });
  });

  it("sanitizes malformed design guidance while preserving valid custom entries", async () => {
    const { repo } = await createRepo();
    const now = new Date().toISOString();
    const db = repo.getDatabase();

    db.prepare(`
      INSERT INTO system_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
    `).run(JSON.stringify({
      defaults: {
        designGuidance: {
          selectedTechStackId: " missing-tech-stack ",
          selectedStyleguideId: " custom-style ",
          hideDefaultStyleguides: true,
          customTechStacks: [
            {
              id: " custom-stack ",
              name: " Custom Stack ",
              summary: " Stack summary ",
              instructionMarkdown: " Use this stack thoughtfully. ",
            },
            {
              id: "custom-stack",
              name: "Duplicate",
              summary: "Duplicate.",
              instructionMarkdown: "Ignore duplicate.",
            },
            {
              id: "invalid id",
              name: "Invalid",
              summary: "Invalid.",
              instructionMarkdown: "Invalid.",
            },
          ],
          customStyleguides: [
            {
              id: " custom-style ",
              name: " Custom Style ",
              summary: " Style summary ",
              instructionMarkdown: " Make senior design decisions from context. ",
            },
            {
              id: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
              name: "Override default",
              summary: "Should be ignored.",
              instructionMarkdown: "Should not replace default.",
            },
          ],
        },
      },
    }), now);

    const system = repo.getSystemSettings();
    expect(system.defaults.designGuidance).toEqual({
      selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
      selectedStyleguideId: "custom-style",
      hideDefaultStyleguides: true,
      customTechStacks: [
        {
          id: "custom-stack",
          name: "Custom Stack",
          summary: "Stack summary",
          instructionMarkdown: "Use this stack thoughtfully.",
        },
      ],
      customStyleguides: [
        {
          id: "custom-style",
          name: "Custom Style",
          summary: "Style summary",
          instructionMarkdown: "Make senior design decisions from context.",
        },
      ],
    });

    const projectOverride = repo.saveProjectSettings("project-1", {
      designGuidance: {
        selectedTechStackId: "custom-stack",
        selectedStyleguideId: "missing-style",
      },
    });
    expect(projectOverride.designGuidance?.selectedTechStackId).toBe("custom-stack");
    expect(projectOverride.designGuidance?.selectedStyleguideId).toBe(DESIGN_GUIDANCE_NONE_ID);

    const effectiveProject = repo.resolveProjectDashboardSettings("project-1");
    expect(effectiveProject.settings.designGuidance.selectedTechStackId).toBe("custom-stack");
    expect(effectiveProject.settings.designGuidance.selectedStyleguideId).toBe(DESIGN_GUIDANCE_NONE_ID);
    expect(effectiveProject.sources["designGuidance.selectedTechStackId"]).toBe("project");
    expect(effectiveProject.sources["designGuidance.selectedStyleguideId"]).toBe("project");
  });

  it("resets all scoped settings back to defaults", async () => {
    const { repo } = await createRepo();

    repo.saveSystemSettings({
      ...repo.getSystemSettings(),
      integrations: {
        julesApiKey: "sys-jules",
        geminiApiKey: "sys-gemini",
        codexApiKey: "sys-codex",
        claudeCodeApiKey: "sys-claude",
        githubToken: "sys-gh",
      },
    });
    repo.saveProjectSettings("project-1", {
      git: {
        defaultBranch: "develop",
      },
    });
    repo.saveSprintSettings("sprint-1", repo.getProjectResolvedSettings("project-1"), {
      sprintLoopSteps: {
        watchLoop: false,
      },
    });

    repo.resetAllData();

    expect(repo.getProjectSettings("project-1")).toEqual({});
    expect(repo.getSprintSettings("sprint-1")).toEqual({});
    expect(repo.getSystemSettings().integrations.githubToken).toBe("");
    expect(repo.resolveProjectDashboardSettings("project-1").settings.git.defaultBranch).toBe("main");
  });

  it("migrates legacy single-document settings into system settings", async () => {
    const { repo, dbPath } = await createRepo();
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO app_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
    `).run(JSON.stringify({
      dashboardPort: 4999,
      enableDebugLogFile: true,
      automationLevel: "ALWAYS_ASK",
      automationInterventions: {
        autoApprovePlan: false,
        autoAnswerClarification: true,
        autoResumePaused: true,
        clarificationAnswerTemplate: "Legacy template",
        clarificationCooldownSeconds: 300,
      },
      aiProvider: {
        provider: "codex",
        strategy: "MANUAL",
        providers: {
          jules: { enabled: true, model: "default", weight: 50, thinkingMode: "MEDIUM", apiKey: "legacy-jules" },
          gemini: { enabled: true, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "legacy-gemini" },
          codex: { enabled: true, model: "gpt-5.3-codex", weight: 30, thinkingMode: "HIGH", apiKey: "legacy-codex" },
          "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "HIGH", apiKey: "" },
        },
        julesApiKey: "legacy-jules",
      },
      git: {
        githubMode: "LOCAL",
        githubToken: "legacy-gh",
        defaultBranch: "develop",
        autoCreatePr: false,
        featureBranchPrefix: "work/",
        sprintBranchScheme: "feature/sprint{sprint}",
      },
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        resolveAllCommentsBeforeMainMerge: false,
        resolveMainMergeConflicts: false,
        resolveAllCommentsBeforeFeatureMerge: false,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 2,
        featurePrAutoMergeMode: "WHEN_GREEN",
        mainBranchAutoMergeMode: "OFF",
      },
      sprintLoopSteps: {
        branchPreflight: true,
        planningPreflight: true,
        loadSubtasks: true,
        sessionSync: true,
        statusDerivation: true,
        startReadyTasks: true,
        mergeProtocol: true,
        actionRequiredProtocol: true,
        statusTable: true,
        watchLoop: false,
        watchLoopIntervalSeconds: 60,
        watchLoopOutputIntervalSeconds: 300,
      },
      cliWorkflow: {
        cleanupWorktreeOnSuccess: true,
        cleanupWorktreeOnFailure: false,
        retryOnReadFileNotFound: true,
        resumeFailedTaskInSameWorkspace: true,
        executionMode: "HOST",
        containerImage: "node:24-bookworm",
        containerSetupScriptPath: "",
        containerCacheSetupScriptImage: false,
        containerMountGitConfig: true,
        containerMountGithubAuth: true,
        containerMountGeminiAuth: true,
        containerMountCodexAuth: true,
        containerMountClaudeCodeAuth: true,
        containerGithubAuthPath: "~/.config/gh",
        containerGeminiAuthPath: "~/.gemini",
        containerCodexAuthPath: "~/.codex",
        containerClaudeCodeAuthPath: "~/.claude",
      },
      skills: [
        { name: "worker", enabled: false, isInternal: true },
      ],
      mcpTools: [
        { name: "manage_tasks", enabled: false, isInternal: true },
      ],
    }), new Date().toISOString());

    const migrated = repo.getSystemSettings();
    expect(migrated.runtime.dashboardPort).toBe(4999);
    expect(migrated.runtime.consoleLogLevel).toBe("info");
    expect(migrated.runtime.debugLogFileLevel).toBe("error");
    expect(migrated.runtime.consoleLogMode).toBe("standard");
    expect(migrated.integrations.githubToken).toBe("legacy-gh");
    expect(migrated.defaults.automationLevel).toBe("ALWAYS_ASK");
    expect(migrated.defaults.git.defaultBranch).toBe("develop");
    expect(repo.getDefaultDashboardSettings().git.githubToken).toBe("legacy-gh");
    expect(db.prepare("SELECT payload FROM app_settings WHERE id = 1").get()).toBeUndefined();
    db.close();
  });

  it("resolves effective settings through a scoped resolver, caching lookups", async () => {
    const { repo } = await createRepo();

    repo.saveSystemSettings({
      ...repo.getSystemSettings(),
      defaults: {
        ...repo.getSystemSettings().defaults,
        automationLevel: "FULL",
      },
    });

    repo.saveProjectSettings("project-1", {
      git: {
        defaultBranch: "develop",
      },
    });
    repo.saveProjectSettings("project-2", {
      git: {
        defaultBranch: "test-branch",
      },
    });

    const baseProject1Settings = repo.getProjectResolvedSettings("project-1");
    repo.saveSprintSettings("sprint-1", baseProject1Settings, {
      sprintLoopSteps: {
        watchLoop: false,
      },
    });

    const resolver = repo.createScopedResolver();

    // First resolution
    const p1 = resolver.resolveProjectDashboardSettings("project-1");
    expect(p1.settings.automationLevel).toBe("FULL");
    expect(p1.settings.git.defaultBranch).toBe("develop");

    const p1s1 = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(p1s1.settings.automationLevel).toBe("FULL");
    expect(p1s1.settings.git.defaultBranch).toBe("develop");
    expect(p1s1.settings.sprintLoopSteps.watchLoop).toBe(false);

    // Second resolution should return strictly identical objects via cache
    const p1Cached = resolver.resolveProjectDashboardSettings("project-1");
    const p1s1Cached = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");

    expect(p1Cached).toBe(p1);
    expect(p1s1Cached).toBe(p1s1);

    // Different project resolution
    const p2 = resolver.resolveProjectDashboardSettings("project-2");
    expect(p2.settings.git.defaultBranch).toBe("test-branch");
    const p2Cached = resolver.resolveProjectDashboardSettings("project-2");
    expect(p2Cached).toBe(p2);
  });

  it("caches repeated project effective settings reads until project settings change", async () => {
    const { repo } = await createRepo();
    repo.saveProjectSettings("project-1", {
      git: {
        defaultBranch: "develop",
      },
    });

    const projectLookup = vi.spyOn(repo, "getProjectSettings");
    const first = repo.resolveProjectDashboardSettings("project-1");
    const second = repo.resolveProjectDashboardSettings("project-1");

    expect(second).toBe(first);
    expect(projectLookup).toHaveBeenCalledTimes(1);
    expect(second.settings.git.defaultBranch).toBe("develop");

    repo.saveProjectSettings("project-1", {
      git: {
        defaultBranch: "release",
      },
    });

    const afterMutation = repo.resolveProjectDashboardSettings("project-1");
    expect(afterMutation).not.toBe(first);
    expect(afterMutation.settings.git.defaultBranch).toBe("release");
    expect(projectLookup).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached effective settings when system defaults change", async () => {
    const { repo } = await createRepo();
    const system = repo.getSystemSettings();
    repo.saveSystemSettings({
      ...system,
      defaults: {
        ...system.defaults,
        git: {
          ...system.defaults.git,
          defaultBranch: "develop",
        },
      },
    });

    const first = repo.resolveProjectDashboardSettings("project-1");
    expect(first.settings.git.defaultBranch).toBe("develop");

    const nextSystem = repo.getSystemSettings();
    repo.saveSystemSettings({
      ...nextSystem,
      defaults: {
        ...nextSystem.defaults,
        git: {
          ...nextSystem.defaults.git,
          defaultBranch: "release",
        },
      },
    });

    const afterMutation = repo.resolveProjectDashboardSettings("project-1");
    expect(afterMutation).not.toBe(first);
    expect(afterMutation.settings.git.defaultBranch).toBe("release");
  });

  it("caches repeated sprint effective settings reads until sprint settings reset", async () => {
    const { repo } = await createRepo();
    repo.saveSprintSettings("sprint-1", repo.getProjectResolvedSettings("project-1"), {
      sprintLoopSteps: {
        watchLoop: false,
      },
    });

    const projectLookup = vi.spyOn(repo, "getProjectSettings");
    const sprintLookup = vi.spyOn(repo, "getSprintSettings");
    const first = repo.resolveSprintDashboardSettings("project-1", "sprint-1");
    const second = repo.resolveSprintDashboardSettings("project-1", "sprint-1");

    expect(second).toBe(first);
    expect(projectLookup).toHaveBeenCalledTimes(1);
    expect(sprintLookup).toHaveBeenCalledTimes(1);
    expect(second.settings.sprintLoopSteps.watchLoop).toBe(false);

    repo.resetSprintSettings("sprint-1");

    const afterReset = repo.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(afterReset).not.toBe(first);
    expect(afterReset.settings.sprintLoopSteps.watchLoop).toBe(true);
    expect(projectLookup).toHaveBeenCalledTimes(2);
    expect(sprintLookup).toHaveBeenCalledTimes(2);
  });

  it("invalidates scoped resolver caches after repository mutations", async () => {
    const { repo } = await createRepo();
    const resolver = repo.createScopedResolver();

    const first = resolver.resolveProjectDashboardSettings("project-1");
    expect(first.settings.git.defaultBranch).toBe("main");

    repo.saveProjectSettings("project-1", {
      git: {
        defaultBranch: "develop",
      },
    });

    const afterMutation = resolver.resolveProjectDashboardSettings("project-1");
    expect(afterMutation).not.toBe(first);
    expect(afterMutation.settings.git.defaultBranch).toBe("develop");
  });

  it("invalidates effective settings caches after system, project, and sprint resets or mutations", async () => {
    const { repo } = await createRepo();
    const resolver = repo.createScopedResolver();

    repo.saveSystemSettings({
      ...repo.getSystemSettings(),
      defaults: {
        ...repo.getSystemSettings().defaults,
        git: {
          ...repo.getSystemSettings().defaults.git,
          defaultBranch: "develop",
        },
      },
    });
    repo.saveProjectSettings("project-1", {
      git: {
        featureBranchPrefix: "work/",
      },
    });
    repo.saveSprintSettings("sprint-1", repo.getProjectResolvedSettings("project-1"), {
      sprintLoopSteps: {
        watchLoop: false,
      },
    });

    const first = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(first.settings.git.defaultBranch).toBe("develop");
    expect(first.settings.git.featureBranchPrefix).toBe("work/");
    expect(first.settings.sprintLoopSteps.watchLoop).toBe(false);

    repo.saveSystemSettings({
      ...repo.getSystemSettings(),
      defaults: {
        ...repo.getSystemSettings().defaults,
        git: {
          ...repo.getSystemSettings().defaults.git,
          defaultBranch: "release",
        },
      },
    });

    const afterSystemMutation = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(afterSystemMutation).not.toBe(first);
    expect(afterSystemMutation.settings.git.defaultBranch).toBe("release");
    expect(afterSystemMutation.settings.git.featureBranchPrefix).toBe("work/");

    repo.resetProjectSettings("project-1");

    const afterProjectReset = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(afterProjectReset).not.toBe(afterSystemMutation);
    expect(afterProjectReset.settings.git.featureBranchPrefix).toBe("feature/");
    expect(afterProjectReset.settings.sprintLoopSteps.watchLoop).toBe(false);

    repo.saveSprintSettings("sprint-1", repo.getProjectResolvedSettings("project-1"), {
      sprintLoopSteps: {
        watchLoopIntervalSeconds: 45,
      },
    });

    const afterSprintMutation = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(afterSprintMutation).not.toBe(afterProjectReset);
    expect(afterSprintMutation.settings.sprintLoopSteps.watchLoop).toBe(true);
    expect(afterSprintMutation.settings.sprintLoopSteps.watchLoopIntervalSeconds).toBe(45);

    repo.resetAllData();

    const afterSystemReset = resolver.resolveSprintDashboardSettings("project-1", "sprint-1");
    expect(afterSystemReset).not.toBe(afterSprintMutation);
    expect(afterSystemReset.settings.git.defaultBranch).toBe("main");
    expect(afterSystemReset.settings.sprintLoopSteps.watchLoopIntervalSeconds).toBe(10);
  });

  it("resolves default autoApprovePlan as true, and preserves explicit false", async () => {
    const { repo } = await createRepo();

    // Default should be true
    const system = repo.getSystemSettings();
    expect(system.defaults.automationInterventions.autoApprovePlan).toBe(true);

    // Save with explicit false
    repo.saveSystemSettings({
      ...system,
      defaults: {
        ...system.defaults,
        automationInterventions: {
          ...system.defaults.automationInterventions,
          autoApprovePlan: false,
        },
      },
    });

    const updated = repo.getSystemSettings();
    expect(updated.defaults.automationInterventions.autoApprovePlan).toBe(false);
  });
});
