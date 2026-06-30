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

    it("decodes HTML entities exactly once (no double-unescaping)", async () => {
      const result = await service.extractText({
        fileName: "entities.html",
        mimeType: "text/html",
        buffer: Buffer.from("<p>A &amp;lt; B &amp; C &lt;tag&gt;</p>"),
      });
      // &amp;lt; must decode to the literal text "&lt;", NOT to "<".
      expect(result.text).toContain("A &lt; B & C <tag>");
      expect(result.text).not.toContain("A < B");
    });

    it("drops unterminated raw-text elements without leaking their content", async () => {
      const result = await service.extractText({
        fileName: "broken.html",
        mimeType: "text/html",
        buffer: Buffer.from("<p>Visible</p><script>secret(); /* never closed"),
      });
      expect(result.text).toContain("Visible");
      expect(result.text).not.toContain("secret()");
    });

    it("ignores '>' inside HTML comments", async () => {
      const result = await service.extractText({
        fileName: "comment.html",
        mimeType: "text/html",
        buffer: Buffer.from("<p>Before<!-- a > b --><span>After</span></p>"),
      });
      expect(result.text).toContain("Before");
      expect(result.text).toContain("After");
      expect(result.text).not.toContain("a > b");
    });

    it("strips adversarial markup in linear time (ReDoS guard)", async () => {
      // Many unclosed `<script` tags would force quadratic backtracking in the
      // old regex stripper. This must complete near-instantly.
      const malicious = `<script`.repeat(200_000);
      const start = Date.now();
      const result = await service.extractText({
        fileName: "evil.html",
        mimeType: "text/html",
        buffer: Buffer.from(`<p>ok</p>${malicious}`),
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(result.text).toContain("ok");
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

    it("handles a pathological bracket-heavy line in linear time (ReDoS guard)", () => {
      const malicious = "[".repeat(200_000);
      const start = Date.now();
      const summary = service.summarize(malicious, "Title");
      expect(Date.now() - start).toBeLessThan(1000);
      expect(summary.length).toBeLessThanOrEqual(160);
    });
  });
});
