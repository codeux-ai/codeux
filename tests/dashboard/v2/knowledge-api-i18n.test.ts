// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  searchKnowledge,
  uploadKnowledgeFiles,
  type KnowledgeSearchResult,
} from "../../../dashboard/src/v2/lib/knowledge-api.js";

describe("Knowledge API localization boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns search response data verbatim", async () => {
    const rawResults: KnowledgeSearchResult[] = [{
      documentId: "dokument-ä",
      documentTitle: "docs/RAW_Überblick.md",
      chunkIndex: 7,
      heading: "Untranslated <Heading>",
      content: "const byteCompatible = 'ä';",
      similarity: 0.875,
    }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(rawResults), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchKnowledge("projekt/ä", {
      query: "raw query",
      agentPresetId: "agent/one",
      limit: 6,
    })).resolves.toEqual(rawResults);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/projekt%2F%C3%A4/knowledge/search", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ query: "raw query", agentPresetId: "agent/one", limit: 6 }),
    }));
  });

  it("throws upload API error text verbatim", async () => {
    const rawError = "Ungültiger MIME-Typ text/x-raw für RAW_Ä.md";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: rawError }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(uploadKnowledgeFiles("project-1", [
      new File(["raw"], "RAW_Ä.md", { type: "text/x-raw" }),
    ])).rejects.toThrow(rawError);
  });

  it("returns partial upload filenames, documents, and diagnostics verbatim", async () => {
    const rawResult = {
      documents: [{ id: "doc-ä", title: "GOOD_Überblick.md" }],
      errors: [{ fileName: "RAW_Ä.bin", error: "Unsupported MIME application/x-raw <diagnostic>" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(rawResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const files = [
      new File(["good"], "GOOD_Überblick.md", { type: "text/markdown" }),
      new File(["raw"], "RAW_Ä.bin", { type: "application/x-raw" }),
    ];

    await expect(uploadKnowledgeFiles("project/ä", files)).resolves.toEqual(rawResult);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/project%2F%C3%A4/knowledge/documents/upload", expect.objectContaining({
      method: "POST",
      body: expect.any(FormData),
    }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as FormData;
    expect(form.getAll("files").map((entry) => (entry as File).name)).toEqual(files.map((file) => file.name));
  });
});
