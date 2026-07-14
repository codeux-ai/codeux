// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import { KnowledgePage } from "../../../dashboard/src/v2/KnowledgePage.js";
import type {
  KnowledgeDocument,
  KnowledgeUploadResult,
} from "../../../dashboard/src/v2/lib/knowledge-api.js";
import { formatKnowledgeDate, formatKnowledgeFileSize, formatKnowledgeProgress } from "../../../dashboard/src/v2/lib/knowledge-presentation.js";

expect.extend(matchers);

const projectState = vi.hoisted(() => ({
  selectedProject: { id: "project-current", name: "Current Project" },
  projects: [
    { id: "project-current", name: "Current Project" },
    { id: "project-source", name: "Source Project" },
  ],
}));

const knowledgeApi = vi.hoisted(() => ({
  fetchKnowledgeDocuments: vi.fn(),
  addPastedDocument: vi.fn(),
  addRepoPathDocuments: vi.fn(),
  uploadKnowledgeFiles: vi.fn(),
  importKnowledgeFromProject: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
  reembedKnowledgeDocument: vi.fn(),
  searchKnowledge: vi.fn(),
}));

const memoryApi = vi.hoisted(() => ({ listEmbeddingModels: vi.fn() }));
const agentApi = vi.hoisted(() => ({ fetchAgentPresets: vi.fn() }));

vi.mock("../../../dashboard/src/v2/context/project-data.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../dashboard/src/v2/context/project-data.js")>(),
  useProjectData: () => projectState,
}));
vi.mock("../../../dashboard/src/v2/lib/knowledge-api.js", () => knowledgeApi);
vi.mock("../../../dashboard/src/v2/lib/memory-api.js", () => memoryApi);
vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => agentApi);

