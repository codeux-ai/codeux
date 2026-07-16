import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SkillRepository } from "../../../src/repositories/skill-repository.js";
import { SkillService, type SkillEmbeddingProvider } from "../../../src/services/skill-service.js";
import {
  ContainerizedSkillStorageGitRunner,
  type SkillStorageGitRunner,
  SkillStorageVersionControlService,
} from "../../../src/services/skill-storage-version-control-service.js";
import { FakeSkillStorageGitRunner } from "../helpers/fake-skill-storage-git-runner.js";
import { commandRunner } from "../../../src/services/cli-process-runner.js";
import type { SkillRecord, SkillStorageRecord } from "../../../src/contracts/skill-types.js";

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
    skillService: new SkillService(
      skillRepository,
      embeddingProvider,
      undefined,
      new SkillStorageVersionControlService(path.join(dir, "skill-storages"), new FakeSkillStorageGitRunner()),
    ),
    agentPresetRepository,
  };
}

describe("SkillService", () => {
  it("forces skill history operations through containerized Git even when host mode is configured", async () => {
    const runStrict = vi.spyOn(commandRunner, "runStrict").mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    });
    const previous = process.env.CODE_UX_GIT_CONTAINER_MODE;
    process.env.CODE_UX_GIT_CONTAINER_MODE = "host";
    try {
      await new ContainerizedSkillStorageGitRunner().run(["status", "--porcelain"], "/tmp/skill-repo");
      expect(runStrict).toHaveBeenCalledWith("git", ["status", "--porcelain"], expect.objectContaining({
        cwd: "/tmp/skill-repo",
        env: expect.objectContaining({ CODE_UX_CONTAINERIZED_GIT: "1" }),
      }));
      const options = runStrict.mock.calls[0]![2]!;
      expect(options.env?.CODE_UX_GIT_CONTAINER_MODE).toBeUndefined();
    } finally {
      runStrict.mockRestore();
      if (previous === undefined) delete process.env.CODE_UX_GIT_CONTAINER_MODE;
      else process.env.CODE_UX_GIT_CONTAINER_MODE = previous;
    }
  });

  it("reuses an unchanged materialized skill snapshot without launching Git again", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-skill-snapshot-cache-"));
    tempDirs.push(dir);
    const gitRunner = new FakeSkillStorageGitRunner();
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(() => release);
    const service = new SkillStorageVersionControlService(path.join(dir, "skill-storages"), gitRunner, acquire);
    const storage: SkillStorageRecord = {
      id: "storage-1",
      projectId: "project-1",
      name: "Runtime skills",
      description: "Reusable runtime guidance.",
      storageKind: "project",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const skill: SkillRecord = {
      id: "skill-1",
      projectId: "project-1",
      storageId: storage.id,
      name: "Fast startup",
      description: "Avoid repeated runtime work.",
      contentMarkdown: "Reuse the materialized snapshot.",
      sourceType: "manual",
      sourceRef: null,
      contentHash: "hash-1",
      tags: ["performance"],
      appliesTo: ["runtime"],
      version: "1.0.0",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };

    const first = await service.synchronize(storage.projectId, storage, [skill]);
    const gitCallCount = gitRunner.calls.length;
    const second = await service.synchronize(storage.projectId, storage, [skill]);

    expect(second).toEqual(first);
    expect(gitRunner.calls).toHaveLength(gitCallCount);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("repairs a tampered index before reusing an otherwise unchanged snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-skill-snapshot-index-"));
    tempDirs.push(dir);
    const gitRunner = new FakeSkillStorageGitRunner();
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(() => release);
    const service = new SkillStorageVersionControlService(path.join(dir, "skill-storages"), gitRunner, acquire);
    const storage: SkillStorageRecord = {
      id: "storage-1",
      projectId: "project-1",
      name: "Runtime skills",
      description: "Reusable runtime guidance.",
      storageKind: "project",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const repositoryPath = service.getRepositoryPath(storage.projectId, storage.id);

    const first = await service.synchronize(storage.projectId, storage, []);
    await fs.writeFile(path.join(repositoryPath, ".git", "index"), "staged-but-uncommitted");
    const callsBeforeRepair = gitRunner.calls.length;

    await expect(service.synchronize(storage.projectId, storage, [])).resolves.toEqual(first);
    expect(gitRunner.calls.slice(callsBeforeRepair).map((call) => call.args[0])).toEqual([
      "add",
      "status",
      "rev-parse",
    ]);
    expect(gitRunner.calls.filter((call) => call.args[0] === "commit")).toHaveLength(1);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);

    const callsAfterRepair = gitRunner.calls.length;
    await expect(service.synchronize(storage.projectId, storage, [])).resolves.toEqual(first);
    expect(gitRunner.calls).toHaveLength(callsAfterRepair);
  });

  it("recovers staged materialization after a crash instead of adopting the stale HEAD", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-skill-snapshot-crash-"));
    tempDirs.push(dir);
    const gitRunner = new FakeSkillStorageGitRunner();
    const acquire = vi.fn(() => vi.fn(async () => undefined));
    const storage: SkillStorageRecord = {
      id: "storage-1",
      projectId: "project-1",
      name: "Runtime skills",
      description: "Reusable runtime guidance.",
      storageKind: "project",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const originalSkill: SkillRecord = {
      id: "skill-1",
      projectId: storage.projectId,
      storageId: storage.id,
      name: "Crash recovery",
      description: "Keep committed provenance accurate.",
      contentMarkdown: "Original committed content.",
      sourceType: "manual",
      sourceRef: null,
      contentHash: "hash-1",
      tags: ["reliability"],
      appliesTo: ["runtime"],
      version: "1.0.0",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const repositoriesRoot = path.join(dir, "skill-storages");
    const initialService = new SkillStorageVersionControlService(repositoriesRoot, gitRunner, acquire);
    const first = await initialService.synchronize(storage.projectId, storage, [originalSkill]);
    const updatedSkill: SkillRecord = {
      ...originalSkill,
      contentMarkdown: "Materialized and staged before the process crashed.",
      contentHash: "hash-2",
      updatedAt: "2026-07-16T01:00:00.000Z",
    };
    let interruptNextAdd = true;
    const interruptedRunner: SkillStorageGitRunner = {
      run: async (args, cwd) => {
        const result = await gitRunner.run(args, cwd);
        if (interruptNextAdd && args[0] === "add") {
          interruptNextAdd = false;
          throw new Error("simulated crash after git add");
        }
        return result;
      },
    };
    const interruptedService = new SkillStorageVersionControlService(repositoriesRoot, interruptedRunner, acquire);

    await expect(interruptedService.synchronize(storage.projectId, storage, [updatedSkill]))
      .rejects.toThrow("simulated crash after git add");

    const recoveryService = new SkillStorageVersionControlService(repositoriesRoot, gitRunner, acquire);
    const recovered = await recoveryService.synchronize(storage.projectId, storage, [updatedSkill]);
    expect(recovered.revision).not.toBe(first.revision);
    expect(gitRunner.calls.filter((call) => call.args[0] === "commit")).toHaveLength(2);
    await expect(fs.readFile(path.join(recovered.repositoryPath, ".git", "code-ux-storage-snapshot.json"), "utf8"))
      .resolves.toContain(recovered.revision);
  });

  it("adopts an unchanged markerless snapshot only after a guarded Git cleanliness check", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-skill-snapshot-adopt-"));
    tempDirs.push(dir);
    const revision = "a".repeat(40);
    const calls: string[][] = [];
    const gitRunner: SkillStorageGitRunner = {
      run: async (args, cwd) => {
        calls.push([...args]);
        if (args[0] === "add") {
          await fs.writeFile(path.join(cwd, ".git", "index"), "verified-clean-index");
        }
        return {
          stdout: args[0] === "rev-parse" ? revision : "",
          stderr: "",
        };
      },
    };
    const acquire = vi.fn(() => vi.fn(async () => undefined));
    const service = new SkillStorageVersionControlService(path.join(dir, "skill-storages"), gitRunner, acquire);
    const storage: SkillStorageRecord = {
      id: "storage-1",
      projectId: "project-1",
      name: "Runtime skills",
      description: "Reusable runtime guidance.",
      storageKind: "project",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const repositoryPath = service.getRepositoryPath(storage.projectId, storage.id);
    await fs.mkdir(path.join(repositoryPath, ".git", "refs", "heads"), { recursive: true });
    await fs.mkdir(path.join(repositoryPath, "skills"), { recursive: true });
    await fs.writeFile(path.join(repositoryPath, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.writeFile(path.join(repositoryPath, ".git", "refs", "heads", "main"), `${revision}\n`);
    await fs.writeFile(path.join(repositoryPath, "storage.json"), `${JSON.stringify({
      schemaVersion: 1,
      id: storage.id,
      projectId: storage.projectId,
      name: storage.name,
      description: storage.description,
      storageKind: storage.storageKind,
      skillCount: 0,
    }, null, 2)}\n`);

    await expect(service.synchronize(storage.projectId, storage, [])).resolves.toEqual({
      repositoryPath,
      revision,
    });
    expect(calls.map((args) => args[0])).toEqual(["add", "status", "rev-parse"]);
    expect(acquire).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(path.join(repositoryPath, ".git", "code-ux-storage-snapshot.json"), "utf8"))
      .resolves.toContain(revision);

    const callsAfterAdoption = calls.length;
    await expect(service.synchronize(storage.projectId, storage, [])).resolves.toEqual({
      repositoryPath,
      revision,
    });
    expect(calls).toHaveLength(callsAfterAdoption);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

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
    await expect(skillService.search({
      projectId,
      storageId: skillStorage.id,
      query: "offline embedding",
    })).resolves.toEqual([expect.objectContaining({
      skill: expect.objectContaining({ id: skill.id }),
      similarity: expect.any(Number),
    })]);
  });

  it("indexes a compact descriptor plus bounded body chunks", async () => {
    const { storage, projectId, skillService } = await createFixture();
    const skillStorage = skillService.createStorage(projectId, { id: "chunk-storage", name: "Chunked" });
    const skill = await skillService.writeSkillFromMarkdown(projectId, skillStorage.id, `---
title: Deployment Runbook
description: Release and rollback workflows.
tags: [release, operations]
---

## Validate

${"Validate the release artifact and audit result. ".repeat(60)}

## Roll back

${"Restore the previous deployment and verify service health. ".repeat(60)}
`);

    const rows = storage.getDatabase().prepare(`
      SELECT chunk_index
      FROM skill_embeddings
      WHERE skill_id = ?
      ORDER BY chunk_index
    `).all(skill.id) as Array<{ chunk_index: number }>;
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]?.chunk_index).toBe(0);
    expect(rows.map((row) => row.chunk_index)).toEqual(rows.map((_, index) => index));
  });

  it("preserves imported skill provenance when updating markdown without overrides", async () => {
    const { projectId, skillService } = await createFixture(new FakeEmbeddingProvider(false));
    const storage = skillService.createStorage(projectId, { id: "provenance-storage", name: "Provenance" });
    const skill = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Imported Skill
---

Original imported instructions.
`, {
      sourceType: "imported",
      sourceRef: "external://skills/imported-skill.md",
    });

    const updated = await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Imported Skill
version: 1.1.0
---

Updated imported instructions.
`, { skillId: skill.id });

    expect(updated).toMatchObject({
      id: skill.id,
      storageId: storage.id,
      sourceType: "imported",
      sourceRef: "external://skills/imported-skill.md",
      version: "1.1.0",
      contentMarkdown: "Updated imported instructions.",
    });
  });

  it("rejects updating a skill through a mismatched storage id", async () => {
    const { projectId, skillService } = await createFixture(new FakeEmbeddingProvider(false));
    const originalStorage = skillService.createStorage(projectId, { id: "original-storage", name: "Original" });
    const otherStorage = skillService.createStorage(projectId, { id: "other-storage", name: "Other" });
    const skill = await skillService.writeSkillFromMarkdown(projectId, originalStorage.id, `---
title: Stored Skill
---

Keep this in the original storage.
`);

    await expect(skillService.writeSkillFromMarkdown(projectId, otherStorage.id, `---
title: Stored Skill
---

Attempt to update through a different storage.
`, { skillId: skill.id })).rejects.toThrow("moving skills between storages is not supported");

    expect(skillService.getSkill(projectId, skill.id)).toMatchObject({
      storageId: originalStorage.id,
      contentMarkdown: "Keep this in the original storage.",
    });
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
    await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Release Checklist
description: Verify release readiness and publish safely.
version: 1.4.0
---

Run the release checks.`);
    await skillService.writeSkillFromMarkdown(projectId, storage.id, `---
title: Incident Triage
description: Triage an incident with a safe escalation path.
---

Assess impact and collect evidence.`);

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
    expect(runtime?.instructionMarkdown).toContain("manage_skills");
    expect(runtime?.mounts).toHaveLength(1);
    expect(runtime?.mounts[0]).toMatchObject({
      storageId: storage.id,
      storageName: "Attached Runtime Skills",
      containerPath: "/code-ux/persistent-skills/attached-storage",
      skills: [
        { name: "Incident Triage", description: "Triage an incident with a safe escalation path.", version: null },
        { name: "Release Checklist", description: "Verify release readiness and publish safely.", version: "1.4.0" },
      ],
    });
    expect(runtime?.instructionMarkdown).toContain("## AVAILABLE PERSISTENT SKILLS");
    expect(runtime?.instructionMarkdown).toContain("**Release Checklist** (v1.4.0): Verify release readiness and publish safely.");
    expect(runtime?.instructionMarkdown).toContain("**Incident Triage**: Triage an incident with a safe escalation path.");
    expect(runtime?.mounts[0]!.hostPath).toContain(path.join("skill-storages", projectId, storage.id, "repo"));
    expect(runtime?.mounts[0]!.revision).toMatch(/^[0-9a-f]{40}$/);
    const stats = await fs.stat(runtime!.mounts[0]!.hostPath);
    expect(stats.isDirectory()).toBe(true);
  });
});
