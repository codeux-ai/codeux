import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
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
  constructor(private loaded = true) {}

  isLoaded(): boolean {
    return this.loaded;
  }

  getLoadedModelId(): string | null {
    return this.loaded ? "fake-2d" : null;
  }

  async embed(text: string): Promise<Float32Array> {
    const lower = text.toLowerCase();
    if (lower.includes("hybrid")) {
      return new Float32Array([0.8, 0.2]);
    }
    if (lower.includes("review")) {
      return new Float32Array([1, 0]);
    }
    if (lower.includes("deploy")) {
      return new Float32Array([0, 1]);
    }
    return new Float32Array([0.4, 0.6]);
  }
}

async function createFixture(embeddingProvider: SkillEmbeddingProvider = new FakeEmbeddingProvider()): Promise<{
  storage: AppDbStorage;
  projectId: string;
  otherProjectId: string;
  skillRepository: SkillRepository;
  skillService: SkillService;
  agentPresetRepository: AgentPresetRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-skill-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const skillRepository = new SkillRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const project = projectRepository.createProject({ name: "Skill Service Project", sourceType: "local", sourceRef: "/workspace/skill-service" });
  const otherProject = projectRepository.createProject({ name: "Other Skill Service Project", sourceType: "local", sourceRef: "/workspace/skill-service-other" });
  return {
    storage,
    projectId: project.id,
    otherProjectId: otherProject.id,
    skillRepository,
    skillService: new SkillService(skillRepository, embeddingProvider),
    agentPresetRepository,
  };
}

describe("SkillService", () => {
  it("imports and renders skill markdown with frontmatter metadata", async () => {
    const { projectId, skillService } = await createFixture(new FakeEmbeddingProvider(false));
    const storage = skillService.createStorage(projectId, { id: "markdown-storage", name: "Markdown storage" });

    const skill = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Review Discipline
description: Keep review findings concrete.
tags: ["review", "quality"]
appliesTo:
  - src/services
  - tests/backend
version: 2.1.0
---

Focus on bugs, regressions, and missing tests.
`);

    expect(skill).toMatchObject({
      name: "Review Discipline",
      description: "Keep review findings concrete.",
      tags: ["review", "quality"],
      appliesTo: ["src/services", "tests/backend"],
      version: "2.1.0",
      contentMarkdown: "Focus on bugs, regressions, and missing tests.",
    });

    const rendered = skillService.renderSkillToMarkdown(projectId, skill.id);
    expect(rendered).toContain("title: Review Discipline");
    expect(rendered).toContain("description: Keep review findings concrete.");
    expect(rendered).toContain('tags: ["review", "quality"]');
    expect(rendered).toContain('appliesTo: ["src/services", "tests/backend"]');
    expect(rendered).toContain("version: 2.1.0");
    expect(rendered).toContain("Focus on bugs, regressions, and missing tests.");
  });

  it("skips embeddings when no provider is available without failing CRUD", async () => {
    const { storage, projectId, skillService } = await createFixture(new FakeEmbeddingProvider(false));
    const skillStorage = skillService.createStorage(projectId, { id: "offline-storage", name: "Offline" });
    const skill = await skillService.writeSkillFromMarkdown(projectId, skillStorage.id, `---
title: Offline Skill
---

Store this without embedding.
`);

    expect(skill.name).toBe("Offline Skill");
    expect(storage.getDatabase().prepare("SELECT COUNT(*) AS count FROM skill_embeddings WHERE skill_id = ?").get(skill.id)).toEqual({ count: 0 });
  });

  it("ranks embedded skill search deterministically and filters mismatched dimensions", async () => {
    const { projectId, skillRepository, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, { id: "search-storage", name: "Search" });
    const review = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Review Skill
tags: review
---

Review pull requests and record concrete findings.
`);
    const hybrid = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Hybrid Skill
---

Hybrid review and deploy coordination.
`);
    const deploy = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Deploy Skill
---

Deploy release builds after checks pass.
`);
    skillRepository.saveEmbedding(projectId, deploy.id, "fake-2d", 3, Buffer.from(new Float32Array([1, 0, 0]).buffer));

    const results = await skillService.search({
      projectId,
      storageId: storage.id,
      query: "review",
      limit: 5,
      minSimilarity: 0,
    });

    expect(results.map((result) => result.skill.id)).toEqual([review.id, hybrid.id]);
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
  });

  it("searches only storages attached to the requested agent", async () => {
    const { projectId, otherProjectId, agentPresetRepository, skillService } = await createFixture();
    const attachedStorage = skillService.createStorage(projectId, { id: "attached-storage", name: "Attached" });
    const detachedStorage = skillService.createStorage(projectId, { id: "detached-storage", name: "Detached" });
    const otherStorage = skillService.createStorage(otherProjectId, { id: "other-storage", name: "Other" });
    const agent = agentPresetRepository.createAgentPreset(projectId, { id: "skill-agent", name: "Skill Agent" });
    skillService.attachStorageToAgent(projectId, agent.id, attachedStorage.id);

    const attached = await skillService.writeSkillFromMarkdown(projectId, attachedStorage.id, `---
title: Attached Review
---

Review attached storage content.
`);
    await skillService.writeSkillFromMarkdown(projectId, detachedStorage.id, `---
title: Detached Review
---

Review detached storage content.
`);
    await skillService.writeSkillFromMarkdown(otherProjectId, otherStorage.id, `---
title: Other Review
---

Review another project content.
`);

    expect(skillService.listByAgent(projectId, agent.id).map((skill) => skill.id)).toEqual([attached.id]);
    const results = await skillService.search({
      projectId,
      agentPresetId: agent.id,
      query: "review",
      minSimilarity: 0,
      limit: 10,
    });
    expect(results.map((result) => result.skill.id)).toEqual([attached.id]);
  });

  it("resolves persistent skill runtime only for enabled agents with attached storage", async () => {
    const { projectId, agentPresetRepository, skillService } = await createFixture();
    const storage = skillService.createStorage(projectId, { id: "attached-storage", name: "Attached Runtime Skills" });
    const disabledAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "disabled-agent",
      name: "Disabled Agent",
      persistentSkillStorage: { enabled: false },
      persistentSkillStorageIds: [storage.id],
    });
    const enabledAgent = agentPresetRepository.createAgentPreset(projectId, {
      id: "enabled-agent",
      name: "Enabled Agent",
      persistentSkillStorage: { enabled: true },
      persistentSkillStorageIds: [storage.id],
    });

    await expect(skillService.resolvePersistentSkillStorageRuntime({
      projectId,
      agentPresetId: disabledAgent.id,
      enabled: false,
    })).resolves.toBeNull();

    const runtime = await skillService.resolvePersistentSkillStorageRuntime({
      projectId,
      agentPresetId: enabledAgent.id,
      enabled: true,
    });

    expect(runtime?.instructionMarkdown).toContain("search_skills");
    expect(runtime?.instructionMarkdown).toContain("manage_skills import_markdown");
    expect(runtime?.mounts).toHaveLength(1);
    expect(runtime?.mounts[0]).toMatchObject({
      storageId: storage.id,
      storageName: "Attached Runtime Skills",
      containerPath: "/code-ux/persistent-skills/attached-storage",
    });
    expect(runtime?.mounts[0]!.hostPath).toContain(path.join(".code-ux", "persistent-skill-storages"));
    const stats = await fs.stat(runtime!.mounts[0]!.hostPath);
    expect(stats.isDirectory()).toBe(true);
  });
});
