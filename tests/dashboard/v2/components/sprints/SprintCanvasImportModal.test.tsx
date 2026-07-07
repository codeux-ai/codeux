/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintCanvasImportModal, type CanvasImportProvider } from "../../../../../dashboard/src/v2/components/sprints/SprintCanvasImportModal";
import {
  fetchProjectIssuePromptContexts,
  searchProjectIssues,
} from "../../../../../dashboard/src/v2/lib/project-api";
import { fetchProjectEffectiveSettings } from "../../../../../dashboard/src/v2/lib/settings-api";

expect.extend(matchers);

vi.mock("../../../../../dashboard/src/v2/lib/project-api", () => ({
  searchProjectIssues: vi.fn(),
  fetchProjectIssuePromptContexts: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/lib/settings-api", () => ({
  fetchProjectEffectiveSettings: vi.fn(),
}));

const blankImporterSettings = {
  enabled: true,
  apiToken: "token",
  apiSecret: "",
  baseUrl: "",
  workspaceId: "",
  teamId: "",
  teamKey: "",
  projectId: "",
  databaseId: "",
  boardId: "",
  documentId: "",
  fileKey: "",
  defaultSearchLimit: 25,
};

const providerResult = (provider: CanvasImportProvider, overrides: Record<string, unknown> = {}) => {
  const sourceKind = provider === "miro" ? "board" : provider === "lucid" ? "document" : provider === "figma" ? "file" : "canvas";
  const externalId = `${provider}-external-1`;
  return {
    provider,
    sourceProvider: provider,
    sourceKind,
    externalId,
    hostDomain: provider === "mural" ? "app.mural.co" : `${provider}.com`,
    repository: provider === "miro" ? "board-1" : provider === "mural" ? "workspace-1" : "documents",
    issueNumber: null,
    issueKey: `${provider.toUpperCase()}-1`,
    title: `${provider} imported scope`,
    url: `https://example.test/${provider}/${externalId}`,
    state: "open",
    labels: [sourceKind],
    assignees: [],
    bodyPreview: `${provider} preview`,
    createdAt: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    issueAuthor: null,
    issueReporter: null,
    issueMilestone: null,
    issueType: sourceKind,
    issuePriority: null,
    issueCommentCount: provider === "figma" ? 2 : null,
    ...overrides,
  };
};

const renderModal = (provider: CanvasImportProvider, onImport = vi.fn()) => {
  vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
    settings: {
      [provider]: blankImporterSettings,
    },
  } as any);
  return {
    onImport,
    ...render(
      <SprintCanvasImportModal
        projectId="proj-1"
        provider={provider}
        onClose={vi.fn()}
        onImport={onImport}
      />,
    ),
  };
};

describe("SprintCanvasImportModal", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(searchProjectIssues).mockResolvedValue([]);
    vi.mocked(fetchProjectIssuePromptContexts).mockImplementation(async (_projectId, issues) => issues as any);
  });

  it("validates provider-required identifiers before search", async () => {
    renderModal("figma");

    fireEvent.click(await screen.findByRole("button", { name: /search figma/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Paste a Figma or FigJam file key before searching.");
    expect(searchProjectIssues).not.toHaveBeenCalled();
  });

  it.each([
    ["miro", "Miro board ID", "board-123", { boardId: "board-123", limit: 25 }],
    ["lucid", "Lucid document ID", "doc-123", { documentId: "doc-123", limit: 25 }],
    ["figma", "Figma file key", "file-123", { fileKey: "file-123", includeConversation: false, limit: 25 }],
    ["mural", "Mural workspace ID", "workspace-123", { workspaceId: "workspace-123", limit: 25 }],
  ] as const)("sends %s search payloads with canvas fields", async (provider, label, value, expected) => {
    renderModal(provider);

    fireEvent.input(await screen.findByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`search ${provider === "figma" ? "figma" : provider}`, "i") }));

    await waitFor(() => expect(searchProjectIssues).toHaveBeenCalledTimes(1));
    expect(searchProjectIssues).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        provider,
        ...expected,
      }),
      expect.any(AbortSignal),
    );
  });

  it("imports selected canvas results with externalId and sourceKind preserved", async () => {
    const onImport = vi.fn();
    const result = providerResult("miro", { sourceKind: "board", externalId: "board-123", title: "Miro board" });
    vi.mocked(searchProjectIssues).mockResolvedValue([result] as any);
    renderModal("miro", onImport);

    fireEvent.input(await screen.findByLabelText("Miro board ID"), { target: { value: "board-123" } });
    fireEvent.click(screen.getByRole("button", { name: /search miro/i }));
    fireEvent.click(await screen.findByText("Miro board"));
    fireEvent.click(screen.getByRole("button", { name: /import selected miro scope/i }));

    await waitFor(() => expect(fetchProjectIssuePromptContexts).toHaveBeenCalledTimes(1));
    expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith(
      "proj-1",
      [expect.objectContaining({
        externalId: "board-123",
        sourceKind: "board",
        sourceProvider: "miro",
        includeConversation: false,
      })],
    );
    await waitFor(() => expect(onImport).toHaveBeenCalledWith([
      expect.objectContaining({ externalId: "board-123", sourceKind: "board" }),
    ]));
  });

  it("supports Figma comment search and per-card comment import toggles", async () => {
    const result = providerResult("figma", { externalId: "file-123", title: "FigJam file" });
    vi.mocked(searchProjectIssues).mockResolvedValue([result] as any);
    renderModal("figma");

    fireEvent.input(await screen.findByLabelText("Figma file key"), { target: { value: "file-123" } });
    fireEvent.click(screen.getByRole("button", { name: /advanced figma/i }));
    const searchCommentToggle = screen.getByLabelText("Append comments while searching Figma files");
    fireEvent.click(searchCommentToggle);
    await waitFor(() => expect(searchCommentToggle).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: /search figma/i }));

    await waitFor(() => expect(searchProjectIssues).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ provider: "figma", fileKey: "file-123", includeConversation: true }),
      expect.any(AbortSignal),
    ));

    fireEvent.click(await screen.findByText("FigJam file"));
    const commentToggles = screen.getAllByLabelText(/append comments/i);
    fireEvent.click(commentToggles[1]);
    fireEvent.click(screen.getByRole("button", { name: /import selected figma/i }));

    await waitFor(() => expect(fetchProjectIssuePromptContexts).toHaveBeenCalledWith(
      "proj-1",
      [expect.objectContaining({ externalId: "file-123", sourceKind: "file", includeConversation: false })],
    ));
  });

  it("shows Mural limited metadata messaging", async () => {
    renderModal("mural");

    expect(await screen.findAllByText(/Mural public API support is limited/i)).toHaveLength(2);
  });

  it.each([
    ["miro", "Miro board ID", "board-123", "Miro backend error"],
    ["lucid", "Lucid document ID", "doc-123", "Lucid backend error"],
    ["figma", "Figma file key", "file-123", "Figma backend error"],
    ["mural", "Mural workspace ID", "workspace-123", "Mural backend error"],
  ] as const)("displays backend errors for %s", async (provider, label, value, message) => {
    vi.mocked(searchProjectIssues).mockRejectedValueOnce(new Error(message));
    renderModal(provider);

    fireEvent.input(await screen.findByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`search ${provider === "figma" ? "figma" : provider}`, "i") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
