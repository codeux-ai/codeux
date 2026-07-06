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
  const documentRecord = {
    id: "doc-1",
    projectId: "project-1",
    title: "Runbook",
    sourceType: "paste",
    sourceRef: null,
    mimeType: "text/plain",
    byteSize: 12,
    charCount: 12,
    tokenCount: 3,
    summary: "",
    contentHash: "hash",
    status: "ready",
    embeddingModel: null,
    chunkCount: 0,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const ingestDocument = vi.fn(async (_projectId: string, input: any) => ({
    ...documentRecord,
    title: input.title,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    mimeType: input.mimeType ?? "text/plain",
    status: "pending",
    subscriberAgentIds: [],
  }));
  const getDocumentForProject = vi.fn((projectId: string, documentId: string) => (
    projectId === "project-1" && documentId === "doc-1" ? documentRecord : null
  ));
  const deleteDocumentForProject = vi.fn((projectId: string, documentId: string) => (
    projectId === "project-1" && documentId === "doc-1"
  ));
  const reembedDocumentForProject = vi.fn(async (projectId: string, documentId: string) => (
    projectId === "project-1" && documentId === "doc-1" ? documentRecord : null
  ));
  const listDocuments = vi.fn((projectId: string) => (
    projectId === "project-1" ? [{ ...documentRecord, subscriberAgentIds: [] }] : []
  ));
  const search = vi.fn(async () => []);

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
      listDocuments,
      ingestDocument,
      deleteDocument: () => {},
      getDocument: () => null,
      reembedDocument: async () => {},
      getDocumentForProject,
      deleteDocumentForProject,
      reembedDocumentForProject,
      search,
      listSubscriptions: () => [],
      setSubscriptions: () => [],
      importDocumentsFromProject: async () => ({ documents: [], errors: [] }),
    },
    agentPresetRepository: {
      getAgentPreset: () => ({ id: "agent-1", projectId: "project-1" }),
    },
    projectManagementRepository: {
      getProject: () => ({ id: "project-1", baseDir: overrides.baseDir ?? "/tmp" }),
    },
    ...overrides,
  } as any);

  return { app, ingestDocument, getDocumentForProject, deleteDocumentForProject, reembedDocumentForProject, search };
};

