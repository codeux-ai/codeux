import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SkillRepository } from "../../../src/repositories/skill-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createFixture(): Promise<{
  storage: AppDbStorage;
  projects: ReturnType<ProjectManagementRepository["createProject"]>[];
  skillRepository: SkillRepository;
  agentPresetRepository: AgentPresetRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-skill-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const skillRepository = new SkillRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const p1 = projectRepository.createProject({ name: "Skill Project 1", sourceType: "local", sourceRef: "/workspace/skill-p1" });
  const p2 = projectRepository.createProject({ name: "Skill Project 2", sourceType: "local", sourceRef: "/workspace/skill-p2" });
  return { storage, projects: [p1, p2], skillRepository, agentPresetRepository };
}

describe("SkillRepository", () => {
  it("creates, updates, lists, and deletes storage-scoped skills", async () => {
    const { skillRepository, projects } = await createFixture();
    const project = projects[0]!;

    const storage = skillRepository.createStorage(project.id, {
      id: "core-skills",
      name: "Core skills",
      description: "Shared implementation guidance.",
    });
    expect(storage).toMatchObject({
      id: "core-skills",
      projectId: project.id,
      name: "Core skills",
      storageKind: "project",
    });

    const skill = skillRepository.createSkill(project.id, storage.id, {
      id: "error-handling",
      name: "Error handling",
      description: "Keep failures actionable.",
      contentMarkdown: "Return typed errors and preserve project boundaries.",
      sourceType: "imported",
      sourceRef: "skills/error-handling.md",
      tags: ["backend", "backend", "errors"],
      appliesTo: ["src/services", "src/repositories"],
      version: "1.0.0",
    });
    expect(skill).toMatchObject({
      projectId: project.id,
      storageId: storage.id,
      name: "Error handling",
      tags: ["backend", "errors"],
      appliesTo: ["src/services", "src/repositories"],
      version: "1.0.0",
    });
    expect(skill.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const updated = skillRepository.updateSkill(project.id, skill.id, {
      name: "Repository errors",
      contentMarkdown: "Throw not-found errors for cross-project reads.",
      tags: ["repositories"],
      appliesTo: ["src/repositories"],
      version: null,
    });
    expect(updated).toMatchObject({
      name: "Repository errors",
      tags: ["repositories"],
      appliesTo: ["src/repositories"],
      version: null,
    });
    expect(updated.contentHash).not.toBe(skill.contentHash);

    expect(skillRepository.listSkills(project.id, storage.id).map((entry) => entry.id)).toEqual([skill.id]);

    skillRepository.deleteSkill(project.id, skill.id);
    expect(skillRepository.listSkills(project.id, storage.id)).toEqual([]);
  });

  it("enforces project ownership for storages, skills, and attachments", async () => {
    const { skillRepository, agentPresetRepository, projects } = await createFixture();
    const [p1, p2] = projects;
    const storage = skillRepository.createStorage(p1!.id, { id: "owned-storage", name: "Owned" });
    const skill = skillRepository.createSkill(p1!.id, storage.id, {
      id: "owned-skill",
      name: "Owned skill",
      contentMarkdown: "Project-owned instructions.",
    });
    const p1Agent = agentPresetRepository.createAgentPreset(p1!.id, { id: "agent-p1", name: "P1 Agent" });
    const p2Agent = agentPresetRepository.createAgentPreset(p2!.id, { id: "agent-p2", name: "P2 Agent" });

    expect(skillRepository.getStorage(p2!.id, storage.id)).toBeNull();
    expect(skillRepository.getSkill(p2!.id, skill.id)).toBeNull();
    expect(() => skillRepository.listSkills(p2!.id, storage.id)).toThrow(/Skill storage not found/);
    expect(() => skillRepository.attachStorageToAgent(p2!.id, p2Agent.id, storage.id)).toThrow(/Skill storage not found/);
    expect(() => skillRepository.attachStorageToAgent(p1!.id, p2Agent.id, storage.id)).toThrow(/Agent preset not found/);

    const attachment = skillRepository.attachStorageToAgent(p1!.id, p1Agent.id, storage.id);
    expect(attachment).toMatchObject({ projectId: p1!.id, agentPresetId: p1Agent.id, storageId: storage.id, enabled: true });
    expect(skillRepository.listStoragesForAgent(p1!.id, p1Agent.id).map((entry) => entry.id)).toEqual([storage.id]);
  });

  it("removes skills, embeddings, and agent bindings when deleting a storage", async () => {
    const { storage, skillRepository, agentPresetRepository, projects } = await createFixture();
    const project = projects[0]!;
    const skillStorage = skillRepository.createStorage(project.id, { id: "delete-me", name: "Delete me" });
    const skill = skillRepository.createSkill(project.id, skillStorage.id, {
      id: "embedded-skill",
      name: "Embedded",
      contentMarkdown: "Embeddable content.",
    });
    skillRepository.saveEmbedding(project.id, skill.id, "test-model", 2, Buffer.from(new Float32Array([1, 0]).buffer));
    const agent = agentPresetRepository.createAgentPreset(project.id, { id: "attached-agent", name: "Attached" });
    skillRepository.attachStorageToAgent(project.id, agent.id, skillStorage.id);

    skillRepository.deleteStorage(project.id, skillStorage.id);

    const db = storage.getDatabase();
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE storage_id = ?").get(skillStorage.id)).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM skill_embeddings WHERE storage_id = ?").get(skillStorage.id)).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_skill_storage_bindings WHERE storage_id = ?").get(skillStorage.id)).toEqual({ count: 0 });
  });
});
