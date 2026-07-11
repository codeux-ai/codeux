import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { SkillRepository } from "../../../src/repositories/skill-repository.js";
import { KnowledgeRepository } from "../../../src/repositories/knowledge-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { AgentPresetSyncService, PROJECT_MANAGER_DEFAULT_SKILL_STORAGE_NAME } from "../../../src/services/agent-preset-sync-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";
import { KnowledgeIngestionService } from "../../../src/services/knowledge-ingestion-service.js";
import { KnowledgeService } from "../../../src/services/knowledge-service.js";
import { PrService } from "../../../src/infrastructure/providers/cli/pr-service.js";
import { DEFAULT_PLAYWRIGHT_MCP_SERVER_ID } from "../../../src/repositories/settings-defaults.js";

const tempDirs: string[] = [];
const appStorages: AppDbStorage[] = [];
const settingsRepositories: SettingsRepository[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalEnableInstallInTests = process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noopLogger } as any;
const fakeEmbeddingService = {
  isLoaded: () => true,
  getLoadedModelId: () => "bge-small-en-v1.5",
  getDimension: () => 2,
  embed: async () => new Float32Array([1, 0]),
} as any;

async function runGit(args: string[], cwd: string): Promise<void> {
  await runCommandStrict("git", args, cwd);
}

async function initializeGitRepo(repoPath: string, branch = "main"): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true });
  await runGit(["init", "-b", branch], repoPath);
  await runGit(["config", "user.name", "Code UX Test"], repoPath);
  await runGit(["config", "user.email", "codeux-test@example.com"], repoPath);
}

async function createRepoProject(
  dir: string,
  repoPath: string,
  getGithubToken?: () => string | undefined,
): Promise<{
  projectRepository: ProjectManagementRepository;
  agentPresetRepository: AgentPresetRepository;
  settingsRepository: SettingsRepository;
  syncService: AgentPresetSyncService;
  project: Awaited<ReturnType<ProjectManagementRepository["createProject"]>>;
}> {
  const storage = createAppStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
  const syncService = new AgentPresetSyncService({
    projectManagementRepository: projectRepository,
    agentPresetRepository,
    settingsRepository,
    getGithubToken,
    projectRoot: dir,
  });
  const project = projectRepository.createProject({
    name: "Repository Push Project",
    sourceType: "local",
    sourceRef: repoPath,
  });
  return { projectRepository, agentPresetRepository, settingsRepository, syncService, project };
}

const createAppStorage = (dbPath: string): AppDbStorage => {
  const storage = new AppDbStorage(dbPath);
  appStorages.push(storage);
  return storage;
};

const createSettingsRepository = (dbPath: string): SettingsRepository => {
  const repository = new SettingsRepository(dbPath);
  settingsRepositories.push(repository);
  return repository;
};

