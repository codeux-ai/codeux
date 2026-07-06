import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { configureDashboardApp } from "../../../src/server/dashboard-server.js";

const tempDirs: string[] = [];

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as any;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const createKnowledgeApp = (overrides: Record<string, unknown> = {}) => {
  const app = express();
  const ingestDocument = vi.fn(async (_projectId: string, input: any) => ({
    id: "doc-1",
    projectId: "project-1",
    title: input.title,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    mimeType: input.mimeType ?? "text/plain",
    byteSize: 12,
    charCount: 12,
    tokenCount: 3,
    summary: "",
    contentHash: "hash",
    status: "pending",
    embeddingModel: null,
    chunkCount: 0,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    subscriberAgentIds: [],
  }));
  const setSubscriptions = vi.fn((_agentPresetId: string, _projectId: string, documentIds: string[]) => documentIds);
  const importDocumentsFromProject = vi.fn(async () => ({ documents: [{ id: "doc-2" }], errors: [] }));

  configureDashboardApp({
    app,
    dashboardDir: "/nonexistent",
    port: 0,
    liveActivityCacheMs: 0,
    logger: noopLogger,
    isHealthy: () => ({ status: "UP" }),
    isReady: () => ({ status: "READY" }),
    getStatus: () => ({}),
    knowledgeService: {
      isModelLoaded: () => true,
      listDocuments: () => [],
      ingestDocument,
      deleteDocument: () => {},
      getDocument: () => null,
      reembedDocument: async () => {},
      getDocumentForProject: () => null,
      deleteDocumentForProject: () => false,
      reembedDocumentForProject: async () => null,
      search: async () => [],
      listSubscriptions: () => [],
      setSubscriptions,
      importDocumentsFromProject,
    },
    agentPresetRepository: {
      getAgentPreset: () => ({ id: "agent-1", projectId: "project-1" }),
    },
    projectManagementRepository: {
      getProject: () => ({ id: "project-1", baseDir: overrides.baseDir ?? "/tmp" }),
    },
    ...overrides,
  } as any);

  return { app, ingestDocument, setSubscriptions, importDocumentsFromProject };
};

describe("knowledge dashboard route registration", () => {
  it("parses pasted document JSON before the knowledge route handles it", async () => {
    const { app, ingestDocument } = createKnowledgeApp();

    await request(app)
      .post("/api/projects/project-1/knowledge/documents")
      .send({ title: "Runbook", text: "Use the safe deploy checklist." })
      .expect(201);

    expect(ingestDocument).toHaveBeenCalledWith("project-1", {
      title: "Runbook",
      sourceType: "paste",
      text: "Use the safe deploy checklist.",
    });
  });

  it("parses repo-path JSON before ingesting from the project directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-"));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, "README.md"), "# Notes\n\nAlpha setup", "utf8");
    const { app, ingestDocument } = createKnowledgeApp({ baseDir: dir });

    await request(app)
      .post("/api/projects/project-1/knowledge/documents")
      .send({ path: "README.md" })
      .expect(201);

    expect(ingestDocument).toHaveBeenCalledWith("project-1", expect.objectContaining({
      title: "README.md",
      sourceType: "repo_path",
      sourceRef: "README.md",
      buffer: expect.any(Buffer),
    }));
  });

  it("parses subscription JSON instead of replacing agent documents with an empty set", async () => {
    const { app, setSubscriptions } = createKnowledgeApp();

    const response = await request(app)
      .put("/api/agent-presets/agent-1/knowledge/subscriptions")
      .send({ documentIds: ["doc-1", "doc-2"] })
      .expect(200);

    expect(response.body).toEqual({ documentIds: ["doc-1", "doc-2"] });
    expect(setSubscriptions).toHaveBeenCalledWith("agent-1", "project-1", ["doc-1", "doc-2"]);
  });

  it("parses project import JSON before copying knowledge documents", async () => {
    const { app, importDocumentsFromProject } = createKnowledgeApp();

    await request(app)
      .post("/api/projects/project-1/knowledge/documents/import-project")
      .send({ sourceProjectId: "source-project", documentIds: ["doc-1"] })
      .expect(201);

    expect(importDocumentsFromProject).toHaveBeenCalledWith("project-1", "source-project", ["doc-1"]);
  });
});
