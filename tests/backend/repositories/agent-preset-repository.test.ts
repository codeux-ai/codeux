import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("AgentPresetRepository", () => {
  it("creates, updates, lists, and deletes project-scoped presets", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-preset-repo-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "Preset Project",
      sourceType: "local",
      sourceRef: "/workspace/preset-project",
    });
    const now = new Date().toISOString();
    storage.getDatabase().prepare(`
      INSERT INTO skill_storages (id, project_id, name, description, storage_kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "skills-core",
      project.id,
      "Core skills",
      "Shared project skills.",
      "project",
      now,
      now,
      "skills-review",
      project.id,
      "Review skills",
      "Review-specific skills.",
      "project",
      now,
      now,
    );

    const created = agentPresetRepository.createAgentPreset(project.id, {
      name: "Project Manager",
      description: "Plans cross-functional backend and frontend work.",
      instructionMarkdown: "Coordinate planning and summarize blockers.",
      labels: ["planning", "review"],
      avatarConfig: { body: "alien", face: "happy" },
      providerConfigId: "opencode",
      model: "openai/gpt-5",
      containerRunAsRoot: true,
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Memory format",
      memoryConfig: {
        tier: "both",
        categories: ["tasks"],
        minStrength: 0.25,
        minStrengthPerCategory: { tasks: 0.5 },
        maxShortTerm: 3,
        maxLongTerm: 5,
      },
      persistentSkillStorageIds: ["skills-core", "skills-core", "skills-review", ""],
      persistentSkillStorage: { enabled: true },
    });

    expect(created).toMatchObject({
      projectId: project.id,
      name: "Project Manager",
      description: "Plans cross-functional backend and frontend work.",
      instructionMarkdown: "Coordinate planning and summarize blockers.",
      labels: ["planning", "review"],
      avatarConfig: { body: "alien", face: "happy" },
      providerConfigId: "opencode",
      model: "openai/gpt-5",
      containerRunAsRoot: true,
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Memory format",
      memoryConfig: {
        tier: "both",
        categories: ["tasks"],
        minStrength: 0.25,
        minStrengthPerCategory: { tasks: 0.5 },
        maxShortTerm: 3,
        maxLongTerm: 5,
      },
      persistentSkillStorageIds: ["skills-core", "skills-review"],
      persistentSkillStorage: { enabled: true },
    });

    const updated = agentPresetRepository.updateAgentPreset(created.id, {
      name: "Worker",
      description: "Executes implementation tasks.",
      instructionMarkdown: "Pick up tasks and report progress.",
      labels: ["execution"],
      avatarConfig: { body: "human" },
      providerConfigId: null,
      model: "gpt-5.4",
      containerRunAsRoot: false,
      memoryTemplateOverrideEnabled: false,
      persistentSkillStorageIds: ["skills-review"],
      persistentSkillStorage: { enabled: false },
    });
    expect(updated).toMatchObject({
      name: "Worker",
      description: "Executes implementation tasks.",
      instructionMarkdown: "Pick up tasks and report progress.",
      labels: ["execution"],
      avatarConfig: { body: "human" },
      providerConfigId: null,
      model: "gpt-5.4",
      containerRunAsRoot: false,
      memoryTemplateOverrideEnabled: false,
      memoryTemplateMarkdown: "Memory format",
      memoryConfig: {
        tier: "both",
        categories: ["tasks"],
        minStrength: 0.25,
        minStrengthPerCategory: { tasks: 0.5 },
        maxShortTerm: 3,
        maxLongTerm: 5,
      },
      persistentSkillStorageIds: ["skills-review"],
      persistentSkillStorage: { enabled: false },
    });

    const listed = agentPresetRepository.listAgentPresets(project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    agentPresetRepository.deleteAgentPreset(created.id);
    expect(agentPresetRepository.listAgentPresets(project.id)).toEqual([]);
  });

  it("round-trips nullable Docker root overrides while legacy presets inherit defaults", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-preset-root-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "Root Override Project",
      sourceType: "local",
      sourceRef: "/workspace/root-project",
    });

    const legacy = agentPresetRepository.createAgentPreset(project.id, {
      name: "Legacy Worker",
    });
    expect(legacy.containerRunAsRoot).toBeNull();

    const forcedRoot = agentPresetRepository.createAgentPreset(project.id, {
      name: "Root Worker",
      containerRunAsRoot: true,
    });
    expect(forcedRoot.containerRunAsRoot).toBe(true);

    const forcedNonRoot = agentPresetRepository.updateAgentPreset(forcedRoot.id, {
      containerRunAsRoot: false,
    });
    expect(forcedNonRoot.containerRunAsRoot).toBe(false);

    const inheritedAgain = agentPresetRepository.updateAgentPreset(forcedRoot.id, {
      containerRunAsRoot: null,
    });
    expect(inheritedAgain.containerRunAsRoot).toBeNull();

    const imported = agentPresetRepository.importAgentPresetFromSource(project.id, {
      name: "Imported Root Worker",
      instructionMarkdown: "Run setup that requires root.",
      sourcePath: "/workspace/root-project/.code-ux/agents/imported_root_worker.md",
      sourceScope: "project",
      sourceUpdatedAt: new Date().toISOString(),
      containerRunAsRoot: true,
    });
    expect(imported.containerRunAsRoot).toBe(true);

    const listed = agentPresetRepository.listAgentPresets(project.id);
    expect(listed.find((preset) => preset.id === legacy.id)?.containerRunAsRoot).toBeNull();
    expect(listed.find((preset) => preset.id === forcedRoot.id)?.containerRunAsRoot).toBeNull();
    expect(listed.find((preset) => preset.id === imported.id)?.containerRunAsRoot).toBe(true);
  });

  it("saves memory config when importing a preset from markdown source", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-preset-import-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "Import Project",
      sourceType: "local",
      sourceRef: "/workspace/import-project",
    });

    const imported = agentPresetRepository.importAgentPresetFromSource(project.id, {
      name: "Planning Agent",
      description: "Imported from markdown.",
      instructionMarkdown: "Plan the sprint.",
      labels: ["planning"],
      sourcePath: "/workspace/import-project/.code-ux/agents/planning_agent.md",
      sourceScope: "project",
      sourceUpdatedAt: new Date().toISOString(),
      memoryConfig: {
        tier: "short_term",
        categories: [],
        minStrength: 0,
        minStrengthPerCategory: {},
        maxShortTerm: 0,
        maxLongTerm: 0,
      },
    });

    expect(imported.memoryConfig).toEqual({
      tier: "short_term",
      categories: [],
      minStrength: 0,
      minStrengthPerCategory: {},
      maxShortTerm: 0,
      maxLongTerm: 0,
    });
  });

  it("persists and sanitizes per-agent MCP access config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-preset-mcp-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "MCP Project",
      sourceType: "local",
      sourceRef: "/workspace/mcp-project",
    });

    const created = agentPresetRepository.createAgentPreset(project.id, { name: "Worker" });
    expect(created.mcpAccess).toBeUndefined();

    const updated = agentPresetRepository.updateAgentPreset(created.id, {
      mcpAccess: {
        codeUxEnabled: false,
        codeUxToolToggles: [
          { name: "manage_tasks", enabled: false, isInternal: true },
          { name: "not_a_real_tool", enabled: false, isInternal: true },
        ],
        linkedServerIds: ["srv-1", "srv-1", "srv-2"],
      },
    });

    expect(updated.mcpAccess?.codeUxEnabled).toBe(false);
    expect(updated.mcpAccess?.linkedServerIds).toEqual(["srv-1", "srv-2"]);
    expect(updated.mcpAccess?.codeUxToolToggles).toEqual([
      { name: "manage_tasks", enabled: false, isInternal: true },
    ]);

    // Other field updates preserve mcpAccess.
    const renamed = agentPresetRepository.updateAgentPreset(created.id, { name: "Renamed" });
    expect(renamed.mcpAccess?.codeUxEnabled).toBe(false);
    expect(renamed.mcpAccess?.linkedServerIds).toEqual(["srv-1", "srv-2"]);
  });

  it("round-trips typed base instruction state and safely ignores malformed legacy JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-agent-preset-base-state-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const project = projectRepository.createProject({
      name: "Base State Project",
      sourceType: "local",
      sourceRef: "/workspace/base-state-project",
    });

    const created = agentPresetRepository.createAgentPreset(project.id, {
      name: "Planning agent",
      instructionMarkdown: "Plan carefully.",
      baseInstructionStates: {
        planning_agent: {
          role: "planning_agent",
          baselineContentHash: "sha256:baseline",
          customized: false,
          lastAppliedRevision: "sha256:baseline",
        },
      },
    });
    expect(created.baseInstructionStates?.planning_agent).toEqual({
      role: "planning_agent",
      baselineContentHash: "sha256:baseline",
      customized: false,
      lastAppliedRevision: "sha256:baseline",
    });

    const renamed = agentPresetRepository.updateAgentPreset(created.id, { name: "Planning agent renamed" });
    expect(renamed.baseInstructionStates).toEqual(created.baseInstructionStates);

    storage.getDatabase().prepare(`
      UPDATE agent_presets
      SET base_instruction_state_json = ?
      WHERE id = ?
    `).run('{"planning_agent":{"role":"worker"}}', created.id);
    expect(agentPresetRepository.getAgentPreset(created.id)?.baseInstructionStates).toBeUndefined();
  });
});