const makeDocument = (overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({
  id: "doc-1",
  projectId: "project-current",
  title: "ARCHITECTURE.md",
  sourceType: "repo_path",
  sourceRef: "docs/ARCHITECTURE.md",
  mimeType: "text/markdown",
  byteSize: 1_536_000,
  charCount: 1_000,
  tokenCount: 1_234,
  summary: "Keep this authored summary unchanged.",
  contentHash: "content-hash",
  status: "ready",
  embeddingModel: "bge-small-en-v1.5",
  chunkCount: 2,
  errorMessage: null,
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-14T10:00:00.000Z",
  subscriberAgentIds: [],
  ...overrides,
});

const emptyUploadResult = (): KnowledgeUploadResult => ({ documents: [], errors: [] });

const renderGermanPage = () => render(
  <DashboardI18nProvider initialLocale="de" storage={null}>
    <KnowledgePage />
  </DashboardI18nProvider>,
);

describe("Knowledge route German localization", () => {
  beforeEach(() => {
    cleanup();
    projectState.selectedProject = { id: "project-current", name: "Current Project" };
    projectState.projects = [
      { id: "project-current", name: "Current Project" },
      { id: "project-source", name: "Source Project" },
    ];
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([]);
    knowledgeApi.addPastedDocument.mockResolvedValue(makeDocument({ sourceType: "paste" }));
    knowledgeApi.addRepoPathDocuments.mockResolvedValue(emptyUploadResult());
    knowledgeApi.uploadKnowledgeFiles.mockResolvedValue(emptyUploadResult());
    knowledgeApi.importKnowledgeFromProject.mockResolvedValue(emptyUploadResult());
    knowledgeApi.deleteKnowledgeDocument.mockResolvedValue(undefined);
    knowledgeApi.reembedKnowledgeDocument.mockResolvedValue(makeDocument({ status: "pending" }));
    knowledgeApi.searchKnowledge.mockResolvedValue([]);
    memoryApi.listEmbeddingModels.mockResolvedValue([{ active: true, name: "bge-small-en-v1.5" }]);
    agentApi.fetchAgentPresets.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders the German empty state", async () => {
    renderGermanPage();

    expect(await screen.findByRole("heading", { name: "Dokumente" })).toBeInTheDocument();
    expect(screen.getByText("Wissensbasis aufbauen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hochladen" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Aus Repository" })).toBeEnabled();
  });

  it("renders localized counts, size, date, and status while preserving document data", async () => {
    const doc = makeDocument();
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([doc]);

    renderGermanPage();

    expect(await screen.findByText(doc.title)).toHaveAttribute("title", doc.title);
    expect(screen.getByText(doc.sourceRef!)).toHaveAttribute("title", doc.sourceRef!);
    expect(screen.getByText(doc.summary)).toBeInTheDocument();
    expect(screen.getByText("2 Abschnitte")).toBeInTheDocument();
    expect(screen.getByText("1 Dokument")).toBeInTheDocument();
    expect(screen.getByText("2 eingebettete Abschnitte")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(formatKnowledgeFileSize(doc.byteSize, "de")))).toHaveTextContent(
      formatKnowledgeDate(doc.updatedAt, "de"),
    );
    expect(screen.getByText(new RegExp(formatKnowledgeFileSize(doc.byteSize, "de")))).toHaveTextContent("1.234 Tok.");
  });

  it("searches from the keyboard and preserves agent names and result contents", async () => {
    const user = userEvent.setup();
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([makeDocument()]);
    agentApi.fetchAgentPresets.mockResolvedValue([{ id: "agent-1", name: "Agent Alpha" }]);
    knowledgeApi.searchKnowledge.mockResolvedValue([{
      documentId: "doc-1",
      documentTitle: "API_Guide.md",
      chunkIndex: 0,
      heading: "Raw <heading>",
      content: "const untouched = 'ä';",
      similarity: 0.876,
    }]);
    renderGermanPage();

    const input = await screen.findByRole("textbox", { name: "Suchanfrage für Wissen" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Suchbereich für Wissen" }), "agent-1");
    await user.type(input, "auth flow{Enter}");

    await waitFor(() => expect(knowledgeApi.searchKnowledge).toHaveBeenCalledWith("project-current", {
      query: "auth flow",
      agentPresetId: "agent-1",
      limit: 6,
    }));
    expect(screen.getByText("Agent Alpha", { exact: false })).toBeInTheDocument();
    expect(await screen.findByText("const untouched = 'ä';")).toBeInTheDocument();
    expect(screen.getByText("API_Guide.md › Raw <heading>")).toBeInTheDocument();
    const formattedProgress = formatKnowledgeProgress(0.876, "de");
    expect(screen.getByText((_content, element) => element?.textContent === formattedProgress)).toBeInTheDocument();
  });

  it("uploads a file without changing its name", async () => {
    const user = userEvent.setup();
    const fileName = "Überblick mit sehr langem unverändertem Dateinamen.md";
    const file = new File(["# unverändert"], fileName, { type: "text/markdown" });
    knowledgeApi.uploadKnowledgeFiles.mockResolvedValue({ documents: [makeDocument({ title: fileName })], errors: [] });
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: "Hochladen" }));
    await user.upload(screen.getByLabelText("Wissensdateien auswählen"), file);

    await waitFor(() => expect(knowledgeApi.uploadKnowledgeFiles).toHaveBeenCalledWith("project-current", [file]));
    expect(await screen.findByText("1 Dokument hinzugefügt.")).toBeInTheDocument();
  });

  it.each(["README.md", "docs/"])("ingests the repository path %s with Enter", async (repoPath) => {
    const user = userEvent.setup();
    knowledgeApi.addRepoPathDocuments.mockResolvedValue({ documents: [makeDocument({ sourceRef: repoPath })], errors: [] });
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: "Aus Repository" }));
    const input = screen.getByRole("textbox", { name: "Datei- oder Verzeichnispfad im Repository" });
    await user.type(input, `${repoPath}{Enter}`);

    await waitFor(() => expect(knowledgeApi.addRepoPathDocuments).toHaveBeenCalledWith("project-current", repoPath));
    expect(await screen.findByText(new RegExp(`1 Dokument aus ${repoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} eingelesen`))).toBeInTheDocument();
  });

  it("shows invalid-path API errors verbatim", async () => {
    const user = userEvent.setup();
    const rawError = "Path ../secrets is outside project baseDir";
    knowledgeApi.addRepoPathDocuments.mockRejectedValue(new Error(rawError));
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: "Aus Repository" }));
    await user.type(screen.getByRole("textbox", { name: "Datei- oder Verzeichnispfad im Repository" }), "../secrets{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(rawError);
  });

  it("keeps partial-failure filenames and diagnostics verbatim after refreshing documents", async () => {
    const user = userEvent.setup();
    knowledgeApi.addRepoPathDocuments.mockResolvedValue({
      documents: [makeDocument()],
      errors: [{ fileName: "docs/RAW_Ä.md", error: "Unsupported MIME text/x-raw" }],
    });
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: "Aus Repository" }));
    await user.type(screen.getByRole("textbox", { name: "Datei- oder Verzeichnispfad im Repository" }), "docs/{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("docs/RAW_Ä.md: Unsupported MIME text/x-raw");
  });

  it("announces model unavailability in German", async () => {
    memoryApi.listEmbeddingModels.mockResolvedValue([]);
    renderGermanPage();

    expect(await screen.findByText(/Kein Einbettungsmodell ist aktiv/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Speicher" })).toHaveAttribute("href", "/memory");
  });

  it("refreshes after a raw load error and retries failed embedding", async () => {
    const user = userEvent.setup();
    const failedDoc = makeDocument({ status: "error", errorMessage: "Model checksum mismatch" });
    knowledgeApi.fetchKnowledgeDocuments
      .mockRejectedValueOnce(new Error("Knowledge backend unavailable"))
      .mockResolvedValue([failedDoc]);
    renderGermanPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Knowledge backend unavailable");
    await user.click(screen.getByRole("button", { name: "Dokumente aktualisieren" }));
    await user.click(await screen.findByRole("button", { name: `Einbettung für ${failedDoc.title} erneut versuchen` }));

    expect(knowledgeApi.reembedKnowledgeDocument).toHaveBeenCalledWith("project-current", failedDoc.id);
    expect(await screen.findByText(`Einbettung für ${failedDoc.title} wurde neu gestartet.`)).toBeInTheDocument();
  });

  it("prevents duplicate repository ingestion while a request is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: KnowledgeUploadResult) => void) | undefined;
    knowledgeApi.addRepoPathDocuments.mockImplementation(() => new Promise<KnowledgeUploadResult>((resolve) => {
      resolveRequest = resolve;
    }));
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: "Aus Repository" }));
    const input = screen.getByRole("textbox", { name: "Datei- oder Verzeichnispfad im Repository" });
    await user.type(input, "docs/");
    await user.keyboard("{Enter}{Enter}");

    expect(knowledgeApi.addRepoPathDocuments).toHaveBeenCalledTimes(1);
    resolveRequest?.(emptyUploadResult());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("supports Escape and preserves long filenames in controls and confirmations", async () => {
    const user = userEvent.setup();
    const longTitle = `${"very-long-authored-name-".repeat(8)}.md`;
    const doc = makeDocument({ title: longTitle });
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([doc]);
    const confirmSpy = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirmSpy });
    renderGermanPage();

    const deleteButton = await screen.findByRole("button", { name: `${longTitle} löschen` });
    expect(screen.getByText(longTitle)).toHaveAttribute("title", longTitle);
    await user.click(deleteButton);
    expect(confirmSpy).toHaveBeenCalledWith(`\"${longTitle}\" löschen? Dies kann nicht rückgängig gemacht werden.`);
    expect(knowledgeApi.deleteKnowledgeDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Einfügen" }));
    expect(screen.getByRole("dialog", { name: "Notiz einfügen" })).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Titel der Notiz" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