async function writeBundledAgentAssets(
  root: string,
  instructions: { planning: string; projectManager: string },
): Promise<void> {
  const agentsDir = path.join(root, ".code-ux", "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.mkdir(path.join(root, ".code-ux", "container"), { recursive: true });
  await fs.writeFile(path.join(agentsDir, "planning_agent.md"), instructions.planning, "utf8");
  await fs.writeFile(path.join(agentsDir, "project_manager.md"), instructions.projectManager, "utf8");
  await fs.writeFile(path.join(agentsDir, "quality_assurance_agent.md"), "Review changes.\n", "utf8");
  await fs.writeFile(path.join(agentsDir, "worker.md"), "Implement changes.\n", "utf8");
  await fs.writeFile(path.join(root, ".code-ux", "container", "setup.sh"), "#!/bin/sh\n", "utf8");
}

beforeEach(async () => {
  delete process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-home-"));
  tempDirs.push(homeDir);
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
});

afterEach(async () => {
  for (const repository of settingsRepositories.splice(0).reverse()) {
    repository.close();
  }
  for (const storage of appStorages.splice(0).reverse()) {
    storage.close();
  }
  process.env.HOME = originalHome;
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
  if (originalEnableInstallInTests === undefined) {
    delete process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS;
  } else {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = originalEnableInstallInTests;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("AgentPresetSyncService", () => {
  it("returns existing dashboard presets without awaiting background markdown sync", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-dashboard-fast-list-"));
    tempDirs.push(dir);

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Fast Dashboard Agents",
      sourceType: "local",
      sourceRef: path.join(dir, "repo"),
    });
    agentPresetRepository.createAgentPreset(project.id, {
      name: "Existing Worker",
      instructionMarkdown: "Use the stored sqlite instructions.\n",
    });

    let releaseSync!: () => void;
    let markSyncStarted!: () => void;
    const syncStarted = new Promise<void>((resolve) => {
      markSyncStarted = resolve;
    });
    const syncBlocker = new Promise<void>((release) => {
      releaseSync = release;
    });
    const syncSpy = vi.spyOn(syncService, "syncProjectAgents").mockImplementation(async () => {
      markSyncStarted();
      await syncBlocker;
    });

    const result = await Promise.race([
      syncService.listAgentPresetsForDashboard(project.id),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
    ]);

    expect(result).not.toBeNull();
    const presets = result as Awaited<ReturnType<AgentPresetSyncService["listAgentPresetsForDashboard"]>>;
    expect(presets[0]?.name).toBe("Existing Worker");
    expect(syncSpy).toHaveBeenCalledTimes(1);
    await syncStarted;

    await syncService.listAgentPresetsForDashboard(project.id);
    expect(syncSpy).toHaveBeenCalledTimes(1);

    releaseSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    syncSpy.mockRestore();
  });

  it("imports project markdown agents and auto-syncs content on change", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-sync-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    const agentPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");
    await fs.writeFile(agentPath, "---json\n{\"avatarConfig\":{\"body\":\"alien\"},\"memoryTemplateOverrideEnabled\":true}\n---\nInitial planning instructions.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
    expect(drifted[0]?.avatarConfig).toMatchObject({
      chassis: "square",
      accent: "lavender",
      baseColor: "ivory",
    });
    expect(drifted[0]?.memoryTemplateOverrideEnabled).toBe(false);
  });

  it("keeps built-in default agents available from bundled defaults after deletion", async () => {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-default-once-"));
    tempDirs.push(dir);

    const projectRoot = path.join(dir, "app");
    const repoPath = path.join(dir, "repo");
    const homeDir = path.join(dir, "home");
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

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

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
    expect(initial.find((preset) => preset.name === "Worker")?.mcpAccess?.linkedServerIds).toEqual([DEFAULT_PLAYWRIGHT_MCP_SERVER_ID]);
    expect(initial.find((preset) => preset.name === "Worker")?.mcpAccess?.codeUxEnabled).toBe(false);
    expect(initial.find((preset) => preset.name === "Project manager")?.mcpAccess?.linkedServerIds).toEqual([DEFAULT_PLAYWRIGHT_MCP_SERVER_ID]);
    expect(initial.find((preset) => preset.name === "Project manager")?.mcpAccess?.codeUxEnabled).toBe(false);
    expect(initial.find((preset) => preset.name === "Planning agent")?.mcpAccess).toBeUndefined();
    expect(initial.find((preset) => preset.name === "Quality assurance agent")?.mcpAccess).toBeUndefined();
    expect(agentPresetRepository.hasCopiedDefaultAgentPresets(project.id)).toBe(false);

    const worker = initial.find((preset) => preset.name === "Worker");
    expect(worker?.sourceScope).toBe("default");
    await syncService.deleteAgentPreset(worker!.id);
    await fs.rm(path.join(homeDir, ".code-ux", "agents", "worker.md"), { force: true });

    const afterDelete = await syncService.listAgentPresets(project.id);
    expect(afterDelete.find((preset) => preset.name === "Worker")).toMatchObject({
      sourceScope: "default",
      instructionMarkdown: "default worker.md",
    });
    await expect(fs.stat(path.join(homeDir, ".code-ux", "agents", "worker.md"))).resolves.toBeTruthy();
  });

  it("normalizes project manager sources and resolves the project manager agent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-manager-agent-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".code-ux", "agents", "project_manager.md"),
      "Answer Jules clarification requests.\n",
      "utf8",
    );

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
    expect(resolved.mcpAccess?.linkedServerIds).toEqual([DEFAULT_PLAYWRIGHT_MCP_SERVER_ID]);
    expect(resolved.mcpAccess?.codeUxEnabled).toBe(false);
  });

  it("preserves existing explicit MCP access when syncing markdown agents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-explicit-mcp-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".code-ux", "agents", "worker.md"),
      "Use explicit MCP access from the existing preset.\n",
      "utf8",
    );

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Explicit MCP Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    agentPresetRepository.createAgentPreset(project.id, {
      name: "Worker",
      instructionMarkdown: "Existing worker.",
      mcpAccess: {
        codeUxEnabled: true,
        codeUxToolToggles: [{ name: "manage_tasks", enabled: false, isInternal: true }],
        linkedServerIds: ["custom-docs"],
      },
    });

    const presets = await syncService.listAgentPresets(project.id);
    const worker = presets.find((preset) => preset.name === "Worker");

    expect(worker?.instructionMarkdown).toContain("Use explicit MCP access");
    expect(worker?.mcpAccess).toEqual({
      codeUxEnabled: true,
      codeUxToolToggles: [{ name: "manage_tasks", enabled: false, isInternal: true }],
      linkedServerIds: ["custom-docs"],
    });
  });

  it("seeds Code UX internal docs as a default Project manager knowledge subscription once", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-manager-internal-docs-"));
    tempDirs.push(dir);

    const projectRoot = path.join(dir, "app");
    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(projectRoot, "docs"), { recursive: true });
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "docs", "index.md"), "# Code UX\n\nInternal docs.", "utf8");
    await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "project_manager.md"), "Manage the project.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const knowledgeRepository = new KnowledgeRepository(storage);
    const knowledgeService = new KnowledgeService(
      knowledgeRepository,
      new KnowledgeIngestionService(noopLogger),
      fakeEmbeddingService,
      noopLogger,
    );
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot,
      knowledgeService,
    });

    const project = projectRepository.createProject({
      name: "Project manager Internal Docs",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const presets = await syncService.listAgentPresets(project.id);
    const projectManager = presets.find((preset) => preset.name === "Project manager");
    expect(projectManager).toBeTruthy();
    const docs = knowledgeService.listDocuments(project.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: "codeux/internaldocs", sourceRef: "codeux/internaldocs" });
    expect(knowledgeService.listSubscriptions(projectManager!.id)).toEqual([docs[0]!.id]);

    knowledgeService.setSubscriptions(projectManager!.id, project.id, []);
    await syncService.syncProjectAgents(project.id);
    expect(knowledgeService.listSubscriptions(projectManager!.id)).toEqual([]);
  });

  it("seeds one enabled persistent skill storage for the Project manager without overriding later opt-out", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-manager-default-skills-"));
    tempDirs.push(dir);
    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "project_manager.md"), "Manage the project.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const skillRepository = new SkillRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
      skillService: {
        listStorages: (projectId) => skillRepository.listStorages(projectId),
        createStorage: (projectId, input) => skillRepository.createStorage(projectId, input),
      },
    });
    const project = projectRepository.createProject({
      name: "Project Manager Default Skills",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const presets = await syncService.listAgentPresets(project.id);
    const projectManager = presets.find((preset) => preset.name === "Project manager");
    expect(projectManager).toMatchObject({ persistentSkillStorage: { enabled: true } });
    expect(projectManager?.persistentSkillStorageIds).toHaveLength(1);
    expect(skillRepository.listStorages(project.id)).toEqual([
      expect.objectContaining({
        id: projectManager?.persistentSkillStorageIds[0],
        name: PROJECT_MANAGER_DEFAULT_SKILL_STORAGE_NAME,
        storageKind: "project",
      }),
    ]);

    agentPresetRepository.updateAgentPreset(projectManager!.id, {
      persistentSkillStorage: { enabled: false },
    });
    await syncService.syncProjectAgents(project.id);
    expect(agentPresetRepository.getAgentPreset(projectManager!.id)).toMatchObject({
      persistentSkillStorage: { enabled: false },
      persistentSkillStorageIds: projectManager?.persistentSkillStorageIds,
    });
    expect(skillRepository.listStorages(project.id)).toHaveLength(1);
  });

  it("repairs stale DB content when source metadata already matches", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-stale-content-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    const agentPath = path.join(repoPath, ".code-ux", "agents", "worker.md");
    await fs.writeFile(agentPath, "Real worker instructions.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-dashboard-write-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const defaultAgentsDir = path.join(dir, ".code-ux", "agents");
    await fs.mkdir(defaultAgentsDir, { recursive: true });
    const defaultPlanningPath = path.join(defaultAgentsDir, "planning_agent.md");
    await fs.writeFile(defaultPlanningPath, "Default planning instructions.\n", "utf8");
    await fs.writeFile(path.join(defaultAgentsDir, "project_manager.md"), "Default manager instructions.\n", "utf8");
    await fs.writeFile(path.join(defaultAgentsDir, "quality_assurance_agent.md"), "Default QA instructions.\n", "utf8");
    await fs.writeFile(path.join(defaultAgentsDir, "worker.md"), "Default worker instructions.\n", "utf8");
    await fs.mkdir(path.join(dir, ".code-ux", "container"), { recursive: true });
    await fs.writeFile(path.join(dir, ".code-ux", "container", "setup.sh"), "#!/usr/bin/env bash\necho setup\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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

  it("explicitly pulls newly discovered project markdown agents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-pull-new-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const projectAgentsDir = path.join(repoPath, ".code-ux", "agents");
    await fs.mkdir(projectAgentsDir, { recursive: true });
    await fs.writeFile(path.join(projectAgentsDir, "reviewer.md"), "Review the local changes.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Pull New Agent Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const pulled = await syncService.pullAgentPresetsFromMarkdown(project.id);

    expect(pulled).toHaveLength(1);
    expect(pulled[0]).toMatchObject({
      name: "reviewer",
      instructionMarkdown: "Review the local changes.",
      sourceScope: "project",
      syncStatus: "synced",
    });
  });

  it("explicitly pulls out-of-sync markdown content into sqlite", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-pull-drift-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const projectAgentsDir = path.join(repoPath, ".code-ux", "agents");
    await fs.mkdir(projectAgentsDir, { recursive: true });
    const agentPath = path.join(projectAgentsDir, "planning_agent.md");
    await fs.writeFile(agentPath, "Initial planning.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Pull Drift Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    await syncService.pullAgentPresetsFromMarkdown(project.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(agentPath, "Markdown wins on explicit pull.\n", "utf8");

    const pulled = await syncService.pullAgentPresetsFromMarkdown(project.id);

    expect(pulled.find((preset) => preset.name === "Planning agent")).toMatchObject({
      instructionMarkdown: "Markdown wins on explicit pull.",
      syncStatus: "synced",
    });
  });

  it("pushes manual sqlite agents to project markdown and links source metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-manual-md-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Push Manual Agent Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: false,
      },
    });
    const manual = await syncService.createAgentPreset(project.id, {
      name: "Database Reviewer",
      description: "Reviews sqlite-only instructions.",
      instructionMarkdown: "Check the diff carefully.\n",
      avatarConfig: { body: "robot", chassis: "round" },
      providerConfigId: "codex-main",
      model: "gpt-5-codex",
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Memory: {{project_memory}}",
      memoryConfig: {
        tier: "both",
        categories: ["context"],
        minStrength: 1,
        minStrengthPerCategory: {},
        maxShortTerm: 3,
        maxLongTerm: 5,
      },
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: true,
      },
    });

    const pushed = await syncService.pushAgentPresetsToMarkdown(project.id);
    const exported = pushed.find((preset) => preset.id === manual.id);
    const expectedPath = path.join(repoPath, ".code-ux", "agents", "database_reviewer.md");
    const markdown = await fs.readFile(expectedPath, "utf8");

    expect(exported).toMatchObject({
      sourcePath: expectedPath,
      sourceScope: "project",
      sourceExists: true,
      syncStatus: "synced",
    });
    expect(exported?.sourceUpdatedAt).toBeTruthy();
    expect(exported?.sourceImportedAt).toBe(exported?.sourceUpdatedAt);
    expect(markdown).toContain('"description": "Reviews sqlite-only instructions."');
    expect(markdown).toContain('"providerConfigId": "codex-main"');
    expect(markdown).toContain('"model": "gpt-5-codex"');
    expect(markdown).toContain('"memoryTemplateOverrideEnabled": true');
    expect(markdown).toContain('"tier": "both"');
    expect(markdown).toContain("Check the diff carefully.");
  });

  it("pushes out-of-sync sqlite agents over their project markdown source", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-drift-md-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const projectAgentsDir = path.join(repoPath, ".code-ux", "agents");
    await fs.mkdir(projectAgentsDir, { recursive: true });
    const agentPath = path.join(projectAgentsDir, "worker.md");
    await fs.writeFile(agentPath, "Markdown-side worker.\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Push Drift Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const [worker] = await syncService.pullAgentPresetsFromMarkdown(project.id);
    agentPresetRepository.updateAgentPreset(worker!.id, {
      instructionMarkdown: "Sqlite-side worker should be exported.\n",
    });

    const pushed = await syncService.pushAgentPresetsToMarkdown(project.id);

    expect(pushed.find((preset) => preset.id === worker!.id)?.syncStatus).toBe("synced");
    expect(await fs.readFile(agentPath, "utf8")).toContain("Sqlite-side worker should be exported.");
  });

  it("pushes default-backed agents as project markdown overrides", async () => {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-default-md-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const defaultAgentsDir = path.join(dir, ".code-ux", "agents");
    await fs.mkdir(defaultAgentsDir, { recursive: true });
    await fs.mkdir(path.join(dir, ".code-ux", "container"), { recursive: true });
    await fs.writeFile(path.join(defaultAgentsDir, "planning_agent.md"), "Default planning.\n", "utf8");
    await fs.writeFile(path.join(defaultAgentsDir, "project_manager.md"), "Default manager.\n", "utf8");
    await fs.writeFile(path.join(defaultAgentsDir, "quality_assurance_agent.md"), "Default QA.\n", "utf8");
    await fs.writeFile(path.join(defaultAgentsDir, "worker.md"), "Default worker.\n", "utf8");
    await fs.writeFile(path.join(dir, ".code-ux", "container", "setup.sh"), "#!/usr/bin/env bash\necho setup\n", "utf8");

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Push Default Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    const imported = await syncService.listAgentPresets(project.id);
    const planning = imported.find((preset) => preset.name === "Planning agent");
    expect(planning?.sourceScope).toBe("default");

    const pushed = await syncService.pushAgentPresetsToMarkdown(project.id);
    const projectPlanningPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");

    expect(pushed.find((preset) => preset.id === planning!.id)).toMatchObject({
      sourceScope: "project",
      sourcePath: projectPlanningPath,
      syncStatus: "synced",
    });
    expect(await fs.readFile(projectPlanningPath, "utf8")).toContain("Default planning.");
  });

  it("fails markdown pushes when project markdown mirroring is disabled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-disabled-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Disabled Push Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: false,
      },
    });
    const manual = await syncService.createAgentPreset(project.id, {
      name: "Manual Only",
      instructionMarkdown: "Do not mirror this yet.\n",
    });

    await expect(syncService.pushAgentPresetsToMarkdown(project.id)).rejects.toThrow("Project agent markdown mirroring is disabled");
    await expect(syncService.exportAgentPresetToMarkdown(manual.id)).rejects.toThrow("Project agent markdown mirroring is disabled");
  });

  it("prevents exporting over a markdown file linked to a different agent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-overwrite-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const projectAgentsDir = path.join(repoPath, ".code-ux", "agents");
    await fs.mkdir(projectAgentsDir, { recursive: true });
    const workerPath = path.join(projectAgentsDir, "worker.md");
    await fs.writeFile(workerPath, "This file belongs to a different agent.\n", "utf8");
    const stats = await fs.stat(workerPath);

    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const project = projectRepository.createProject({
      name: "Overwrite Guard Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: false,
      },
    });
    const worker = await syncService.createAgentPreset(project.id, {
      name: "Worker",
      instructionMarkdown: "Worker DB content.\n",
    });
    const reviewer = await syncService.createAgentPreset(project.id, {
      name: "Reviewer",
      instructionMarkdown: "Reviewer DB content.\n",
    });
    agentPresetRepository.linkAgentPresetToSource(reviewer.id, {
      sourcePath: workerPath,
      sourceScope: "project",
      sourceUpdatedAt: stats.mtime.toISOString(),
      sourceImportedAt: stats.mtime.toISOString(),
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: true,
      },
    });

    await expect(syncService.exportAgentPresetToMarkdown(worker.id)).rejects.toThrow(
      `Cannot export agent "Worker" to ${workerPath} because that markdown file belongs to agent "Reviewer".`,
    );
    expect(await fs.readFile(workerPath, "utf8")).toBe("This file belongs to a different agent.\n");
  });

  it("commits agent preset markdown without pushing when the repository has no origin", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-commit-only-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    await initializeGitRepo(repoPath);
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "worker.md"), "Commit only worker.\n", "utf8");

    const { syncService, project } = await createRepoProject(dir, repoPath);

    const result = await syncService.pushAgentPresetsToRepository(project.id, { mode: "commit_only" });

    expect(result).toEqual({ committed: true });
    const log = await runCommandStrict("git", ["log", "-1", "--pretty=%s"], repoPath);
    expect(log.stdout.trim()).toBe("chore: push agent presets");
  });

  it("pushes committed agent preset markdown to origin when requested", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-commit-and-push-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const originPath = path.join(dir, "origin.git");
    await fs.mkdir(originPath, { recursive: true });
    await runGit(["init", "--bare"], originPath);
    await initializeGitRepo(repoPath);
    await runGit(["remote", "add", "origin", originPath], repoPath);
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "worker.md"), "Push worker.\n", "utf8");

    const { syncService, project } = await createRepoProject(dir, repoPath);

    const result = await syncService.pushAgentPresetsToRepository(project.id, { mode: "commit_and_push" });

    expect(result).toEqual({
      committed: true,
      pushedBranch: "main",
    });
    const remoteHead = await runCommandStrict("git", ["ls-remote", "--heads", "origin", "main"], repoPath);
    expect(remoteHead.stdout.trim()).toContain("refs/heads/main");
  });

  it("creates a feature branch and resolves a pull request when pushing agent preset markdown", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-push-pr-"));
    tempDirs.push(dir);

    const repoPath = path.join(dir, "repo");
    const originPath = path.join(dir, "origin.git");
    await fs.mkdir(originPath, { recursive: true });
    await runGit(["init", "--bare"], originPath);
    await initializeGitRepo(repoPath);
    await runGit(["remote", "add", "origin", originPath], repoPath);
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    await fs.writeFile(path.join(repoPath, ".code-ux", "agents", "worker.md"), "Pull request worker.\n", "utf8");

    const prUrl = "https://example.com/acme/repo/pull/7";
    const prSpy = vi.spyOn(PrService.prototype, "resolveOrCreateFeaturePr").mockResolvedValue(prUrl);

    const { syncService, project, settingsRepository } = await createRepoProject(dir, repoPath, () => "runtime-github-token");
    const settings = settingsRepository.saveProjectSettings(project.id, {
      git: {
        githubToken: "settings-github-token",
        gitlabToken: "settings-gitlab-token",
      },
    });
    const result = await syncService.pushAgentPresetsToRepository(project.id, {
      mode: "pull_request",
    });

    const pushCall = prSpy.mock.calls[0];
    const pushArgs = pushCall?.[0] as {
      workerBranch?: string;
    } | undefined;
    const pushedBranch = pushArgs?.workerBranch;
    expect(pushedBranch).toMatch(/^agents\/push-/);
    expect(result).toEqual({
      committed: true,
      pushedBranch,
      pullRequestUrl: prUrl,
    });
    expect(prSpy).toHaveBeenCalledWith({
      taskId: `agent-preset-push:${project.id}`,
      provider: "codex",
      title: "Push agent presets",
      featureBranch: "main",
      workerBranch: pushedBranch,
      body: `Project: ${project.name}\n\nPush the project's .code-ux/agents markdown files into the repository.`,
    }, repoPath, {
      githubToken: "runtime-github-token",
      gitlabToken: settings.git.gitlabToken,
    });
    const remoteHead = await runCommandStrict("git", ["ls-remote", "--heads", "origin", pushedBranch!], repoPath);
    expect(remoteHead.stdout.trim()).toContain(`refs/heads/${pushedBranch}`);
    prSpy.mockRestore();
  });

  describe("resolveTargetedPlanningAgent", () => {
    it("resolves to the default planning agent when no ID is provided", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-resolve-"));
      tempDirs.push(dir);
      const storage = createAppStorage(path.join(dir, "app.db"));
      const projectRepository = new ProjectManagementRepository(storage);
      const agentPresetRepository = new AgentPresetRepository(storage);
      const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
      const storage = createAppStorage(path.join(dir, "app.db"));
      const projectRepository = new ProjectManagementRepository(storage);
      const agentPresetRepository = new AgentPresetRepository(storage);
      const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
      const storage = createAppStorage(path.join(dir, "app.db"));
      const projectRepository = new ProjectManagementRepository(storage);
      const agentPresetRepository = new AgentPresetRepository(storage);
      const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
      const storage = createAppStorage(path.join(dir, "app.db"));
      const projectRepository = new ProjectManagementRepository(storage);
      const agentPresetRepository = new AgentPresetRepository(storage);
      const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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
      const storage = createAppStorage(path.join(dir, "app.db"));
      const projectRepository = new ProjectManagementRepository(storage);
      const agentPresetRepository = new AgentPresetRepository(storage);
      const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));
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

  it("auto-applies changed bundled instructions to untouched built-ins and their project mirror without changing metadata", async () => {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-base-update-"));
    tempDirs.push(dir);
    await writeBundledAgentAssets(dir, {
      planning: "Bundled planning revision one.\n",
      projectManager: "Bundled manager revision one.\n",
    });
    const repoPath = path.join(dir, "repo");
    const { agentPresetRepository, settingsRepository, syncService, project } = await createRepoProject(dir, repoPath);
    const initial = await syncService.listAgentPresets(project.id);
    const planning = initial.find((preset) => preset.name === "Planning agent")!;
    const manager = initial.find((preset) => preset.name === "Project manager")!;

    const customizedMetadata = agentPresetRepository.updateAgentPreset(planning.id, {
      labels: ["planning", "protected-label"],
      avatarConfig: { chassis: "classic", accent: "jade", baseColor: "pearl" },
      providerConfigId: "codex-special",
      model: "gpt-special",
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Remember carefully.",
      memoryConfig: {
        tier: "both",
        categories: ["context"],
        minStrength: 2,
        minStrengthPerCategory: { context: 3 },
        maxShortTerm: 4,
        maxLongTerm: 5,
      },
      mcpAccess: {
        codeUxEnabled: false,
        codeUxToolToggles: [],
        linkedServerIds: ["custom-server"],
      },
    });
    await syncService.exportAgentPresetToMarkdown(customizedMetadata.id);
    agentPresetRepository.updateAgentPreset(manager.id, {
      description: "User-authored manager metadata.",
      avatarConfig: { chassis: "round", accent: "amber" },
      providerConfigId: "manager-provider",
      model: "manager-model",
      labels: ["manager", "preserved"],
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Manager memory.",
    });
    const projectPlanningPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");
    const beforeRouting = settingsRepository.resolveProjectDashboardSettings(project.id).settings.agents.routing;
    const bundledPlanningPath = path.join(dir, ".code-ux", "agents", "planning_agent.md");
    const bundledManagerPath = path.join(dir, ".code-ux", "agents", "project_manager.md");
    const planningTimestamp = (await fs.stat(bundledPlanningPath)).mtime;
    const managerTimestamp = (await fs.stat(bundledManagerPath)).mtime;

    await writeBundledAgentAssets(dir, {
      planning: "Bundled planning revision two with deterministic content.\n",
      projectManager: "Bundled manager revision two.\n",
    });
    await fs.utimes(bundledPlanningPath, planningTimestamp, planningTimestamp);
    await fs.utimes(bundledManagerPath, managerTimestamp, managerTimestamp);
    const synced = await syncService.listAgentPresets(project.id);
    const updated = synced.find((preset) => preset.id === planning.id)!;

    expect(updated).toMatchObject({
      instructionMarkdown: "Bundled planning revision two with deterministic content.",
      labels: ["planning", "protected-label"],
      avatarConfig: { chassis: "classic", accent: "jade", baseColor: "pearl" },
      providerConfigId: "codex-special",
      model: "gpt-special",
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Remember carefully.",
      memoryConfig: { tier: "both", categories: ["context"], maxShortTerm: 4, maxLongTerm: 5 },
      mcpAccess: { linkedServerIds: ["custom-server"] },
      sourceScope: "project",
    });
    expect(await fs.readFile(projectPlanningPath, "utf8")).toContain("Bundled planning revision two");
    expect(synced.find((preset) => preset.id === manager.id)).toMatchObject({
      instructionMarkdown: "Bundled manager revision two.",
      description: "User-authored manager metadata.",
      avatarConfig: { chassis: "round", accent: "amber" },
      providerConfigId: "manager-provider",
      model: "manager-model",
      labels: ["manager", "preserved"],
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Manager memory.",
    });
    expect(settingsRepository.resolveProjectDashboardSettings(project.id).settings.agents.routing).toEqual(beforeRouting);
    expect(await syncService.listBaseAgentUpdateNotices(project.id)).toEqual([]);
  });

  it("marks dashboard, database-only, and project markdown instruction edits as customized and never overwrites them", async () => {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-base-customized-"));
    tempDirs.push(dir);
    await writeBundledAgentAssets(dir, {
      planning: "Planning baseline.\n",
      projectManager: "Manager baseline.\n",
    });
    const repoPath = path.join(dir, "repo");
    const { agentPresetRepository, settingsRepository, syncService, project } = await createRepoProject(dir, repoPath);
    const initial = await syncService.listAgentPresets(project.id);
    const planning = initial.find((preset) => preset.name === "Planning agent")!;
    const manager = initial.find((preset) => preset.name === "Project manager")!;

    await syncService.updateAgentPreset(planning.id, { instructionMarkdown: "Dashboard-authored planning behavior." });
    settingsRepository.saveProjectSettings(project.id, { agents: { saveToProjectDirectory: false } });
    agentPresetRepository.updateAgentPreset(manager.id, { instructionMarkdown: "Database-only manager behavior." });
    await writeBundledAgentAssets(dir, {
      planning: "New planning bundle.\n",
      projectManager: "New manager bundle.\n",
    });

    let synced = await syncService.listAgentPresets(project.id);
    expect(synced.find((preset) => preset.id === planning.id)?.instructionMarkdown).toBe("Dashboard-authored planning behavior.");
    expect(synced.find((preset) => preset.id === manager.id)?.instructionMarkdown).toBe("Database-only manager behavior.");
    expect((await syncService.listBaseAgentUpdateNotices(project.id)).map((notice) => notice.reason)).toEqual([
      "customized_instructions",
      "customized_instructions",
    ]);

    const projectPlanningPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");
    await fs.writeFile(projectPlanningPath, "Project markdown planning behavior.\n", "utf8");
    synced = await syncService.listAgentPresets(project.id);
    expect(synced.find((preset) => preset.id === planning.id)?.instructionMarkdown).toBe("Project markdown planning behavior.");
  });

  it("initializes legacy baselines safely and reports alternate planning and dashboard-reply routes", async () => {
    process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS = "1";
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-base-legacy-routing-"));
    tempDirs.push(dir);
    await writeBundledAgentAssets(dir, {
      planning: "Current planning bundle.\n",
      projectManager: "Current manager bundle.\n",
    });
    const repoPath = path.join(dir, "repo");
    const { agentPresetRepository, settingsRepository, syncService, project } = await createRepoProject(dir, repoPath);
    const legacyPlanning = agentPresetRepository.createAgentPreset(project.id, {
      name: "Planning agent",
      instructionMarkdown: "Current planning bundle.",
    });
    const legacyManager = agentPresetRepository.createAgentPreset(project.id, {
      name: "Project manager",
      instructionMarkdown: "Legacy customized manager behavior.",
    });
    await syncService.listAgentPresets(project.id);
    expect(agentPresetRepository.getAgentPreset(legacyPlanning.id)?.baseInstructionStates?.planning_agent).toMatchObject({
      customized: false,
    });
    expect(agentPresetRepository.getAgentPreset(legacyManager.id)?.baseInstructionStates?.project_manager).toMatchObject({
      customized: true,
      lastAppliedRevision: null,
    });

    settingsRepository.saveProjectSettings(project.id, { agents: { saveToProjectDirectory: false } });
    const alternatePlanning = await syncService.createAgentPreset(project.id, {
      name: "Specialist planner",
      instructionMarkdown: "Specialist planning behavior.",
      avatarConfig: { chassis: "classic", accent: "jade" },
      providerConfigId: "alternate-provider",
      model: "alternate-model",
    });
    const alternateManager = await syncService.createAgentPreset(project.id, {
      name: "Specialist manager",
      instructionMarkdown: "Specialist manager behavior.",
    });
    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        routing: {
          planning: { agentPresetId: alternatePlanning.id },
          dashboardReply: { agentPresetId: alternateManager.id },
        },
      },
    });

    const notices = await syncService.listBaseAgentUpdateNotices(project.id);
    expect(notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "planning_agent", selectedAgentPresetId: alternatePlanning.id, reason: "alternate_route" }),
      expect.objectContaining({ role: "project_manager", selectedAgentPresetId: alternateManager.id, reason: "alternate_route" }),
    ]));
    const context = await syncService.getBaseAgentUpdateContext(project.id, "planning_agent");
    expect(context?.selectedAgentPreset).toMatchObject({
      id: alternatePlanning.id,
      avatarConfig: { chassis: "classic", accent: "jade" },
      providerConfigId: "alternate-provider",
      model: "alternate-model",
    });

    const applied = await syncService.applyBaseAgentInstructionUpdate(project.id, "planning_agent");
    expect(applied).toMatchObject({
      id: alternatePlanning.id,
      instructionMarkdown: "Current planning bundle.",
      avatarConfig: { chassis: "classic", accent: "jade" },
      providerConfigId: "alternate-provider",
      model: "alternate-model",
    });
    expect((await syncService.listBaseAgentUpdateNotices(project.id)).map((notice) => notice.role)).toEqual(["project_manager"]);
  });

  it("syncs agent memory settings down to md file on update and imports memory settings from md file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-memory-sync-"));
    tempDirs.push(dir);
    const storage = createAppStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const settingsRepository = createSettingsRepository(path.join(dir, "settings.db"));

    const syncService = new AgentPresetSyncService({
      projectManagementRepository: projectRepository,
      agentPresetRepository,
      settingsRepository,
      projectRoot: dir,
    });

    const repoPath = path.join(dir, "repo");
    await fs.mkdir(path.join(repoPath, ".code-ux", "agents"), { recursive: true });
    const agentPath = path.join(repoPath, ".code-ux", "agents", "planning_agent.md");
    await fs.writeFile(agentPath, "---json\n{\"memoryConfig\":{\"tier\":\"short_term\",\"categories\":[\"context\"],\"minStrength\":5,\"minStrengthPerCategory\":{},\"maxShortTerm\":0,\"maxLongTerm\":0}}\n---\nPlanning instructions.\n", "utf8");

    const project = projectRepository.createProject({
      name: "Sync Memory Project",
      sourceType: "local",
      sourceRef: repoPath,
    });

    settingsRepository.saveProjectSettings(project.id, {
      agents: {
        saveToProjectDirectory: true,
      },
    });

    // 1. Initial import check: memoryConfig should sync from MD to DB
    const imported = await syncService.listAgentPresets(project.id);
    expect(imported).toHaveLength(1);
    expect(imported[0]?.memoryConfig).toEqual({
      tier: "short_term",
      categories: ["context"],
      minStrength: 5,
      minStrengthPerCategory: {},
      maxShortTerm: 0,
      maxLongTerm: 0,
    });

    // 2. Update check: updating memoryConfig in DB should write back to the MD file
    const updated = await syncService.updateAgentPreset(imported[0]!.id, {
      memoryConfig: {
        tier: "long_term",
        categories: ["patterns"],
        minStrength: 2,
        minStrengthPerCategory: {},
        maxShortTerm: 10,
        maxLongTerm: 20,
      }
    });

    expect(updated.memoryConfig).toEqual({
      tier: "long_term",
      categories: ["patterns"],
      minStrength: 2,
      minStrengthPerCategory: {},
      maxShortTerm: 10,
      maxLongTerm: 20,
    });

    const mdContent = await fs.readFile(agentPath, "utf8");
    expect(mdContent).toContain('"tier": "long_term"');
    expect(mdContent).toContain('"categories": [\n      "patterns"\n    ]');
    expect(mdContent).toContain('"minStrength": 2');
    expect(mdContent).toContain('"maxShortTerm": 10');
    expect(mdContent).toContain('"maxLongTerm": 20');
  });
});
