import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";

const tempDirs: string[] = [];

const createRepo = async (): Promise<{ repo: SettingsRepository; dbPath: string; dir: string }> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-settings-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "settings.db");
  return { repo: new SettingsRepository(dbPath), dbPath, dir };
};

afterEach(async () => {
  const cacheResetDir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-settings-reset-"));
  tempDirs.push(cacheResetDir);
  const repo = new SettingsRepository(path.join(cacheResetDir, "settings.db"));
  repo.resetAllData();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SettingsRepository", () => {
  it("returns scoped defaults when db is empty", async () => {
    const { repo } = await createRepo();

    const system = repo.getSystemSettings();
    expect(system.runtime.dashboardPort).toBe(4444);
    expect(system.runtime.enableDebugLogFile).toBe(false);
    expect(system.defaults.automationLevel).toBe("SEMI_AUTO");
    expect(system.defaults.aiProvider.provider).toBe("jules");
    expect(system.defaults.aiProvider.providers.codex.model).toBe("gpt-5.3-codex");
    expect(system.defaults.git.defaultBranch).toBe("main");
    expect(system.defaults.cliWorkflow.containerMountGithubAuth).toBe(false);
    expect(system.defaults.cliWorkflow.containerMountGeminiAuth).toBe(false);
    expect(system.defaults.cliWorkflow.containerMountCodexAuth).toBe(false);
    expect(system.defaults.cliWorkflow.containerMountClaudeCodeAuth).toBe(false);
    expect(system.defaults.agents.saveToProjectDirectory).toBe(true);
    expect(system.defaults.agents.qualityAssurance.enabled).toBe(false);
    expect(system.defaults.agents.qualityAssurance.maxTaskReviewRuns).toBe(1);
    expect(system.defaults.agents.qualityAssurance.taskCompletion.enabled).toBe(true);
    expect(system.defaults.agents.qualityAssurance.sprintCompletion.enabled).toBe(true);
    expect(system.defaults.agents.qualityAssurance.completedTaskWithoutPr.enabled).toBe(true);
    expect(system.defaults.agents.instructionTemplates.planningMissing).toContain("Sprint Planning Missing");
    expect(system.mcpTools.length).toBeGreaterThan(0);

    const projectOverride = repo.getProjectSettings("project-1");
    const sprintOverride = repo.getSprintSettings("sprint-1");
    expect(projectOverride).toEqual({});
    expect(sprintOverride).toEqual({});

    const effectiveProject = repo.resolveProjectDashboardSettings("project-1");
    expect(effectiveProject.settings.aiProvider.providers.codex.apiKey).toBe("");
    expect(effectiveProject.settings.git.githubToken).toBe("");
    expect(effectiveProject.sources["automationLevel"]).toBe("system");
  });

  it("persists system settings and resolves project/sprint overrides", async () => {
    const { repo, dbPath } = await createRepo();

    repo.saveSystemSettings({
      runtime: {
        dashboardPort: 4450,
        enableDebugLogFile: true,
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
          watchLoopIntervalSeconds: 120,
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
              agentPresetId: "qa-sprint",
            },
            completedTaskWithoutPr: {
              enabled: false,
              agentPresetId: null,
            },
          },
        },
        skills: [
          { name: "worker", enabled: true, isInternal: true },
        ],
      },
      mcpTools: [
        { name: "get_session", enabled: false, isInternal: true },
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
    expect(effectiveProject.settings.enableDebugLogFile).toBe(true);
    expect(effectiveProject.settings.aiProvider.providers.jules.apiKey).toBe("sys-jules");
    expect(effectiveProject.settings.git.githubToken).toBe("sys-gh");
    expect(effectiveProject.settings.automationLevel).toBe("ALWAYS_ASK");
    expect(effectiveProject.settings.git.defaultBranch).toBe("develop");
    expect(effectiveProject.settings.agents.qualityAssurance.enabled).toBe(true);
    expect(effectiveProject.settings.agents.qualityAssurance.maxTaskReviewRuns).toBe(3);
    expect(effectiveProject.settings.agents.qualityAssurance.taskCompletion.agentPresetId).toBe("qa-task");
    expect(effectiveProject.settings.agents.qualityAssurance.sprintCompletion.agentPresetId).toBe("qa-sprint");
    expect(effectiveProject.settings.agents.qualityAssurance.completedTaskWithoutPr.enabled).toBe(false);
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
        { name: "get_session", enabled: false, isInternal: true },
      ],
    }), new Date().toISOString());

    const migrated = repo.getSystemSettings();
    expect(migrated.runtime.dashboardPort).toBe(4999);
    expect(migrated.integrations.githubToken).toBe("legacy-gh");
    expect(migrated.defaults.automationLevel).toBe("ALWAYS_ASK");
    expect(migrated.defaults.git.defaultBranch).toBe("develop");
    expect(repo.getDefaultDashboardSettings().git.githubToken).toBe("legacy-gh");
    expect(db.prepare("SELECT payload FROM app_settings WHERE id = 1").get()).toBeUndefined();
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
});
