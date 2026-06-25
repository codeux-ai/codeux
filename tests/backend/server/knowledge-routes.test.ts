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
      search: async () => [],
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

  return { app, ingestDocument };
};

describe("knowledge routes", () => {
  describe("upload", () => {
    it("sanitizes filenames and rejects unsupported types early", async () => {
      const { app, ingestDocument } = createKnowledgeApp();
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents/upload")
        .attach("files", Buffer.from("test"), { filename: "../../secret.txt", contentType: "text/plain" })
        .attach("files", Buffer.from("test2"), { filename: "good.md", contentType: "text/markdown" })
        .attach("files", Buffer.from("bad"), { filename: "bad.exe", contentType: "application/x-msdownload" });

      expect(res.status).toBe(201);
      expect(ingestDocument).toHaveBeenCalledTimes(2);
      expect(ingestDocument.mock.calls[0][1].title).toBe("secret.txt"); // sanitized name without path separators
    });
  });

  describe("ingestRepoPath", () => {
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

    it("caps directory file-count", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-kb-route-cap-"));
      tempDirs.push(dir);

      for (let i = 0; i < 105; i++) {
        await fs.writeFile(path.join(dir, `file-\${i}.txt`), "test");
      }

      const { app, ingestDocument } = createKnowledgeApp({ baseDir: dir });
      const res = await request(app)
        .post("/api/projects/project-1/knowledge/documents")
        .send({ path: "." });

      expect(res.status).toBe(201);
      // Because we limit MAX_DIRECTORY_FILES to 100
      expect(ingestDocument.mock.calls.length).toBeLessThanOrEqual(100);
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
