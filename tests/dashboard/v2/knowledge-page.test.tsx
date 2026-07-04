/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { KnowledgePage } from "../../../dashboard/src/v2/KnowledgePage.js";
import * as knowledgeApi from "../../../dashboard/src/v2/lib/knowledge-api.js";
import type { KnowledgeDocument, KnowledgeSearchResult } from "../../../dashboard/src/v2/lib/knowledge-api.js";
import * as memoryApi from "../../../dashboard/src/v2/lib/memory-api.js";
import * as agentPresetApi from "../../../dashboard/src/v2/lib/agent-preset-api.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
    killTweensOf: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => true),
  useResolvedMotionDuration: (duration: number) => duration,
}));

vi.mock("../../../dashboard/src/v2/lib/knowledge-api.js");
vi.mock("../../../dashboard/src/v2/lib/memory-api.js");
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js");
vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(() => ({
    projects: [{ id: "project-1", name: "Demo Project", isActive: true }],
    selectedProject: { id: "project-1", name: "Demo Project", isActive: true },
  })),
}));

const documentFixture: KnowledgeDocument = {
  id: "doc-1",
  projectId: "project-1",
  title: "Architecture Runbook",
  sourceType: "repo_path",
  sourceRef: "docs/architecture/runbook.md",
  mimeType: "text/markdown",
  byteSize: 4096,
  charCount: 1200,
  tokenCount: 340,
  summary: "Operational architecture notes for local worker routing.",
  contentHash: "hash-1",
  status: "ready",
  embeddingModel: "all-minilm-l6-v2",
  chunkCount: 3,
  errorMessage: null,
  createdAt: "2026-06-20T12:00:00.000Z",
  updatedAt: "2026-06-20T12:00:00.000Z",
  subscriberAgentIds: ["agent-1"],
};

const searchResultFixture: KnowledgeSearchResult = {
  documentId: "doc-1",
  documentTitle: "Architecture Runbook",
  chunkIndex: 1,
  heading: "Worker routing",
  content: "Provider CLIs run inside isolated Docker workspaces with project-scoped retrieval context.",
  similarity: 0.87,
};

describe("KnowledgePage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(knowledgeApi.fetchKnowledgeDocuments).mockResolvedValue([documentFixture]);
    vi.mocked(memoryApi.listEmbeddingModels).mockResolvedValue([
      {
        id: "all-minilm-l6-v2",
        displayName: "MiniLM",
        description: "Test model",
        dimension: 384,
        sizeBytes: 1,
        language: "en",
        files: [],
        downloaded: true,
        downloading: false,
        downloadProgress: null,
        localPath: "/tmp/model",
        error: null,
        active: true,
      },
    ]);
    vi.mocked(agentPresetApi.fetchAgentPresets).mockResolvedValue([
      {
        id: "agent-1",
        projectId: "project-1",
        name: "Planning Agent",
        labels: [],
        instructionMarkdown: "",
        syncStatus: "synced",
        sourcePath: null,
        sourceScope: null,
        sourceExists: false,
        avatarConfig: null,
        createdAt: "2026-06-20T12:00:00.000Z",
        updatedAt: "2026-06-20T12:00:00.000Z",
      },
    ]);
  });

  it("renders knowledge documents with retrieval metadata and accessible actions", async () => {
    render(<KnowledgePage />);

    expect(await screen.findByRole("heading", { name: "Retrieval browser" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Knowledge documents" })).toBeInTheDocument();
    expect(screen.getByLabelText("Architecture Runbook, Repo path, ready")).toBeInTheDocument();
    expect(screen.getByText("Repo path")).toBeInTheDocument();
    expect(screen.getByText("3 chunks")).toBeInTheDocument();
    expect(screen.getByText("~340 tok")).toBeInTheDocument();
    expect(screen.getByText("Planning Agent")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search knowledge passages" })).toBeInTheDocument();
    expect(screen.getByLabelText("Knowledge search scope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Architecture Runbook" })).toBeInTheDocument();
  });

  it("renders search results with similarity metadata", async () => {
    vi.mocked(knowledgeApi.searchKnowledge).mockResolvedValue([searchResultFixture]);
    render(<KnowledgePage />);

    const input = await screen.findByRole("textbox", { name: "Search knowledge passages" });
    fireEvent.input(input, { target: { value: "worker routing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search knowledge passages" }));

    await waitFor(() => {
      expect(knowledgeApi.searchKnowledge).toHaveBeenCalledWith("project-1", {
        query: "worker routing",
        agentPresetId: undefined,
        limit: 6,
      });
    });
    expect(await screen.findByRole("list", { name: "Knowledge search results" })).toBeInTheDocument();
    expect(screen.getByText("Architecture Runbook › Worker routing")).toBeInTheDocument();
    expect(screen.getByLabelText("Similarity 87 percent")).toBeInTheDocument();
    expect(screen.getByText("Chunk 2")).toBeInTheDocument();
  });

  it("uses the shared empty-state treatment for search misses", async () => {
    vi.mocked(knowledgeApi.searchKnowledge).mockResolvedValue([]);
    render(<KnowledgePage />);

    const input = await screen.findByRole("textbox", { name: "Search knowledge passages" });
    fireEvent.input(input, { target: { value: "missing term" } });
    fireEvent.click(screen.getByRole("button", { name: "Search knowledge passages" }));

    expect(await screen.findByText("No relevant passages found")).toBeInTheDocument();
    expect(screen.getByText("Try a more specific phrase, a different source term, or search the whole library.")).toBeInTheDocument();
  });
});
