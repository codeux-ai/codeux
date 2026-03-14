import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("AgentPresetSyncService", () => {
  it("imports project markdown agents and detects out-of-sync changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-agent-sync-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".sprint-os", "agents"), { recursive: true });
    const agentPath = path.join(repoPath, ".sprint-os", "agents", "planning_agent.md");
    await fs.writeFile(agentPath, "Initial planning instructions.\n", "utf8");

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Planning Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const imported = await syncService.listAgentPresets(project.id);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      name: "Planning agent",
      sourceScope: "project",
      syncStatus: "synced",
      sourceExists: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(agentPath, "Updated planning instructions.\n", "utf8");

    const drifted = await syncService.listAgentPresets(project.id);
    expect(drifted[0]?.syncStatus).toBe("out_of_sync");
    expect(drifted[0]?.instructionMarkdown).toContain("Initial planning instructions");

    const reimported = await syncService.importAgentPresetFromMarkdown(drifted[0]!.id);
    expect(reimported.syncStatus).toBe("synced");
    expect(reimported.instructionMarkdown).toContain("Updated planning instructions");
  });

  it("writes dashboard-created and updated agents into the project agent directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-agent-dashboard-write-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const defaultAgentsDir = path.join(dir, ".sprint-os", "agents");
    await fs.mkdir(defaultAgentsDir, { recursive: true });
    const defaultPlanningPath = path.join(defaultAgentsDir, "planning_agent.md");
    await fs.writeFile(defaultPlanningPath, "Default planning instructions.\n", "utf8");

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Mirror Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const created = await syncService.createAgentPreset(project.id, {
      name: "Worker Agent",
      instructionMarkdown: "Handle execution work.\n",
      labels: ["execution"],
    });
    const createdPath = path.join(repoPath, ".sprint-os", "agents", "worker_agent.md");

    expect(created).toMatchObject({
      name: "Worker Agent",
      sourceScope: "project",
      syncStatus: "synced",
    });
    expect(await fs.readFile(createdPath, "utf8")).toBe("Handle execution work.");

    const importedDefaults = await syncService.listAgentPresets(project.id);
    const planningAgent = importedDefaults.find((preset) => preset.name === "Planning agent");
    expect(planningAgent?.sourceScope).toBe("default");

    const updated = await syncService.updateAgentPreset(planningAgent!.id, {
      instructionMarkdown: "Project-specific planning instructions.\n",
    });
    const projectPlanningPath = path.join(repoPath, ".sprint-os", "agents", "planning_agent.md");

    expect(updated.sourceScope).toBe("project");
    expect(updated.syncStatus).toBe("synced");
    expect(await fs.readFile(projectPlanningPath, "utf8")).toBe("Project-specific planning instructions.");
    expect(await fs.readFile(defaultPlanningPath, "utf8")).toBe("Default planning instructions.\n");
  });

  it("respects disabled project file mirroring and supports sync-all for local drift", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-agent-sync-all-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const projectAgentsDir = path.join(repoPath, ".sprint-os", "agents");
    await fs.mkdir(projectAgentsDir, { recursive: true });
    const planningPath = path.join(projectAgentsDir, "planning_agent.md");
    const reviewerPath = path.join(projectAgentsDir, "Reviewer.md");
    await fs.writeFile(planningPath, "Initial planning instructions.\n", "utf8");
    await fs.writeFile(reviewerPath, "Initial review instructions.\n", "utf8");

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Sync All Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: false,
      },
    });

    const manual = await syncService.createAgentPreset(project.id, {
      name: "Database Only",
      instructionMarkdown: "Persist only in sqlite.\n",
    });
    expect(manual.sourcePath).toBeNull();
    await expect(fs.stat(path.join(projectAgentsDir, "Database Only.md"))).rejects.toThrow();

    await syncService.listAgentPresets(project.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(planningPath, "Updated planning instructions.\n", "utf8");
    await fs.writeFile(reviewerPath, "Updated review instructions.\n", "utf8");

    const synced = await syncService.syncAllAgentPresetsFromMarkdown(project.id);
    expect(synced.filter((preset) => preset.syncStatus === "out_of_sync")).toHaveLength(0);
    expect(synced.find((preset) => preset.name === "Planning agent")?.instructionMarkdown).toContain("Updated planning instructions");
    expect(synced.find((preset) => preset.name === "Reviewer")?.instructionMarkdown).toContain("Updated review instructions");
  });
});
