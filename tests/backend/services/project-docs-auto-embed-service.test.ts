import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ProjectDocsAutoEmbedService } from "../../../src/services/project-docs-auto-embed-service.js";
import type { IngestDocumentRequest } from "../../../src/services/knowledge-service.js";

const tempDirs: string[] = [];

interface IngestCall {
  projectId: string;
  request: IngestDocumentRequest;
}

function createKnowledgeServiceMock(options: { failOn?: string } = {}) {
  const calls: IngestCall[] = [];
  const ingestDocument = vi.fn(async (projectId: string, request: IngestDocumentRequest) => {
    calls.push({ projectId, request });
    if (request.sourceRef === options.failOn) {
      throw new Error(`failed ${request.sourceRef}`);
    }
    return {
      id: `doc-${calls.length}`,
      projectId,
      title: request.title,
      sourceType: request.sourceType,
      sourceRef: request.sourceRef ?? null,
      mimeType: request.mimeType ?? "text/plain",
      byteSize: request.buffer?.byteLength ?? 0,
      charCount: request.buffer?.byteLength ?? 0,
      tokenCount: 1,
      summary: "",
      contentHash: `hash-${calls.length}`,
      status: "pending" as const,
      embeddingModel: null,
      chunkCount: 0,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  });

  return { knowledgeService: { ingestDocument }, calls };
}

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-auto-docs-"));
  tempDirs.push(dir);
  return dir;
}

async function writeProjectFile(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(projectRoot, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectDocsAutoEmbedService", () => {
  it("discovers documentation files in deterministic order and passes repo_path payloads", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "# Readme");
    await writeProjectFile(projectRoot, "CHANGELOG.md", "# Changelog");
    await writeProjectFile(projectRoot, "CONTRIBUTING.md", "# Contributing");
    await writeProjectFile(projectRoot, "AGENTS.md", "# Agents");
    await writeProjectFile(projectRoot, "GEMINI.md", "# Gemini");
    await writeProjectFile(projectRoot, "CLAUDE.md", "# Claude");
    await writeProjectFile(projectRoot, "docs/guide.md", "# Guide");
    await writeProjectFile(projectRoot, "docs/nested/page.mdx", "# Page");
    await writeProjectFile(projectRoot, "docs/reference.html", "<h1>Reference</h1>");
    await writeProjectFile(projectRoot, "docs/source.ts", "export const source = true;");
    await writeProjectFile(projectRoot, "src/index.ts", "export const app = true;");

    const { knowledgeService, calls } = createKnowledgeServiceMock();
    const service = new ProjectDocsAutoEmbedService(knowledgeService);

    const result = await service.embedProjectDocs("project-1", projectRoot);

    expect(result.errors).toEqual([]);
    expect(result.documentIds).toEqual([
      "doc-1",
      "doc-2",
      "doc-3",
      "doc-4",
      "doc-5",
      "doc-6",
      "doc-7",
      "doc-8",
      "doc-9",
    ]);
    expect(calls.map((call) => call.request.sourceRef)).toEqual([
      "AGENTS.md",
      "CHANGELOG.md",
      "CLAUDE.md",
      "CONTRIBUTING.md",
      "GEMINI.md",
      "README.md",
      "docs/guide.md",
      "docs/nested/page.mdx",
      "docs/reference.html",
    ]);
    expect(calls[0]).toMatchObject({
      projectId: "project-1",
      request: {
        title: "AGENTS.md",
        sourceType: "repo_path",
        sourceRef: "AGENTS.md",
      },
    });
    expect(calls[0].request.buffer?.toString("utf8")).toBe("# Agents");
  });

  it("ignores generated, dependency, VCS, cache, and embedding output directories", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "docs/visible.md", "# Visible");
    await writeProjectFile(projectRoot, "docs/.git/hidden.md", "# Git");
    await writeProjectFile(projectRoot, "docs/node_modules/hidden.md", "# Dependencies");
    await writeProjectFile(projectRoot, "docs/dist/hidden.md", "# Dist");
    await writeProjectFile(projectRoot, "docs/build/hidden.md", "# Build");
    await writeProjectFile(projectRoot, "docs/coverage/hidden.md", "# Coverage");
    await writeProjectFile(projectRoot, "docs/.cache/hidden.md", "# Cache");
    await writeProjectFile(projectRoot, "docs/.turbo/hidden.md", "# Turbo");
    await writeProjectFile(projectRoot, "docs/.next/hidden.md", "# Next");
    await writeProjectFile(projectRoot, "docs/.output/hidden.md", "# Output");
    await writeProjectFile(projectRoot, "docs/.code-ux/embeddings/hidden.md", "# Embeddings");

    const { knowledgeService, calls } = createKnowledgeServiceMock();
    const service = new ProjectDocsAutoEmbedService(knowledgeService);

    const result = await service.embedProjectDocs("project-1", projectRoot);

    expect(result.errors).toEqual([]);
    expect(calls.map((call) => call.request.sourceRef)).toEqual(["docs/visible.md"]);
  });

  it("skips symlinks so linked docs cannot escape the project root", async () => {
    const projectRoot = await createTempProject();
    const outsideRoot = await createTempProject();
    await writeProjectFile(projectRoot, "docs/visible.md", "# Visible");
    await writeProjectFile(outsideRoot, "outside.md", "# Outside");
    await fs.symlink(path.join(outsideRoot, "outside.md"), path.join(projectRoot, "docs", "outside.md"));

    const { knowledgeService, calls } = createKnowledgeServiceMock();
    const service = new ProjectDocsAutoEmbedService(knowledgeService);

    const result = await service.embedProjectDocs("project-1", projectRoot);

    expect(calls.map((call) => call.request.sourceRef)).toEqual(["docs/visible.md"]);
    expect(result.documentIds).toEqual(["doc-1"]);
    expect(result.errors).toEqual([
      { fileName: "docs/outside.md", error: "Skipped symbolic link" },
    ]);
  });

  it("collects ingestion failures without dropping successfully ingested documents", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "docs/fails.md", "# Fails");
    await writeProjectFile(projectRoot, "docs/succeeds.md", "# Succeeds");

    const { knowledgeService } = createKnowledgeServiceMock({ failOn: "docs/fails.md" });
    const service = new ProjectDocsAutoEmbedService(knowledgeService);

    const result = await service.embedProjectDocs("project-1", projectRoot);

    expect(result.documentIds).toEqual(["doc-2"]);
    expect(result.errors).toEqual([
      { fileName: "docs/fails.md", error: "failed docs/fails.md" },
    ]);
  });

  it("reports truncation when the selected documentation file limit is reached", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "AGENTS.md", "# Agents");
    await writeProjectFile(projectRoot, "README.md", "# Readme");
    await writeProjectFile(projectRoot, "docs/guide.md", "# Guide");

    const { knowledgeService, calls } = createKnowledgeServiceMock();
    const service = new ProjectDocsAutoEmbedService(knowledgeService, { maxFiles: 1 });

    const result = await service.embedProjectDocs("project-1", projectRoot);

    expect(calls.map((call) => call.request.sourceRef)).toEqual(["AGENTS.md"]);
    expect(result.documentIds).toEqual(["doc-1"]);
    expect(result.errors).toEqual([
      { fileName: "README.md", error: "Documentation discovery truncated at 1 files" },
    ]);
  });
});
