import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { KnowledgeRepository } from "../../../src/repositories/knowledge-repository.js";
import { KnowledgeIngestionService } from "../../../src/services/knowledge-ingestion-service.js";
import { KnowledgeService } from "../../../src/services/knowledge-service.js";

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noopLogger } as any;

// Deterministic keyword-count embedding so cosine ranking is testable without an ONNX model.
const KEYWORDS = ["alpha", "beta", "gamma", "delta"];
const fakeEmbeddingService = {
  isLoaded: () => true,
  getLoadedModelId: () => "bge-small-en-v1.5" as const,
  getDimension: () => KEYWORDS.length,
  embed: async (text: string) => {
    const lower = text.toLowerCase();
    const vec = new Float32Array(KEYWORDS.length);
    KEYWORDS.forEach((k, i) => { vec[i] = (lower.match(new RegExp(k, "g")) || []).length; });
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  },
} as any;

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

let storage: AppDbStorage;
let projects: ProjectManagementRepository;
let agents: AgentPresetRepository;
let knowledgeRepo: KnowledgeRepository;
let service: KnowledgeService;
let projectId: string;

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-knowledge-svc-"));
  tempDirs.push(dir);
  storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  projects = new ProjectManagementRepository(storage);
  agents = new AgentPresetRepository(storage);
  knowledgeRepo = new KnowledgeRepository(storage);
  service = new KnowledgeService(knowledgeRepo, new KnowledgeIngestionService(noopLogger), fakeEmbeddingService, noopLogger);
  projectId = projects.createProject({ name: "KB", sourceType: "local", sourceRef: dir }).id;
});

afterEach(async () => {
  for (const s of storages.splice(0)) { try { s.close?.(); } catch { /* ignore */ } }
  for (const dir of tempDirs.splice(0)) { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});

const ingestReady = async (title: string, text: string) => {
  const doc = await service.ingestDocument(projectId, { title, sourceType: "paste", text });
  await service.embedDocument(doc.id); // deterministically finish embedding
  return service.getDocument(doc.id)!;
};

describe("KnowledgeService", () => {
  it("ingests, embeds, and marks documents ready", async () => {
    const doc = await ingestReady("Alpha doc", "alpha beta content about setup");
    expect(doc.status).toBe("ready");
    expect(doc.chunkCount).toBeGreaterThan(0);
    expect(doc.summary.length).toBeGreaterThan(0);
  });

  it("deduplicates identical content by hash", async () => {
    const first = await service.ingestDocument(projectId, { title: "One", sourceType: "paste", text: "same body text" });
    const second = await service.ingestDocument(projectId, { title: "Two", sourceType: "paste", text: "same body text" });
    expect(second.id).toBe(first.id);
    expect(service.listDocuments(projectId)).toHaveLength(1);
  });

  it("ranks search results by relevance within a document set", async () => {
    const alphaDoc = await ingestReady("Alpha", "alpha alpha beta notes");
    const gammaDoc = await ingestReady("Gamma", "gamma delta notes");

    const alphaResults = await service.search([alphaDoc.id, gammaDoc.id], "alpha");
    expect(alphaResults.length).toBeGreaterThan(0);
    expect(alphaResults[0].documentTitle).toBe("Alpha");

    const gammaResults = await service.search([alphaDoc.id, gammaDoc.id], "gamma");
    expect(gammaResults[0].documentTitle).toBe("Gamma");
  });

  it("scopes searchForAgent to the agent's subscriptions", async () => {
    const alphaDoc = await ingestReady("Alpha", "alpha alpha beta");
    const gammaDoc = await ingestReady("Gamma", "gamma delta");
    const agent = agents.createAgentPreset(projectId, { name: "Iris" });

    service.setSubscriptions(agent.id, projectId, [gammaDoc.id]);

    // Query mentions alpha, but the agent only subscribes to the gamma doc.
    const results = await service.searchForAgent(agent.id, "alpha");
    expect(results.every((r) => r.documentId === gammaDoc.id)).toBe(true);
    expect(await service.searchForAgent(agent.id, "gamma")).not.toHaveLength(0);

    // An agent with no subscriptions gets nothing.
    const empty = agents.createAgentPreset(projectId, { name: "Empty" });
    expect(await service.searchForAgent(empty.id, "alpha")).toHaveLength(0);
  });

  it("builds a manifest only from ready subscribed documents", async () => {
    const ready = await ingestReady("Ready Doc", "alpha beta");
    const agent = agents.createAgentPreset(projectId, { name: "Iris" });
    service.setSubscriptions(agent.id, projectId, [ready.id]);

    const manifest = service.buildManifestForAgent(agent.id);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].title).toBe("Ready Doc");

    const markdown = service.buildManifestMarkdownForAgent(agent.id);
    expect(markdown).toContain("Ready Doc");
    expect(markdown).toContain("search_knowledge");

    // No subscriptions → no manifest.
    const empty = agents.createAgentPreset(projectId, { name: "Empty" });
    expect(service.buildManifestMarkdownForAgent(empty.id)).toBeNull();
  });
});
