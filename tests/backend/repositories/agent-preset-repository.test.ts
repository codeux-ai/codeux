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
      memoryTemplateOverrideEnabled: true,
      memoryTemplateMarkdown: "Memory format",
    });

    const updated = agentPresetRepository.updateAgentPreset(created.id, {
      name: "Worker",
      description: "Executes implementation tasks.",
      instructionMarkdown: "Pick up tasks and report progress.",
      labels: ["execution"],
      avatarConfig: { body: "human" },
      memoryTemplateOverrideEnabled: false,
    });
    expect(updated).toMatchObject({
      name: "Worker",
      description: "Executes implementation tasks.",
      instructionMarkdown: "Pick up tasks and report progress.",
      labels: ["execution"],
      avatarConfig: { body: "human" },
      memoryTemplateOverrideEnabled: false,
      memoryTemplateMarkdown: "Memory format",
    });

    const listed = agentPresetRepository.listAgentPresets(project.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    agentPresetRepository.deleteAgentPreset(created.id);
    expect(agentPresetRepository.listAgentPresets(project.id)).toEqual([]);
  });
});
