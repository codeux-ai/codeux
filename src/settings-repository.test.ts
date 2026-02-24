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
    expect(settings.git.defaultBranch).toBe("main");
    expect(settings.git.githubMode).toBe("REMOTE");
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
        julesApiKey: "test-key",
      },
      git: {
        githubMode: "LOCAL",
        defaultBranch: "develop",
        autoCreatePr: false,
        featureBranchPrefix: "work/",
        sprintBranchScheme: "feature/sprint{sprint}-implementation",
      },
      skills: [
        { name: "worker", enabled: false, isInternal: true },
        { name: "my-custom-skill", enabled: true, isInternal: false },
      ],
    });

    expect(saved.automationLevel).toBe("ALWAYS_ASK");
    expect(saved.aiProvider.julesApiKey).toBe("test-key");
    expect(saved.git.featureBranchPrefix).toBe("work/");
    expect(saved.git.githubMode).toBe("LOCAL");
    expect(saved.skills.find((skill) => skill.name === "git_manager_remote")?.enabled).toBe(false);
    expect(saved.skills.find((skill) => skill.name === "git_manager_local")?.enabled).toBe(true);

    const reloaded = new SettingsRepository(dbPath).getSettings();
    expect(reloaded).toEqual(saved);
    expect(reloaded.skills.find((skill) => skill.name === "worker")?.enabled).toBe(false);
    expect(reloaded.skills.find((skill) => skill.name === "my-custom-skill")?.isInternal).toBe(false);
  });
});
