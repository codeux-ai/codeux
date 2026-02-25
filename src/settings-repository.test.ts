import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SettingsRepository } from "./settings-repository.js";

const tempDirs: string[] = [];

const createRepo = async (): Promise<{ repo: SettingsRepository; dbPath: string; dir: string }> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-settings-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "settings.db");
  return { repo: new SettingsRepository(dbPath), dbPath, dir };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SettingsRepository", () => {
  it("returns defaults when db is empty", async () => {
    const { repo } = await createRepo();
    const settings = repo.getSettings();
    expect(settings.automationLevel).toBe("SEMI_AUTO");
    expect(settings.aiProvider.provider).toBe("jules");
    expect(settings.aiProvider.strategy).toBe("MANUAL");
    expect(settings.aiProvider.providers.codex.model).toBe("gpt-5.3-codex");
    expect(settings.git.defaultBranch).toBe("main");
    expect(settings.git.githubMode).toBe("REMOTE");
    expect(settings.ciIntelligence.enabled).toBe(true);
    expect(settings.sprintLoopSteps.watchLoop).toBe(true);
    expect(settings.cliWorkflow.cleanupWorktreeOnSuccess).toBe(true);
    expect(settings.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(settings.cliWorkflow.retryOnReadFileNotFound).toBe(true);
    expect(settings.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
    expect(settings.skills.length).toBeGreaterThan(0);
    expect(settings.skills.every((skill) => skill.isInternal)).toBe(true);
    expect(settings.skills.find((skill) => skill.name === "git_manager_remote")?.enabled).toBe(true);
    expect(settings.skills.find((skill) => skill.name === "git_manager_local")?.enabled).toBe(false);
  });

  it("persists and reads settings", async () => {
    const { repo, dbPath } = await createRepo();
    const saved = repo.saveSettings({
      automationLevel: "ALWAYS_ASK",
      aiProvider: {
        provider: "jules",
        strategy: "WEIGHTED",
        providers: {
          jules: { enabled: true, model: "default", weight: 50, thinkingMode: "MEDIUM", apiKey: "test-key" },
          gemini: { enabled: true, model: "gemini-2.5-pro", weight: 25, thinkingMode: "MEDIUM", apiKey: "gem-key" },
          codex: { enabled: true, model: "gpt-5.3-codex", weight: 25, thinkingMode: "HIGH", apiKey: "codex-key" },
        },
        julesApiKey: "test-key",
      },
      git: {
        githubMode: "LOCAL",
        githubToken: "ghp_test",
        defaultBranch: "develop",
        autoCreatePr: false,
        featureBranchPrefix: "work/",
        sprintBranchScheme: "feature/sprint{sprint}-implementation",
      },
      ciIntelligence: {
        enabled: true,
        waitForCiBeforeMainMerge: false,
        resolveAllCommentsBeforeMainMerge: false,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: false,
      },
      sprintLoopSteps: {
        branchPreflight: true,
        planningPreflight: true,
        loadSubtasks: true,
        sessionSync: true,
        statusDerivation: true,
        startReadyTasks: true,
        mergeProtocol: false,
        actionRequiredProtocol: true,
        statusTable: true,
        watchLoop: false,
      },
      cliWorkflow: {
        cleanupWorktreeOnSuccess: true,
        cleanupWorktreeOnFailure: false,
        retryOnReadFileNotFound: true,
        resumeFailedTaskInSameWorkspace: true,
      },
      skills: [
        { name: "worker", enabled: false, isInternal: true },
        { name: "my-custom-skill", enabled: true, isInternal: false },
      ],
    });

    expect(saved.automationLevel).toBe("ALWAYS_ASK");
    expect(saved.aiProvider.julesApiKey).toBe("test-key");
    expect(saved.aiProvider.providers.gemini.model).toBe("gemini-2.5-pro");
    expect(saved.aiProvider.strategy).toBe("WEIGHTED");
    expect(saved.git.githubToken).toBe("ghp_test");
    expect(saved.git.featureBranchPrefix).toBe("work/");
    expect(saved.git.githubMode).toBe("LOCAL");
    expect(saved.ciIntelligence.waitForCiBeforeMainMerge).toBe(false);
    expect(saved.sprintLoopSteps.watchLoop).toBe(false);
    expect(saved.cliWorkflow.cleanupWorktreeOnFailure).toBe(false);
    expect(saved.cliWorkflow.resumeFailedTaskInSameWorkspace).toBe(true);
    expect(saved.skills.find((skill) => skill.name === "git_manager_remote")?.enabled).toBe(false);
    expect(saved.skills.find((skill) => skill.name === "git_manager_local")?.enabled).toBe(true);

    const reloaded = new SettingsRepository(dbPath).getSettings();
    expect(reloaded).toEqual(saved);
    expect(reloaded.skills.find((skill) => skill.name === "worker")?.enabled).toBe(false);
    expect(reloaded.skills.find((skill) => skill.name === "my-custom-skill")?.isInternal).toBe(false);
  });

  it("initializes defaults from external hints", async () => {
    const { dbPath } = await createRepo();
    const repo = new SettingsRepository(dbPath, {
      env: { julesApiKey: "env-jules", geminiApiKey: "env-gem", codexApiKey: "env-cdx", githubToken: "env-gh" },
      settingsJson: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", githubToken: "" },
      resolved: { julesApiKey: "env-jules", geminiApiKey: "env-gem", codexApiKey: "env-cdx", githubToken: "env-gh" },
    });

    const settings = repo.getSettings();
    expect(settings.aiProvider.julesApiKey).toBe("env-jules");
    expect(settings.aiProvider.providers.gemini.apiKey).toBe("env-gem");
    expect(settings.aiProvider.providers.codex.apiKey).toBe("env-cdx");
    expect(settings.git.githubToken).toBe("env-gh");
  });
});
