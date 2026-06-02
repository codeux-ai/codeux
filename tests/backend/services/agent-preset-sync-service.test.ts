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
const originalHome = process.env.HOME;
const originalEnableInstallInTests = process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;

afterEach(async () => {
  process.env.HOME = originalHome;
  if (originalEnableInstallInTests === undefined) {
    delete process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;
  } else {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = originalEnableInstallInTests;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("AgentPresetSyncService", () => {
  it("imports project markdown agents and auto-syncs content on change", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-sync-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    const agentPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");
    await fs.writeFile(agentPath, "---json\n{\"avatarConfig\":{\"body\":\"alien\"},\"memoryTemplateOverrideEnabled\":true}\n---\nInitial planning instructions.\n", "utf8");

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
      avatarConfig: { body: "alien" },
      memoryTemplateOverrideEnabled: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(agentPath, "Updated planning instructions.\n", "utf8");

    const drifted = await syncService.listAgentPresets(project.id);
    expect(drifted[0]?.syncStatus).toBe("synced");
    expect(drifted[0]?.instructionMarkdown).toContain("Updated planning instructions");
    expect(drifted[0]?.avatarConfig).toBeUndefined();
    expect(drifted[0]?.memoryTemplateOverrideEnabled).toBe(false);
  });

  it("seeds built-in default agents only once per project", async () => {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-default-once-"));
    tempDirs.push(dir);

    const projectRoot = path.join(dir, "app");
    const repoPath = path.join(dir, "repo");
    const homeDir = path.join(dir, "home");
    process.env.HOME = homeDir;

    await fs.mkdir(path.join(projectRoot, ".code-ux", "agents"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, ".code-ux", "container"), { recursive: true });
    for (const fileName of ["planning_agent.md", "project_manager.md", "quality_assurance_agent.md", "worker.md"]) {
      await fs.writeFile(
        path.join(projectRoot, ".code-ux", "agents", fileName),
        `default ${fileName}\n`,
        "utf8",
      );
    }
    await fs.writeFile(path.join(projectRoot, ".code-ux", "container", "setup.sh"), "#!/usr/bin/env bash\necho setup\n", "utf8");

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot,
    });

    const project = projectRepository.createProject({
      name: "One Shot Defaults",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const initial = await syncService.listAgentPresets(project.id);
    expect(initial.map((preset) => preset.name).sort()).toEqual([
      "Planning agent",
      "Project manager",
      "Quality assurance agent",
      "Worker",
    ]);
    expect(agentPresetRepository.hasCopiedDefaultAgentPresets(project.id)).toBe(true);

    const worker = initial.find((preset) => preset.name === "Worker");
    expect(worker?.sourceScope).toBe("default");
    await syncService.deleteAgentPreset(worker!.id);
    await fs.rm(path.join(homeDir, ".code-ux", "agents", "worker.md"), { force: true });

    const afterDelete = await syncService.listAgentPresets(project.id);
    expect(afterDelete.some((preset) => preset.name === "Worker")).toBe(false);
    await expect(fs.stat(path.join(homeDir, ".code-ux", "agents", "worker.md"))).rejects.toThrow();
  });

  it("normalizes project_manager sources and resolves the Project manager agent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-manager-agent-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".code-ux", "agents", "project_manager.md"),
      "Answer Jules clarification requests.\n",
      "utf8",
    );

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
      name: "Project Manager Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const presets = await syncService.listAgentPresets(project.id);
    expect(presets.find((preset) => preset.name === "Project manager")).toMatchObject({
      sourceScope: "project",
      syncStatus: "synced",
    });

    const resolved = await syncService.getProjectManagerAgent(project.id);
    expect(resolved.name).toBe("Project manager");
    expect(resolved.instructionMarkdown).toContain("Answer Jules clarification requests.");
  });

  it("repairs stale DB content when source metadata already matches", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-stale-content-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    const agentPath = path.join(repoPath, ".code-ux", "agents", "worker.md");
    await fs.writeFile(agentPath, "Real worker instructions.\n", "utf8");

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
      name: "Stale Content Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    // First sync — imports correctly
    const initial = await syncService.listAgentPresets(project.id);
    expect(initial).toHaveLength(1);
    expect(initial[0]?.instructionMarkdown).toContain("Real worker instructions");

    // Simulate the old bug: metadata is correct but DB content is empty
    const stats = await fs.stat(agentPath);
    agentPresetRepository.linkAgentPresetToSource(initial[0]!.id, {
      sourcePath: agentPath,
      sourceScope: "project",
      sourceUpdatedAt: stats.mtime.toISOString(),
    });
    agentPresetRepository.updateAgentPreset(initial[0]!.id, {
      instructionMarkdown: "",
    });

    // Verify the stale state
    const stale = agentPresetRepository.findAgentPresetByName(project.id, "Worker");
    expect(stale?.instructionMarkdown).toBe("");

    // Re-sync should detect and repair the content mismatch
    const repaired = await syncService.listAgentPresets(project.id);
    expect(repaired[0]?.instructionMarkdown).toContain("Real worker instructions");
    expect(repaired[0]?.syncStatus).toBe("synced");
  });

  it("writes dashboard-created and updated agents into the project agent directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-dashboard-write-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const defaultAgentsDir = path.join(dir, ".code-ux", "agents");
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
    const createdPath = path.join(repoPath, ".code-ux", "agents", "worker_agent.md");

    expect(created).toMatchObject({
      name: "Worker Agent",
      sourceScope: "project",
      syncStatus: "synced",
    });
    expect(await fs.readFile(createdPath, "utf8")).toContain("Handle execution work.");

    const importedDefaults = await syncService.listAgentPresets(project.id);
    const planningAgent = importedDefaults.find((preset) => preset.name === "Planning agent");
    expect(planningAgent?.sourceScope).toBe("default");

    const updated = await syncService.updateAgentPreset(planningAgent!.id, {
      instructionMarkdown: "Project-specific planning instructions.\n",
    });
    const projectPlanningPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");

    expect(updated.sourceScope).toBe("project");
    expect(updated.syncStatus).toBe("synced");
    expect(await fs.readFile(projectPlanningPath, "utf8")).toContain("Project-specific planning instructions.");
    expect(await fs.readFile(defaultPlanningPath, "utf8")).toBe("Default planning instructions.\n");
  });

  it("respects disabled project file mirroring and supports sync-all for local drift", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-sync-all-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const projectAgentsDir = path.join(repoPath, ".code-ux", "agents");
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

  describe("resolveTargetedPlanningAgent", () => {
    it("resolves to the default planning agent when no ID is provided", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-resolve-"));
      tempDirs.push(dir);
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

      const repoPath = path.join(dir, "repo");
      await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
      await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "planning_agent.md"), "Default planning instructions.", "utf8");

      const project = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: repoPath });
      const resolved = await syncService.resolveTargetedPlanningAgent(project.id);
      expect(resolved.name).toBe("Planning agent");
    });

    it("resolves to a valid targeted planning preset with 'planning' label", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-resolve-valid-"));
      tempDirs.push(dir);
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

      const project = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: "/fake" });
      const custom = agentPresetRepository.createAgentPreset(project.id, {
        name: "Custom Planner",
        instructionMarkdown: "Custom instructions.",
        labels: ["planning"],
      });

      const resolved = await syncService.resolveTargetedPlanningAgent(project.id, custom.id);
      expect(resolved.id).toBe(custom.id);
      expect(resolved.name).toBe("Custom Planner");
    });

    it("falls back to default planning agent if targeted ID is missing or invalid", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-resolve-fallback-"));
      tempDirs.push(dir);
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

      const repoPath = path.join(dir, "repo");
      await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
      await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "planning_agent.md"), "Default instructions.", "utf8");

      const project = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: repoPath });
      const resolved = await syncService.resolveTargetedPlanningAgent(project.id, "non-existent-id");
      expect(resolved.name).toBe("Planning agent");
    });

    it("falls back to default planning agent if targeted preset belongs to a different project", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-resolve-cross-project-"));
      tempDirs.push(dir);
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

      const repoPath = path.join(dir, "repo");
      await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
      await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "planning_agent.md"), "Default instructions.", "utf8");

      const p1 = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: repoPath });
      const p2 = projectRepository.createProject({ name: "P2", sourceType: "local", sourceRef: "/p2" });
      const p2Agent = agentPresetRepository.createAgentPreset(p2.id, {
        name: "P2 Planner",
        labels: ["planning"],
      });

      const resolved = await syncService.resolveTargetedPlanningAgent(p1.id, p2Agent.id);
      expect(resolved.name).toBe("Planning agent");
    });

    it("accepts targeted planning agent presets without requiring a planning label", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-resolve-unlabeled-"));
      tempDirs.push(dir);
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

      const repoPath = path.join(dir, "repo");
      await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
      await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "planning_agent.md"), "Default instructions.", "utf8");

      const project = projectRepository.createProject({ name: "P1", sourceType: "local", sourceRef: repoPath });
      const unlabeled = agentPresetRepository.createAgentPreset(project.id, {
        name: "Just a Worker",
        labels: ["worker"],
      });

      const resolved = await syncService.resolveTargetedPlanningAgent(project.id, unlabeled.id);
      expect(resolved.name).toBe("Just a Worker");
    });
  });
});
