// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
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

const holdToConfirm = async (label: string): Promise<void> => {
  const labelElement = screen.getByText(label);
  const button = labelElement.closest("button");
  if (!button) throw new Error(`No confirmation button found for ${label}`);
  fireEvent.keyDown(button, { key: "Enter" });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 1_050));
  });
  fireEvent.keyUp(button, { key: "Enter" });
};

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
    await user.click(screen.getByRole("button", { name: "Suchbereich für Wissen" }));
    await user.click(screen.getByRole("option", { name: "Dokumente von Agent Alpha" }));
    await user.type(input, "auth flow{Enter}");

    await waitFor(() => expect(knowledgeApi.searchKnowledge).toHaveBeenCalledWith("project-current", {
      query: "auth flow",
      agentPresetId: "agent-1",
      limit: 6,
    }));
    expect(screen.getAllByText("Agent Alpha", { exact: false }).length).toBeGreaterThan(0);
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
    expect((await screen.findAllByText(`Einbettung für ${failedDoc.title} wurde neu gestartet.`)).length).toBeGreaterThan(0);
  });

  it("suppresses duplicate re-embedding and keeps a persistent row retry after failure", async () => {
    const failedDoc = makeDocument({ status: "error", errorMessage: "Initial embedding failure" });
    let rejectRequest: ((reason: Error) => void) | undefined;
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([failedDoc]);
    knowledgeApi.reembedKnowledgeDocument.mockImplementationOnce(() => new Promise<KnowledgeDocument>((_resolve, reject) => {
      rejectRequest = reject;
    }));
    renderGermanPage();

    const retryButton = await screen.findByRole("button", { name: `Einbettung für ${failedDoc.title} erneut versuchen` });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(knowledgeApi.reembedKnowledgeDocument).toHaveBeenCalledTimes(1);
    expect(screen.getByText(`Einbettung für ${failedDoc.title} wird neu gestartet…`)).toBeInTheDocument();

    await act(async () => rejectRequest?.(new Error("Raw model diagnostic")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Raw model diagnostic");

    knowledgeApi.reembedKnowledgeDocument.mockResolvedValueOnce(makeDocument({ status: "pending" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Erneut einbetten" }));
    expect(knowledgeApi.reembedKnowledgeDocument).toHaveBeenCalledTimes(2);
  });

  it("ignores a row mutation result after the selected project changes", async () => {
    const oldDocument = makeDocument({ id: "old-doc", title: "OLD.md", status: "error" });
    const nextDocument = makeDocument({ id: "next-doc", projectId: "project-next", title: "NEXT.md" });
    let resolveReembed: ((document: KnowledgeDocument) => void) | undefined;
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValueOnce([oldDocument]);
    knowledgeApi.reembedKnowledgeDocument.mockImplementationOnce(() => new Promise<KnowledgeDocument>((resolve) => {
      resolveReembed = resolve;
    }));
    const view = renderGermanPage();

    fireEvent.click(await screen.findByRole("button", { name: `Einbettung für ${oldDocument.title} erneut versuchen` }));
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([nextDocument]);
    projectState.selectedProject = { id: "project-next", name: "Next Project" };
    view.rerender(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <KnowledgePage />
      </DashboardI18nProvider>,
    );

    expect(await screen.findByRole("heading", { name: nextDocument.title })).toBeInTheDocument();
    await act(async () => resolveReembed?.(makeDocument({ id: oldDocument.id, title: "STALE.md", status: "pending" })));
    expect(screen.queryByRole("heading", { name: "STALE.md" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: nextDocument.title })).toBeInTheDocument();
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

  it("uses the localized confirm dialog, restores trigger focus on Escape, and never calls native confirm", async () => {
    const user = userEvent.setup();
    const longTitle = `${"very-long-authored-name-".repeat(8)}.md`;
    const doc = makeDocument({ title: longTitle });
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([doc]);
    const confirmSpy = vi.fn();
    Object.defineProperty(window, "confirm", { configurable: true, value: confirmSpy });
    renderGermanPage();

    const deleteButton = await screen.findByRole("button", { name: `${longTitle} löschen` });
    expect(screen.getByText(longTitle)).toHaveAttribute("title", longTitle);
    await user.click(deleteButton);
    expect(screen.getByRole("dialog", { name: `${longTitle} löschen?` })).toHaveTextContent("Diese Aktion ist endgültig und kann nicht rückgängig gemacht werden.");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(knowledgeApi.deleteKnowledgeDocument).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: `${longTitle} löschen?` })).not.toBeInTheDocument());
    await waitFor(() => expect(deleteButton).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Einfügen" }));
    expect(screen.getByRole("dialog", { name: "Notiz einfügen" })).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Titel der Notiz" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores a failed optimistic deletion at its exact index without losing a concurrent upload", async () => {
    const user = userEvent.setup();
    const first = makeDocument({ id: "doc-first", title: "FIRST.md" });
    const second = makeDocument({ id: "doc-second", title: "SECOND.md" });
    const added = makeDocument({ id: "doc-added", title: "ADDED.md", sourceType: "upload" });
    const uploadFile = new File(["new"], added.title, { type: "text/markdown" });
    let rejectDelete: ((reason: Error) => void) | undefined;
    let resolveUpload: ((result: KnowledgeUploadResult) => void) | undefined;
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([first, second]);
    knowledgeApi.deleteKnowledgeDocument.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectDelete = reject;
    }));
    knowledgeApi.uploadKnowledgeFiles.mockImplementationOnce(() => new Promise<KnowledgeUploadResult>((resolve) => {
      resolveUpload = resolve;
    }));
    renderGermanPage();

    const library = await screen.findByRole("heading", { name: first.title });
    const grid = library.closest("[aria-labelledby='knowledge-library-heading']");
    if (!grid) throw new Error("Knowledge document grid not found");
    fireEvent.drop(grid, { dataTransfer: { files: [uploadFile] } });
    expect(knowledgeApi.uploadKnowledgeFiles).toHaveBeenCalledWith("project-current", [uploadFile]);

    await user.click(await screen.findByRole("button", { name: `${first.title} löschen` }));
    await holdToConfirm("Dokument löschen");
    expect(knowledgeApi.deleteKnowledgeDocument).toHaveBeenCalledWith("project-current", first.id);
    expect(screen.getByRole("dialog", { name: `${first.title} löschen?` }).querySelector("[aria-busy='true']")).toBeInTheDocument();
    expect(await screen.findByText(`${first.title} wird gelöscht…`)).toBeInTheDocument();

    await act(async () => resolveUpload?.({ documents: [added], errors: [] }));
    expect(await screen.findByText("1 Dokument hinzugefügt.")).toBeInTheDocument();

    await act(async () => rejectDelete?.(new Error("Raw delete diagnostic")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Raw delete diagnostic");
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-document-id]"));
    expect(rows.map((row) => row.dataset.documentId)).toEqual([first.id, second.id, added.id]);
    expect(screen.getByRole("button", { name: "Löschen erneut versuchen" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: `${first.title} löschen` })).toHaveFocus());
  });

  it("focuses the next document after a successful irreversible deletion", async () => {
    const user = userEvent.setup();
    const first = makeDocument({ id: "doc-first", title: "FIRST.md" });
    const second = makeDocument({ id: "doc-second", title: "SECOND.md" });
    knowledgeApi.fetchKnowledgeDocuments.mockResolvedValue([first, second]);
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: `${first.title} löschen` }));
    await holdToConfirm("Dokument löschen");

    await waitFor(() => expect(screen.queryByRole("heading", { name: first.title })).not.toBeInTheDocument());
    const nextHeading = screen.getByRole("heading", { name: second.title });
    await waitFor(() => expect(nextHeading).toHaveFocus());
    expect(knowledgeApi.deleteKnowledgeDocument).toHaveBeenCalledTimes(1);
  });

  it("shows selected-file progress and separates successful and failed upload results with retry", async () => {
    const user = userEvent.setup();
    const successfulFile = new File(["good"], "GOOD.md", { type: "text/markdown" });
    const failedFile = new File(["bad"], "RAW_Ä.bin", { type: "application/octet-stream" });
    let resolveUpload: ((result: KnowledgeUploadResult) => void) | undefined;
    knowledgeApi.uploadKnowledgeFiles.mockImplementationOnce(() => new Promise<KnowledgeUploadResult>((resolve) => {
      resolveUpload = resolve;
    }));
    renderGermanPage();

    await user.click(await screen.findByRole("button", { name: "Hochladen" }));
    await user.upload(screen.getByLabelText("Wissensdateien auswählen"), [successfulFile, failedFile]);
    expect(screen.getByRole("progressbar", { name: `Upload-Fortschritt für ${successfulFile.name}` })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: `Upload-Fortschritt für ${failedFile.name}` })).toBeInTheDocument();

    await act(async () => resolveUpload?.({
      documents: [makeDocument({ id: "uploaded-good", title: successfulFile.name, sourceType: "upload" })],
      errors: [{ fileName: failedFile.name, error: "Unsupported MIME application/octet-stream" }],
    }));

    expect(await screen.findByText("Hochgeladen")).toBeInTheDocument();
    expect(screen.getAllByText(successfulFile.name).length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent(`${failedFile.name}Unsupported MIME application/octet-stream`);
    const retryButton = screen.getByRole("button", { name: "1 fehlgeschlagene Datei erneut versuchen" });
    knowledgeApi.uploadKnowledgeFiles.mockResolvedValueOnce({
      documents: [makeDocument({ id: "uploaded-retry", title: failedFile.name, sourceType: "upload" })],
      errors: [],
    });
    await user.click(retryButton);
    expect(knowledgeApi.uploadKnowledgeFiles).toHaveBeenLastCalledWith("project-current", [failedFile]);
  });
});
