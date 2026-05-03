import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { MemoryRepository } from "../../../src/repositories/memory-repository.js";
import type {
  CreateMemoryInput,
  MemoryRecord,
} from "../../../src/contracts/memory-types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function createTestStorage(): AppDbStorage {
  const dir = os.tmpdir();
  const tmpDir = path.join(dir, `sprint-os-memory-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // We use mkdirSync synchronously since AppDbStorage constructor is sync
  require("fs").mkdirSync(tmpDir, { recursive: true });
  tempDirs.push(tmpDir);
  return new AppDbStorage(path.join(tmpDir, "app.db"));
}

function createTestProject(storage: AppDbStorage): string {
  const projectRepo = new ProjectManagementRepository(storage);
  const project = projectRepo.createProject({
    name: "Test Memory Project",
    sourceType: "local",
    sourceRef: "/workspace/test-project",
  });
  return project.id;
}

function createTestSprint(storage: AppDbStorage, projectId: string, name: string): string {
  const projectRepo = new ProjectManagementRepository(storage);
  const sprint = projectRepo.createSprint(projectId, { name });
  return sprint.id;
}

function makeInput(overrides: Partial<CreateMemoryInput> = {}): CreateMemoryInput {
  return {
    scope: "project",
    content: "Default test memory content",
    category: "context",
    ...overrides,
  };
}

describe("MemoryRepository", () => {
  let storage: AppDbStorage;
  let repo: MemoryRepository;
  let projectId: string;
  let sprintId1: string;
  let sprintId2: string;

  beforeEach(() => {
    storage = createTestStorage();
    // Disable FK enforcement for test flexibility with sprint/agent preset IDs
    storage.getDatabase().exec("PRAGMA foreign_keys = OFF");
    repo = new MemoryRepository(storage);
    projectId = createTestProject(storage);
    sprintId1 = createTestSprint(storage, projectId, "Sprint 1");
    sprintId2 = createTestSprint(storage, projectId, "Sprint 2");
  });

  describe("createMemory", () => {
    it("creates a memory and returns the full record", () => {
      const result = repo.createMemory(projectId, makeInput({
        content: "Architecture uses hexagonal pattern",
        category: "architecture",
        scope: "project",
        strength: 0.8,
        source: { type: "manual" },
      }));

      expect(result).toMatchObject({
        projectId,
        scope: "project",
        content: "Architecture uses hexagonal pattern",
        category: "architecture",
        strength: 0.8,
        source: { type: "manual" },
        sprintId: null,
        agentPresetId: null,
        promotedFromId: null,
        promotionReason: null,
        embeddingModel: null,
        embeddingDimension: null,
        embeddingBlob: null,
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result).toEqual(repo.getMemory(result.id));
    });

    it("trims content whitespace", () => {
      const result = repo.createMemory(projectId, makeInput({
        content: "  padded content  ",
      }));
      expect(result.content).toBe("padded content");
    });

    it("defaults strength to 0.5 when not specified", () => {
      const result = repo.createMemory(projectId, makeInput());
      expect(result.strength).toBe(0.5);
    });

    it("defaults source to manual when not specified", () => {
      const result = repo.createMemory(projectId, makeInput());
      expect(result.source).toEqual({ type: "manual" });
    });

    it("throws when project does not exist", () => {
      expect(() => repo.createMemory("nonexistent-id", makeInput())).toThrow("Project not found");
    });

    it("stores sprint and agent preset IDs", () => {
      const result = repo.createMemory(projectId, makeInput({
        scope: "sprint",
        sprintId: "sprint-1",
        agentPresetId: "agent-1",
      }));
      expect(result.sprintId).toBe("sprint-1");
      expect(result.agentPresetId).toBe("agent-1");
      expect(result.scope).toBe("sprint");
    });
  });

  describe("createMemories", () => {
    it("creates multiple memories in a single transaction and returns the records", () => {
      const inputs = [
        makeInput({ content: "mem 1", category: "architecture", strength: 0.8 }),
        makeInput({ content: "mem 2", category: "codebase", strength: 0.9 })
      ];

      const results = repo.createMemories(projectId, inputs);

      expect(results).toHaveLength(2);

      expect(results[0]).toMatchObject({
        projectId,
        content: "mem 1",
        category: "architecture",
        strength: 0.8,
      });

      expect(results[1]).toMatchObject({
        projectId,
        content: "mem 2",
        category: "codebase",
        strength: 0.9,
      });

      // Verify they are actually inserted in DB
      const loaded0 = repo.getMemory(results[0].id);
      const loaded1 = repo.getMemory(results[1].id);
      expect(loaded0).toEqual(results[0]);
      expect(loaded1).toEqual(results[1]);
    });

    it("returns an empty array if inputs is empty", () => {
      const results = repo.createMemories(projectId, []);
      expect(results).toEqual([]);
    });

    it("honors projectId validation", () => {
      expect(() => {
        repo.createMemories("non-existent-project", [makeInput()]);
      }).toThrow(/Project/);
    });
  });


  describe("getMemory", () => {
    it("retrieves a memory by ID", () => {
      const created = repo.createMemory(projectId, makeInput({ content: "Findable" }));
      const found = repo.getMemory(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe("Findable");
    });

    it("returns null for a nonexistent ID", () => {
      expect(repo.getMemory("no-such-id")).toBeNull();
    });
  });

  describe("getMemories", () => {
    it("returns empty array for empty input", () => {
      expect(repo.getMemories([])).toEqual([]);
    });

    it("returns items in the requested order and drops missing ids", () => {
      const mem1 = repo.createMemory(projectId, makeInput({ content: "First" }));
      const mem2 = repo.createMemory(projectId, makeInput({ content: "Second" }));
      const mem3 = repo.createMemory(projectId, makeInput({ content: "Third" }));

      const ids = [mem3.id, randomUUID(), mem1.id, mem3.id, mem2.id];
      const results = repo.getMemories(ids);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(mem3);
      expect(results[1]).toEqual(mem1);
      expect(results[2]).toEqual(mem3);
      expect(results[3]).toEqual(mem2);
    });
  });

  describe("updateMemory", () => {
    it("updates content", () => {
      const created = repo.createMemory(projectId, makeInput({ content: "Original" }));
      const updated = repo.updateMemory(created.id, { content: "  Updated  " });
      expect(updated.content).toBe("Updated");
      expect(updated).toEqual(repo.getMemory(updated.id));
    });

    it("updates category", () => {
      const created = repo.createMemory(projectId, makeInput({ category: "context" }));
      const updated = repo.updateMemory(created.id, { category: "error" });
      expect(updated.category).toBe("error");
    });

    it("updates strength", () => {
      const created = repo.createMemory(projectId, makeInput({ strength: 0.3 }));
      const updated = repo.updateMemory(created.id, { strength: 0.9 });
      expect(updated.strength).toBe(0.9);
    });

    it("preserves fields not included in update", () => {
      const created = repo.createMemory(projectId, makeInput({
        content: "Keep me",
        category: "architecture",
        strength: 0.7,
      }));
      const updated = repo.updateMemory(created.id, { strength: 0.1 });
      expect(updated.content).toBe("Keep me");
      expect(updated.category).toBe("architecture");
      expect(updated.strength).toBe(0.1);
    });

    it("advances updatedAt timestamp", () => {
      const created = repo.createMemory(projectId, makeInput());
      const updated = repo.updateMemory(created.id, { content: "Changed" });
      expect(updated.updatedAt >= created.updatedAt).toBe(true);
    });

    it("throws for a nonexistent memory", () => {
      expect(() => repo.updateMemory("missing", { content: "x" })).toThrow("Memory not found");
    });
  });

  describe("deleteMemory", () => {
    it("removes the memory so getMemory returns null", () => {
      const created = repo.createMemory(projectId, makeInput());
      repo.deleteMemory(created.id);
      expect(repo.getMemory(created.id)).toBeNull();
    });

    it("does not throw when deleting a nonexistent memory", () => {
      expect(() => repo.deleteMemory("no-such-id")).not.toThrow();
    });
  });

  describe("listByProject", () => {
    it("lists all memories for a project", () => {
      repo.createMemory(projectId, makeInput({ content: "A", scope: "project" }));
      repo.createMemory(projectId, makeInput({ content: "B", scope: "sprint", sprintId: "s1" }));
      repo.createMemory(projectId, makeInput({ content: "C", scope: "agent", agentPresetId: "a1" }));

      const all = repo.listByProject(projectId);
      expect(all).toHaveLength(3);
    });

    it("filters by scope when provided", () => {
      repo.createMemory(projectId, makeInput({ scope: "project", content: "proj" }));
      repo.createMemory(projectId, makeInput({ scope: "sprint", content: "spr", sprintId: "s1" }));

      const projectOnly = repo.listByProject(projectId, "project");
      expect(projectOnly).toHaveLength(1);
      expect(projectOnly[0]!.scope).toBe("project");
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        repo.createMemory(projectId, makeInput({ content: `Item ${i}` }));
      }
      const limited = repo.listByProject(projectId, undefined, 3);
      expect(limited).toHaveLength(3);
    });

    it("returns empty array for a project with no memories", () => {
      expect(repo.listByProject(projectId)).toEqual([]);
    });
  });

  describe("listBySprint", () => {
    it("returns memories matching projectId and sprintId", () => {
      repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s1", content: "sprint-1 mem" }));
      repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s2", content: "sprint-2 mem" }));

      const results = repo.listBySprint(projectId, "s1");
      expect(results).toHaveLength(1);
      expect(results[0]!.sprintId).toBe("s1");
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s1", content: `Mem ${i}` }));
      }
      expect(repo.listBySprint(projectId, "s1", 2)).toHaveLength(2);
    });
  });

  describe("listByAgent", () => {
    it("returns memories matching projectId and agentPresetId", () => {
      repo.createMemory(projectId, makeInput({ scope: "agent", agentPresetId: "agent-a", content: "for A" }));
      repo.createMemory(projectId, makeInput({ scope: "agent", agentPresetId: "agent-b", content: "for B" }));

      const results = repo.listByAgent(projectId, "agent-a");
      expect(results).toHaveLength(1);
      expect(results[0]!.agentPresetId).toBe("agent-a");
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        repo.createMemory(projectId, makeInput({ scope: "agent", agentPresetId: "agent-x", content: `M ${i}` }));
      }
      expect(repo.listByAgent(projectId, "agent-x", 3)).toHaveLength(3);
    });
  });

  describe("saveEmbedding / loadEmbeddingsForScope", () => {
    it("saves an embedding and loads it back", () => {
      const mem = repo.createMemory(projectId, makeInput({ scope: "project" }));
      const blob = Buffer.from([1, 2, 3, 4]);
      repo.saveEmbedding(mem.id, "bge-small-en-v1.5", 384, blob);

      const loaded = repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5");
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe(mem.id);
      expect(loaded[0]!.embeddingDimension).toBe(384);
      expect(Buffer.from(loaded[0]!.embeddingBlob)).toEqual(blob);
    });

    it("filters by scope", () => {
      const projMem = repo.createMemory(projectId, makeInput({ scope: "project" }));
      const sprintMem = repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s1" }));
      const blob = Buffer.from([5, 6]);

      repo.saveEmbedding(projMem.id, "bge-small-en-v1.5", 384, blob);
      repo.saveEmbedding(sprintMem.id, "bge-small-en-v1.5", 384, blob);

      const projectOnly = repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5", "project");
      expect(projectOnly).toHaveLength(1);
      expect(projectOnly[0]!.id).toBe(projMem.id);
    });

    it("filters by sprintId", () => {
      const m1 = repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s1" }));
      const m2 = repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s2" }));
      const blob = Buffer.from([9]);

      repo.saveEmbedding(m1.id, "bge-small-en-v1.5", 384, blob);
      repo.saveEmbedding(m2.id, "bge-small-en-v1.5", 384, blob);

      const results = repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5", undefined, "s1");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(m1.id);
    });

    it("filters by agentPresetId", () => {
      const m1 = repo.createMemory(projectId, makeInput({ scope: "agent", agentPresetId: "a1" }));
      const m2 = repo.createMemory(projectId, makeInput({ scope: "agent", agentPresetId: "a2" }));
      const blob = Buffer.from([7]);

      repo.saveEmbedding(m1.id, "bge-small-en-v1.5", 384, blob);
      repo.saveEmbedding(m2.id, "bge-small-en-v1.5", 384, blob);

      const results = repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5", undefined, undefined, "a1");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(m1.id);
    });

    it("returns empty when no embeddings exist", () => {
      repo.createMemory(projectId, makeInput());
      expect(repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5")).toEqual([]);
    });
  });

  describe("clearEmbeddingsForModel", () => {
    it("clears embeddings matching model and project", () => {
      const m1 = repo.createMemory(projectId, makeInput());
      const m2 = repo.createMemory(projectId, makeInput({ content: "Other" }));
      const blob = Buffer.from([1]);

      repo.saveEmbedding(m1.id, "bge-small-en-v1.5", 384, blob);
      repo.saveEmbedding(m2.id, "bge-small-en-v1.5", 384, blob);

      repo.clearEmbeddingsForModel(projectId, "bge-small-en-v1.5");

      const loaded = repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5");
      expect(loaded).toHaveLength(0);

      // Memories still exist
      expect(repo.getMemory(m1.id)).not.toBeNull();
      expect(repo.getMemory(m2.id)).not.toBeNull();
    });

    it("does not clear embeddings for a different model", () => {
      const mem = repo.createMemory(projectId, makeInput());
      const blob = Buffer.from([1]);
      repo.saveEmbedding(mem.id, "bge-small-en-v1.5", 384, blob);

      repo.clearEmbeddingsForModel(projectId, "multilingual-e5-large");

      const loaded = repo.loadEmbeddingsForScope(projectId, "bge-small-en-v1.5");
      expect(loaded).toHaveLength(1);
    });
  });

  describe("countByScope", () => {
    it("returns count of memories for a given scope", () => {
      repo.createMemory(projectId, makeInput({ scope: "project" }));
      repo.createMemory(projectId, makeInput({ scope: "project" }));
      repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s1" }));

      expect(repo.countByScope(projectId, "project")).toBe(2);
      expect(repo.countByScope(projectId, "sprint")).toBe(1);
      expect(repo.countByScope(projectId, "agent")).toBe(0);
    });
  });

  describe("createPromotedMemory", () => {
    it("creates a project-scoped memory linked to the original", () => {
      const original = repo.createMemory(projectId, makeInput({
        scope: "sprint",
        sprintId: "s1",
        agentPresetId: "agent-1",
        content: "Learned something useful",
        category: "learning",
        strength: 0.6,
      }));

      const promoted = repo.createPromotedMemory(projectId, original, "Recurring pattern across sprints");

      expect(promoted.scope).toBe("project");
      expect(promoted.sprintId).toBeNull();
      expect(promoted.agentPresetId).toBe("agent-1");
      expect(promoted.content).toBe("Learned something useful");
      expect(promoted.category).toBe("learning");
      expect(promoted.strength).toBe(0.7); // 0.6 + 0.1
      expect(promoted.promotedFromId).toBe(original.id);
      expect(promoted.promotionReason).toBe("Recurring pattern across sprints");
      expect(promoted.source).toEqual({
        type: "promotion",
        originType: "memory",
        originId: original.id,
      });
      expect(promoted).toEqual(repo.getMemory(promoted.id));
    });

    it("caps strength at 1.0", () => {
      const original = repo.createMemory(projectId, makeInput({
        scope: "sprint",
        sprintId: "s1",
        strength: 0.95,
      }));

      const promoted = repo.createPromotedMemory(projectId, original, "Strong signal");
      expect(promoted.strength).toBe(1);
    });
  });

  describe("deleteSprintMemories", () => {
    it("deletes sprint-scoped memories for a specific sprint", () => {
      repo.createMemory(projectId, makeInput({ scope: "sprint", sprintId: "s1", content: "sprint mem" }));
      repo.createMemory(projectId, makeInput({ scope: "project", content: "project mem" }));

      repo.deleteSprintMemories(projectId, "s1");

      expect(repo.listBySprint(projectId, "s1")).toHaveLength(0);
      expect(repo.listByProject(projectId, "project")).toHaveLength(1);
    });
  });

  describe("upsertModelStatus", () => {
    it("inserts a new model status", () => {
      repo.upsertModelStatus("bge-small-en-v1.5", { downloaded: true, localPath: "/models/bge" });

      const status = repo.getModelStatus("bge-small-en-v1.5");
      expect(status).not.toBeNull();
      expect(status!.id).toBe("bge-small-en-v1.5");
      expect(status!.downloaded).toBe(true);
      expect(status!.downloading).toBe(false);
      expect(status!.localPath).toBe("/models/bge");
      expect(status!.error).toBeNull();
    });

    it("updates an existing model status", () => {
      repo.upsertModelStatus("bge-small-en-v1.5", { downloading: true, downloadProgress: 50 });
      repo.upsertModelStatus("bge-small-en-v1.5", { downloaded: true, downloadProgress: 100, localPath: "/m/bge" });

      const status = repo.getModelStatus("bge-small-en-v1.5");
      expect(status!.downloaded).toBe(true);
      expect(status!.downloading).toBe(false);
      expect(status!.downloadProgress).toBe(100);
      expect(status!.localPath).toBe("/m/bge");
    });

    it("records error message", () => {
      repo.upsertModelStatus("bge-small-en-v1.5", { error: "Download failed" });

      const status = repo.getModelStatus("bge-small-en-v1.5");
      expect(status!.error).toBe("Download failed");
      expect(status!.downloaded).toBe(false);
    });
  });

  describe("getModelStatus", () => {
    it("returns null for unknown model", () => {
      expect(repo.getModelStatus("bge-small-en-v1.5")).toBeNull();
    });
  });

  describe("listModelStatuses", () => {
    it("returns all model statuses ordered by id", () => {
      repo.upsertModelStatus("bge-small-en-v1.5", { downloaded: true, localPath: "/a" });
      repo.upsertModelStatus("multilingual-e5-large", { downloading: true, downloadProgress: 25 });

      const statuses = repo.listModelStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses[0]!.id).toBe("bge-small-en-v1.5");
      expect(statuses[1]!.id).toBe("multilingual-e5-large");
    });

    it("returns empty array when no models tracked", () => {
      expect(repo.listModelStatuses()).toEqual([]);
    });
  });
});