describe("knowledge routes", () => {
  describe("document object access", () => {
    it("allows same-project document reads and returns 404 for cross-project reads", async () => {
      const { app, getDocumentForProject } = createKnowledgeApp();

      await request(app)
        .get("/api/projects/project-1/knowledge/documents/doc-1")
        .expect(200);

      const crossProject = await request(app)
        .get("/api/projects/project-2/knowledge/documents/doc-1")
        .expect(404);

      expect(crossProject.body).toEqual({ error: "Document not found" });
      expect(getDocumentForProject).toHaveBeenCalledWith("project-1", "doc-1");
      expect(getDocumentForProject).toHaveBeenCalledWith("project-2", "doc-1");
    });

    it("requires projectId on legacy document reads and hides project mismatches as not found", async () => {
      const { app } = createKnowledgeApp();

      await request(app)
        .get("/api/knowledge/documents/doc-1")
        .expect(400);

      await request(app)
        .get("/api/knowledge/documents/doc-1?projectId=project-1")
        .expect(200);

      const mismatch = await request(app)
        .get("/api/knowledge/documents/doc-1?projectId=project-2")
        .expect(404);

      expect(mismatch.body).toEqual({ error: "Document not found" });
    });

    it("allows same-project deletes and rejects cross-project deletes without mutating", async () => {
      const { app, deleteDocumentForProject } = createKnowledgeApp();

      await request(app)
        .delete("/api/projects/project-1/knowledge/documents/doc-1")
        .expect(200);

      const mismatch = await request(app)
        .delete("/api/projects/project-2/knowledge/documents/doc-1")
        .expect(404);

      expect(mismatch.body).toEqual({ error: "Document not found" });
      expect(deleteDocumentForProject).toHaveBeenCalledWith("project-1", "doc-1");
      expect(deleteDocumentForProject).toHaveBeenCalledWith("project-2", "doc-1");
    });

    it("allows same-project re-embeds and rejects cross-project re-embeds", async () => {
      const { app, reembedDocumentForProject } = createKnowledgeApp();

      await request(app)
        .post("/api/projects/project-1/knowledge/documents/doc-1/reembed")
        .expect(200);

      const mismatch = await request(app)
        .post("/api/projects/project-2/knowledge/documents/doc-1/reembed")
        .expect(404);

      expect(mismatch.body).toEqual({ error: "Document not found" });
      expect(reembedDocumentForProject).toHaveBeenCalledWith("project-1", "doc-1");
      expect(reembedDocumentForProject).toHaveBeenCalledWith("project-2", "doc-1");
    });

    it("filters search document IDs to the route project before loading chunks", async () => {
      const { app, search } = createKnowledgeApp();

      await request(app)
        .post("/api/projects/project-1/knowledge/search")
        .send({ query: "deploy", documentIds: ["doc-1", "foreign-doc"] })
        .expect(200);

      expect(search).toHaveBeenCalledWith(["doc-1"], "deploy", 8);
    });
  });

  describe("upload", () => {
    it("sanitizes filenames and rejects unsupported types early", async () => {
      const { app, ingestDocument } = createKnowledgeApp();
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents/upload")
        .attach("files", Buffer.from("test"), { filename: "../../secret.txt", contentType: "text/plain" })
        .attach("files", Buffer.from("test2"), { filename: "good.md", contentType: "text/markdown" })
        .attach("files", Buffer.from("bad"), { filename: "bad.exe", contentType: "application/x-msdownload" })
        .attach("files", Buffer.from("fake-pdf"), { filename: "fake.pdf", contentType: "text/plain" })
        .attach("files", Buffer.from("fake-txt"), { filename: "fake.txt", contentType: "application/pdf" });

      expect(res.status).toBe(201);
      expect(ingestDocument).toHaveBeenCalledTimes(2);
      expect(ingestDocument.mock.calls[0][1].title).toBe("secret.txt"); // sanitized name without path separators
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors.some((e: any) => e.fileName === "bad.exe")).toBe(true);
      expect(res.body.errors.some((e: any) => e.fileName === "fake.pdf")).toBe(true);
      expect(res.body.errors.some((e: any) => e.fileName === "fake.txt")).toBe(true);
    });
  });

  describe("ingestRepoPath", () => {

    it("skips symlinked files inside directory", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-dir-"));
      tempDirs.push(dir);
      await fs.writeFile(path.join(dir, "valid.txt"), "valid content");

      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-outside-"));
      tempDirs.push(outsideDir);
      const outsideFile = path.join(outsideDir, "outside.txt");
      await fs.writeFile(outsideFile, "secret");

      await fs.symlink(outsideFile, path.join(dir, "link.txt"));

      const { app, ingestDocument } = createKnowledgeApp({ baseDir: dir });
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents")
        .send({ path: "." });

      expect(res.status).toBe(201);
      expect(ingestDocument).toHaveBeenCalledTimes(1);
      expect(ingestDocument.mock.calls[0][1].title).toBe("valid.txt");
    });

    it("rejects symlink path escape", async () => {
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-base-"));
      tempDirs.push(baseDir);
      const secretDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-secret-"));
      tempDirs.push(secretDir);

      const secretPath = path.join(secretDir, "secret.txt");
      await fs.writeFile(secretPath, "secret");
      await fs.symlink(secretPath, path.join(baseDir, "link.txt"));

      const { app } = createKnowledgeApp({ baseDir });
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents")
        .send({ path: "link.txt" });

      // Should fail safely returning a 400 since it throws inside `ingestRepoPath`
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Path must be inside the project directory");
    });

    it("rejects traversal and absolute path escapes before ingestion", async () => {
      const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-traversal-"));
      tempDirs.push(baseDir);
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-outside-"));
      tempDirs.push(outsideDir);
      await fs.writeFile(path.join(outsideDir, "outside.txt"), "secret");

      const { app, ingestDocument } = createKnowledgeApp({ baseDir });
      const attempts = [
        "../outside.txt",
        "%2e%2e/outside.txt",
        path.join(outsideDir, "outside.txt"),
      ];

      for (const requestedPath of attempts) {
        const res = await request(app)
          .post("/api/projects/project-1/knowledge/documents")
          .send({ path: requestedPath });

        expect(res.status).toBe(400);
      }
      expect(ingestDocument).not.toHaveBeenCalled();
    });

    it("caps directory file-count", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-cap-"));
      tempDirs.push(dir);

      for (let i = 0; i < 105; i++) {
        await fs.writeFile(path.join(dir, `file-${i}.txt`), "test");
      }

      const { app, ingestDocument } = createKnowledgeApp({ baseDir: dir });
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents")
        .send({ path: "." });

      expect(res.status).toBe(201);
      // Because we limit MAX_DIRECTORY_FILES to 100
      expect(ingestDocument.mock.calls.length).toBeLessThanOrEqual(100);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors.some((e: any) => e.error.includes("truncated"))).toBe(true);
    });

    it("ingests valid text upload", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-valid-"));
      tempDirs.push(dir);
      await fs.writeFile(path.join(dir, "valid.txt"), "valid content");

      const { app, ingestDocument } = createKnowledgeApp({ baseDir: dir });
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents")
        .send({ path: "valid.txt" });

      expect(res.status).toBe(201);
      expect(ingestDocument).toHaveBeenCalledTimes(1);
    });
  });
});
