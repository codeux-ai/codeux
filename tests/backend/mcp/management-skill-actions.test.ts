import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SkillActions } from "../../../src/mcp/management/skill-actions.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SkillRepository } from "../../../src/repositories/skill-repository.js";
import { SkillService, type SkillEmbeddingProvider } from "../../../src/services/skill-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

class FakeEmbeddingProvider implements SkillEmbeddingProvider {
  isLoaded(): boolean {
    return true;
  }

  getLoadedModelId(): string | null {
    return "fake-2d";
  }

  async embed(text: string): Promise<Float32Array> {
    const lower = text.toLowerCase();
    if (lower.includes("review")) {
      return new Float32Array([1, 0]);
    }
    if (lower.includes("deploy")) {
      return new Float32Array([0, 1]);
    }
    return new Float32Array([0.5, 0.5]);
  }
}

async function createFixture(): Promise<{
  projectId: string;
  otherProjectId: string;
  agentPresetId: string;
  actions: SkillActions;
  skillService: SkillService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-management-skills-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const skillRepository = new SkillRepository(storage);
  const skillService = new SkillService(skillRepository, new FakeEmbeddingProvider());
  const project = projectRepository.createProject({ name: "Skill MCP Project", sourceType: "local", sourceRef: "/workspace/skill-mcp" });
  const otherProject = projectRepository.createProject({ name: "Other Skill MCP Project", sourceType: "local", sourceRef: "/workspace/skill-mcp-other" });
  const agent = agentPresetRepository.createAgentPreset(project.id, { id: "review-agent", name: "Review Agent" });
  return {
    projectId: project.id,
    otherProjectId: otherProject.id,
    agentPresetId: agent.id,
    actions: new SkillActions(skillService),
    skillService,
  };
}

