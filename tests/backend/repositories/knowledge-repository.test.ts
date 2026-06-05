import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { KnowledgeRepository } from "../../../src/repositories/knowledge-repository.js";

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

let storage: AppDbStorage;
let projects: ProjectManagementRepository;
let agents: AgentPresetRepository;
let knowledge: KnowledgeRepository;
let projectId: string;

const float32Buffer = (values: number[]): Buffer => {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
};

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-knowledge-repo-"));
  tempDirs.push(dir);
  storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  projects = new ProjectManagementRepository(storage);
  agents = new AgentPresetRepository(storage);
  knowledge = new KnowledgeRepository(storage);
  const project = projects.createProject({ name: "KB Project", sourceType: "local", sourceRef: dir });
  projectId = project.id;
});

afterEach(async () => {
  for (const s of storages.splice(0)) {
    try { s.close?.(); } catch { /* ignore */ }
  }
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

const createDoc = (title: string, text: string, hash: string) =>
  knowledge.createDocument(
    projectId,
    { title, sourceType: "paste", contentText: text },
    hash,
    Math.ceil(text.length / 4),
  );

describe("KnowledgeRepository", () => {
  it("creates, lists, and finds documents by content hash", () => {
    const doc = createDoc("API Guide", "REST endpoints and auth.", "hash-1");
    expect(doc.status).toBe("pending");
    expect(doc.title).toBe("API Guide");

    const list = knowledge.listDocuments(projectId);
    expect(list).toHaveLength(1);
    expect((list[0] as any).contentText).toBeUndefined(); // summary omits heavy text

    expect(knowledge.findByContentHash(projectId, "hash-1")?.id).toBe(doc.id);
    expect(knowledge.findByContentHash(projectId, "missing")).toBeNull();
  });

  it("updates document status and round-trips chunk embeddings", () => {
    const doc = createDoc("Doc", "alpha beta gamma", "hash-2");
    knowledge.replaceChunks(doc.id, projectId, [
      { chunkIndex: 0, content: "alpha beta", tokenCount: 2, heading: "H", embeddingModel: "bge-small-en-v1.5", embeddingDimension: 3, embeddingBlob: float32Buffer([1, 0, 0]) },
      { chunkIndex: 1, content: "gamma", tokenCount: 1, heading: null, embeddingModel: "bge-small-en-v1.5", embeddingDimension: 3, embeddingBlob: float32Buffer([0, 1, 0]) },
    ]);
    knowledge.updateDocumentStatus(doc.id, { status: "ready", embeddingModel: "bge-small-en-v1.5", chunkCount: 2, summary: "alpha beta" });

    const reloaded = knowledge.getDocument(doc.id);
    expect(reloaded?.status).toBe("ready");
    expect(reloaded?.chunkCount).toBe(2);
    expect(knowledge.countChunks(doc.id)).toBe(2);

    const embeddings = knowledge.loadChunkEmbeddingsForDocuments([doc.id], "bge-small-en-v1.5");
    expect(embeddings).toHaveLength(2);
    const first = embeddings.find((e) => e.chunkIndex === 0)!;
    expect(first.content).toBe("alpha beta");
    expect(first.embeddingDimension).toBe(3);

    // replaceChunks should overwrite, not append
    knowledge.replaceChunks(doc.id, projectId, [
      { chunkIndex: 0, content: "only", tokenCount: 1, heading: null, embeddingModel: "bge-small-en-v1.5", embeddingDimension: 3, embeddingBlob: float32Buffer([0, 0, 1]) },
    ]);
    expect(knowledge.countChunks(doc.id)).toBe(1);
  });

  it("manages agent subscriptions and validates project ownership", () => {
    const agent = agents.createAgentPreset(projectId, { name: "Iris" });
    const docA = createDoc("A", "a", "hash-a");
    const docB = createDoc("B", "b", "hash-b");

    knowledge.setSubscriptions(agent.id, projectId, [docA.id, docB.id, "does-not-exist"]);
    expect(knowledge.listDocumentIdsForAgent(agent.id).sort()).toEqual([docA.id, docB.id].sort());
    expect(knowledge.listAgentIdsForDocument(docA.id)).toEqual([agent.id]);

    // Replacing the set removes old entries
    knowledge.setSubscriptions(agent.id, projectId, [docB.id]);
    expect(knowledge.listDocumentIdsForAgent(agent.id)).toEqual([docB.id]);
  });

  it("cascades chunk + subscription deletes when a document is removed", () => {
    const agent = agents.createAgentPreset(projectId, { name: "Iris" });
    const doc = createDoc("Doc", "text", "hash-c");
    knowledge.replaceChunks(doc.id, projectId, [
      { chunkIndex: 0, content: "x", tokenCount: 1, heading: null, embeddingModel: "bge-small-en-v1.5", embeddingDimension: 1, embeddingBlob: float32Buffer([1]) },
    ]);
    knowledge.setSubscriptions(agent.id, projectId, [doc.id]);

    knowledge.deleteDocument(doc.id);
    expect(knowledge.getDocument(doc.id)).toBeNull();
    expect(knowledge.countChunks(doc.id)).toBe(0);
    expect(knowledge.listDocumentIdsForAgent(agent.id)).toEqual([]);
  });
});
