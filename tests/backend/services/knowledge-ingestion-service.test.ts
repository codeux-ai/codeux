import { describe, expect, it } from "vitest";
import { KnowledgeIngestionService, UnsupportedDocumentError } from "../../../src/services/knowledge-ingestion-service.js";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as any;

const service = new KnowledgeIngestionService(noopLogger);

describe("KnowledgeIngestionService", () => {
  describe("extractText", () => {
    it("decodes plain text and markdown", async () => {
      const result = await service.extractText({
        fileName: "notes.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Title\n\nHello world"),
      });
      expect(result.text).toContain("Hello world");
    });

    it("strips HTML tags", async () => {
      const result = await service.extractText({
        fileName: "page.html",
        mimeType: "text/html",
        buffer: Buffer.from("<html><body><h1>Heading</h1><p>Body text</p><script>ignore()</script></body></html>"),
      });
      expect(result.text).toContain("Heading");
      expect(result.text).toContain("Body text");
      expect(result.text).not.toContain("ignore()");
      expect(result.text).not.toContain("<p>");
    });

    it("rejects unsupported binary content", async () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0xfe]);
      await expect(
        service.extractText({ fileName: "blob.bin", mimeType: "application/octet-stream", buffer: binary }),
      ).rejects.toBeInstanceOf(UnsupportedDocumentError);
    });

    it("rejects empty documents", async () => {
      await expect(
        service.extractText({ fileName: "empty.txt", mimeType: "text/plain", buffer: Buffer.from("   \n  ") }),
      ).rejects.toBeInstanceOf(UnsupportedDocumentError);
    });
  });

  describe("chunkText", () => {
    it("produces heading-aware chunks", () => {
      const text = "# Intro\n\nFirst paragraph about setup.\n\n## Usage\n\nSecond paragraph about usage.";
      const chunks = service.chunkText(text);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].heading).toBe("Intro");
      expect(chunks.every((c) => c.content.length > 0)).toBe(true);
      expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    });

    it("hard-splits a single oversized block", () => {
      const huge = "word ".repeat(2000); // ~10k chars, no paragraph breaks
      const chunks = service.chunkText(huge);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((c) => c.content.length <= 1400)).toBe(true);
    });

    it("returns a single chunk for short text", () => {
      const chunks = service.chunkText("Just a short note.");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe("Just a short note.");
    });
  });

  describe("summarize", () => {
    it("uses the first content line, stripped of markdown", () => {
      const summary = service.summarize("# Heading\n\nThis is the **first** sentence of the doc.", "Title");
      expect(summary).toBe("This is the first sentence of the doc.");
    });

    it("falls back to the heading then the title", () => {
      expect(service.summarize("# Only a heading", "Fallback")).toBe("Only a heading");
      expect(service.summarize("", "Fallback Title")).toBe("Fallback Title");
    });

    it("truncates long summaries", () => {
      const summary = service.summarize("x".repeat(400), "Title");
      expect(summary.length).toBeLessThanOrEqual(160);
      expect(summary.endsWith("…")).toBe(true);
    });
  });
});