describe("SkillActions", () => {
  it("returns the authoring prompt with persistent storage instructions", async () => {
    const { actions } = await createFixture();
    const response = await actions.handleSkillAction({ domain: "skills", action: "authoring_prompt", payload: {} });
    const prompt = (response.result as { prompt: string }).prompt;

    expect(prompt).toContain("Frontmatter fields");
    expect(prompt).toContain("manage_skills import_markdown");
    expect(prompt).toContain("Do not write skill files into the project workspace");
  });

  it("rejects validation failures before calling storage actions", async () => {
    const { actions, projectId } = await createFixture();

    await expect(actions.handleSkillAction({
      domain: "skills",
      action: "create_storage",
      payload: { projectId, name: "Bad", storageKind: "remote" },
    })).rejects.toThrow("Invalid value for storageKind");

    await expect(actions.handleSkillAction({
      domain: "skills",
      action: "list_skills",
      payload: { storageId: "missing-project" },
    })).rejects.toThrow("projectId is required");
  });

  it("creates, updates, exports, and searches skills with concise retrieval results", async () => {
    const { actions, projectId } = await createFixture();
    const storageResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "create_storage",
      payload: { projectId, name: "Review Skills", description: "Reusable review guidance" },
    });
    const storageId = ((storageResponse.result as { storage: { id: string } }).storage.id);
    const getStorageResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "get_storage",
      payload: { projectId, storageId },
    });
    expect((getStorageResponse.result as { storage: { name: string } }).storage.name).toBe("Review Skills");

    const createResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "create_skill",
      payload: {
        projectId,
        storageId,
        markdown: `---
title: Review Discipline
description: Find concrete regressions.
tags: ["review"]
---

Review pull requests for bugs, regressions, and missing tests.
`,
      },
    });
    const skillId = ((createResponse.result as { skill: { id: string } }).skill.id);

    const updateResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "update_skill",
      payload: {
        projectId,
        storageId,
        skillId,
        markdown: `---
title: Review Discipline
description: Find concrete regressions.
tags: ["review", "quality"]
version: 1.1.0
---

Review pull requests for bugs, regressions, missing tests, and unclear rollback paths.
`,
      },
    });
    expect((updateResponse.result as { skill: { version: string } }).skill.version).toBe("1.1.0");

    const exportResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "export_markdown",
      payload: { projectId, skillId },
    });
    expect((exportResponse.result as { markdown: string }).markdown).toContain("title: Review Discipline");

    const searchResponse = await actions.handleSearchSkills({
      projectId,
      storageId,
      query: "review",
      minSimilarity: 0,
      limit: 5,
    });
    const results = (searchResponse.result as { results: Array<{ skill: Record<string, unknown> }> }).results;
    expect(results).toHaveLength(1);
    expect(results[0]!.skill.id).toBe(skillId);
    expect(results[0]!.skill).not.toHaveProperty("contentMarkdown");
    expect(results[0]!.skill.summary).toContain("Review pull requests");
  });

  it("enforces project isolation through the skill service boundary", async () => {
    const { actions, projectId, otherProjectId, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, { id: "owned-storage", name: "Owned" });
    await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Owned Skill
---

Review owned project content.
`);

    await expect(actions.handleSkillAction({
      domain: "skills",
      action: "list_skills",
      payload: { projectId: otherProjectId, storageId: storage.id },
    })).rejects.toThrow("Skill storage not found");
  });

  it("requires approval for delete and reset flows before mutating", async () => {
    const { actions, projectId, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, { id: "reset-storage", name: "Reset" });
    const skill = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Delete Me
---

Delete this skill.
`);

    const deletePrompt = await actions.handleSkillAction({
      domain: "skills",
      action: "delete_skill",
      payload: { projectId, skillId: skill.id },
    });
    expect(deletePrompt.approvalRequired).toBe(true);
    expect(skillService.getSkill(projectId, skill.id)).not.toBeNull();

    await actions.handleSkillAction({
      domain: "skills",
      action: "delete_skill",
      payload: { projectId, skillId: skill.id },
      approval: { confirmed: true },
    });
    expect(skillService.getSkill(projectId, skill.id)).toBeNull();

    await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Reset Me
---

Reset this skill.
`);
    const resetPrompt = await actions.handleSkillAction({
      domain: "skills",
      action: "reset_storage",
      payload: { projectId, storageId: storage.id },
    });
    expect(resetPrompt.approvalRequired).toBe(true);
    expect(skillService.listByStorage(projectId, storage.id)).toHaveLength(1);

    const resetResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "reset_storage",
      payload: { projectId, storageId: storage.id },
      approval: { confirmed: true },
    });
    expect(resetResponse.result).toEqual({ success: true, deletedSkills: 1 });
    expect(skillService.listByStorage(projectId, storage.id)).toEqual([]);
  });

  it("manages agent storage attachments and searches only attached storages", async () => {
    const { actions, projectId, agentPresetId, skillService } = await createFixture();
    const attached = skillService.createStorage(projectId, { id: "attached", name: "Attached" });
    const detached = skillService.createStorage(projectId, { id: "detached", name: "Detached" });
    const attachedSkill = await skillService.writeSkillFromMarkdown(projectId, attached.id, `---
title: Attached Review
---

Review attached content.
`);
    await skillService.writeSkillFromMarkdown(projectId, detached.id, `---
title: Detached Review
---

Review detached content.
`);

    await actions.handleSkillAction({
      domain: "skills",
      action: "attach_storage",
      payload: { projectId, agentPresetId, storageId: attached.id },
    });

    const listResponse = await actions.handleSkillAction({
      domain: "skills",
      action: "list_agent_storages",
      payload: { projectId, agentPresetId },
    });
    expect((listResponse.result as { storages: Array<{ id: string }> }).storages.map((storage) => storage.id)).toEqual([attached.id]);

    const searchResponse = await actions.handleSearchSkills({
      projectId,
      agentPresetId,
      query: "review",
      minSimilarity: 0,
      limit: 10,
    });
    const resultIds = (searchResponse.result as { results: Array<{ skill: { id: string } }> }).results.map((result) => result.skill.id);
    expect(resultIds).toEqual([attachedSkill.id]);

    await actions.handleSkillAction({
      domain: "skills",
      action: "detach_storage",
      payload: { projectId, agentPresetId, storageId: attached.id },
    });
    expect(skillService.listByAgent(projectId, agentPresetId)).toEqual([]);
  });
});
