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

    const created = agentPresetRepository.createAgentPreset(project.id, {
      name: "Project Manager",
      description: "Plans cross-functional backend and frontend work.",
      instructionMarkdown: "Coordinate planning and summarize blockers.",
      labels: ["planning", "review"],
      avatarConfig: { body: "alien", face: "happy" },
      providerConfigId: "opencode",
      model: "openai/gpt-5",
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Memory format",
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
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Memory format",
    });

    const updated = agentPresetRepository.updateAgentPreset(created.id, {
      name: "Worker",
      description: "Executes implementation tasks.",
      instructionMarkdown: "Pick up tasks and report progress.",
      labels: ["execution"],
      avatarConfig: { body: "human" },
      providerConfigId: null,
      model: "gpt-5.4",
      memoryTemplateOverrideEnabled: false,
    });
    expect(updated).toMatchObject({
      name: "Worker",
      description: "Executes implementation tasks.",
      instructionMarkdown: "Pick up tasks and report progress.",
      labels: ["execution"],
      avatarConfig: { body: "human" },
      providerConfigId: null,
      model: "gpt-5.4",
      memoryTemplateOverrideEnabled: false,
      memoryTemplateMarkdown: "Memory format",
    });

    const listed = agentPresetRepository.listAgentPresets(project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    agentPresetRepository.deleteAgentPreset(created.id);
    expect(agentPresetRepository.listAgentPresets(project.id)).toEqual([]);
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
});
