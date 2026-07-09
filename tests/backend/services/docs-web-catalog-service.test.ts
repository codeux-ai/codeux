import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerDocsWebRoutes } from "../../../src/server/docs-web-routes.js";
import { DocsWebCatalogService } from "../../../src/services/docs-web-catalog-service.js";

const repoDocsWebRoot = path.resolve(process.cwd(), "docs-web");
const sampleDocIds = [
  "docs-overview",
  "user-dashboard-overview",
  "user-quickstart",
  "developer-mcp-tools",
  "architecture-system-overview",
] as const;

describe("DocsWebCatalogService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeux-docs-web-"));
    fs.mkdirSync(path.join(tempDir, "user", "dashboard"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "developer"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "index.md"), "# Code UX Documentation\n\nRoot overview.");
    fs.writeFileSync(path.join(tempDir, "user", "quickstart.md"), "# Quickstart\n\nStart here with [Dashboard](./dashboard/overview.md).");
    fs.writeFileSync(path.join(tempDir, "user", "dashboard", "overview.md"), "# Dashboard\n\nDashboard guide.");
    fs.writeFileSync(path.join(tempDir, "developer", "index.md"), "# Developer Reference\n\nDeveloper contracts.");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds a stable docs-web collection from markdown files", () => {
    const service = new DocsWebCatalogService(tempDir);
    const collection = service.getCollection();

    expect(collection.defaultDocId).toBe("docs-overview");
    expect(collection.docs.map((doc) => doc.id)).toEqual([
      "docs-overview",
      "user-quickstart",
      "user-dashboard-overview",
      "developer-overview",
    ]);
    expect(collection.groupedDocs["Getting Started"].map((doc) => doc.id)).toEqual([
      "docs-overview",
      "user-quickstart",
    ]);
    expect(collection.groupedDocs["Developer Reference"].map((doc) => doc.id)).toEqual(["developer-overview"]);
  });

  it("lists the main repository docs-web samples", () => {
    const service = new DocsWebCatalogService(repoDocsWebRoot);
    const collection = service.getCollection();
    const docIds = new Set(collection.docs.map((doc) => doc.id));

    expect(collection.defaultDocId).toBe("docs-overview");
    for (const docId of sampleDocIds) {
      expect(docIds.has(docId)).toBe(true);
    }
  });

  it("returns individual documents with content and metadata", () => {
    const service = new DocsWebCatalogService(tempDir);
    const doc = service.getDocument("user-quickstart");

    expect(doc?.title).toBe("Quickstart");
    expect(doc?.description).toBe("Start here with Dashboard.");
    expect(doc?.sourcePath).toBe("user/quickstart.md");
    expect(doc?.contentMarkdown).toContain("[Dashboard](./dashboard/overview.md)");
  });

  it("removes complete script elements and escapes malformed tags from descriptions", () => {
    fs.writeFileSync(
      path.join(tempDir, "user", "unsafe.md"),
      "# Unsafe\n\nKeep <strong>text</strong> <script>alert(1)</script> and <script",
    );
    const service = new DocsWebCatalogService(tempDir);
    const doc = service.getDocument("user-unsafe");

    expect(doc?.description).toBe("Keep text  and ");
    expect(doc?.description).not.toContain("<script");
  });

  it("returns null for unknown documents", () => {
    const service = new DocsWebCatalogService(tempDir);

    expect(service.getDocument("missing")).toBeNull();
  });
});

describe("registerDocsWebRoutes", () => {
  it("serves the repository docs-web collection and sample documents", async () => {
    const app = express();
    registerDocsWebRoutes(app, new DocsWebCatalogService(repoDocsWebRoot));

    const collectionResponse = await request(app).get("/api/docs-web");
    expect(collectionResponse.status).toBe(200);
    expect(collectionResponse.body.defaultDocId).toBe("docs-overview");

    for (const docId of sampleDocIds) {
      const docResponse = await request(app).get(`/api/docs-web/${docId}`);

      expect(docResponse.status).toBe(200);
      expect(docResponse.body.doc.id).toBe(docId);
      expect(docResponse.body.doc.contentMarkdown.trim().length).toBeGreaterThan(0);
    }
  });
});
