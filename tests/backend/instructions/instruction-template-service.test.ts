import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { InstructionService } from "../../../src/instructions/instruction-template-service.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("InstructionService", () => {
  it("loads templates from project settings when the repo is known", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "instruction-service-"));
    tempDirs.push(root);
    const appDbPath = path.join(root, "app.db");
    const settingsDbPath = path.join(root, "settings.db");
    const settingsRepository = new SettingsRepository(settingsDbPath);
    const projectManagementRepository = new ProjectManagementRepository(new AppDbStorage(appDbPath));
    const project = projectManagementRepository.createProject({
      name: "Example",
      sourceType: "local",
      sourceRef: root,
    });
    const base = settingsRepository.getSystemSettings().defaults;
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        ...base.agents,
        instructionTemplates: {
          ...base.agents.instructionTemplates,
          branchMissing: "Custom {{feature_branch}}",
        },
      },
    });

    const service = new InstructionService({
      settingsRepository,
      projectManagementRepository,
    });
    const rendered = await service.render("branchMissing", { feature_branch: "feature/s42" }, root);
    expect(rendered).toBe("Custom feature/s42");
  });

  it("falls back to built-in template when no project override exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "instruction-service-"));
    tempDirs.push(root);
    const appDbPath = path.join(root, "app.db");
    const settingsDbPath = path.join(root, "settings.db");

    const service = new InstructionService({
      settingsRepository: new SettingsRepository(settingsDbPath),
      projectManagementRepository: new ProjectManagementRepository(new AppDbStorage(appDbPath)),
    });
    const rendered = await service.render("planningMissing", { subtasks_dir: "/tmp/missing" }, root);
    expect(rendered).toContain("Sprint Planning Missing");
    expect(rendered).toContain("/tmp/missing");
  });
});
