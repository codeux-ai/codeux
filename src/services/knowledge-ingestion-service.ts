import * as path from "path";
import type { Logger } from "../shared/logging/logger.js";
import type { KnowledgeChunkInput } from "../contracts/knowledge-types.js";
import { estimateTokens } from "./embedding-vector-utils.js";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB upload cap
const MAX_CHARS = 4_000_000; // ~1M tokens of extracted text cap
const MAX_CHUNK_CHARS = 1400; // ~350 tokens — comfortably under the 512-token model limit
const OVERLAP_CHARS = 200;

/** Text-extractable extensions read directly as UTF-8 (code, config, data, docs). */
const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".adoc",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".env", ".csv", ".tsv", ".xml",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".scala", ".sh",
  ".bash", ".zsh", ".sql", ".css", ".scss", ".less", ".vue", ".svelte", ".astro",
  ".graphql", ".proto", ".dockerfile", ".tf", ".lua", ".r", ".dart", ".ex", ".exs",
]);

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export interface ExtractTextInput {
  fileName: string;
  mimeType?: string | null;
  buffer: Buffer;
}

export interface ExtractedDocument {
  text: string;
  mimeType: string;
}

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

/**
 * Extracts plain text from uploaded/repo files and splits it into embedding-sized chunks.
 * Binary formats (PDF, DOCX) are parsed via lazily-imported libraries so they are only loaded
 * when actually needed.
 */
export class KnowledgeIngestionService {
  constructor(private readonly logger: Logger) {}

  async extractText(input: ExtractTextInput): Promise<ExtractedDocument> {
    if (input.buffer.byteLength > MAX_BYTES) {
      throw new UnsupportedDocumentError(`File is too large (${Math.round(input.buffer.byteLength / 1024 / 1024)} MB). Limit is ${MAX_BYTES / 1024 / 1024} MB.`);
    }

    const ext = path.extname(input.fileName).toLowerCase();
    const mime = (input.mimeType || "").toLowerCase();

    let text: string;
    let mimeType: string;

    if (ext === ".pdf" || mime === "application/pdf") {
      text = await this.extractPdf(input.buffer);
      mimeType = "application/pdf";
    } else if (ext === ".docx" || mime.includes("officedocument.wordprocessingml")) {
      text = await this.extractDocx(input.buffer);
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (HTML_EXTENSIONS.has(ext) || mime.includes("text/html")) {
      text = stripHtml(input.buffer.toString("utf8"));
      mimeType = "text/html";
    } else if (TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/") || this.looksLikeText(input.buffer)) {
      text = input.buffer.toString("utf8");
      mimeType = mime || "text/plain";
    } else {
      throw new UnsupportedDocumentError(`Unsupported file type: ${ext || mime || "unknown"}. Supported: text, markdown, code, JSON/YAML/CSV, HTML, PDF, DOCX.`);
    }

    const normalized = stripNullBytes(text).replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      throw new UnsupportedDocumentError("No readable text could be extracted from this document.");
    }
    return { text: normalized.slice(0, MAX_CHARS), mimeType };
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    let parser: PdfTextParser | null = null;
    try {
      const { PDFParse } = await import("pdf-parse");
      parser = new PDFParse({ data: new Uint8Array(buffer) }) as unknown as PdfTextParser;
      const result = await parser.getText();
      return result.text ?? "";
    } catch (error) {
      this.logger.warn(`PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnsupportedDocumentError("Could not read this PDF. It may be scanned/image-only or corrupted.");
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    try {
      const specifier = "mammoth";
      const mod = (await import(specifier)) as { default?: unknown } & Record<string, unknown>;
      const mammoth = (mod.default ?? mod) as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? "";
    } catch (error) {
      this.logger.warn(`DOCX extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnsupportedDocumentError("Could not read this Word document. It may be corrupted.");
    }
  }

  /** Heuristic: treat a buffer as text if it has no NUL bytes in the first 8 KB. */
  private looksLikeText(buffer: Buffer): boolean {
    const sample = buffer.subarray(0, 8192);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return false;
    }
    return sample.length > 0;
  }

  /** Splits extracted text into heading-aware, overlapping chunks sized for the embedding model. */
  chunkText(text: string): KnowledgeChunkInput[] {
    const blocks = toHeadedBlocks(text);
    const chunks: KnowledgeChunkInput[] = [];
    let curText = "";
    let curHeading: string | null = null;

    const push = () => {
      const content = curText.trim();
      if (!content) return;
      chunks.push({ chunkIndex: chunks.length, content, tokenCount: estimateTokens(content), heading: curHeading });
    };

    for (const block of blocks) {
      // A single oversized block is hard-split.
      if (block.text.length > MAX_CHUNK_CHARS) {
        push();
        curText = "";
        let start = 0;
        while (start < block.text.length) {
          const piece = block.text.slice(start, start + MAX_CHUNK_CHARS).trim();
          if (piece) {
            chunks.push({ chunkIndex: chunks.length, content: piece, tokenCount: estimateTokens(piece), heading: block.heading });
          }
          start += MAX_CHUNK_CHARS - OVERLAP_CHARS;
        }
        curHeading = null;
        continue;
      }

      if (curText && curText.length + block.text.length + 2 > MAX_CHUNK_CHARS) {
        push();
        const tail = curText.slice(-OVERLAP_CHARS);
        curText = tail ? `${tail}\n\n` : "";
        curHeading = block.heading;
      }

      if (!curText) curHeading = block.heading;
      curText += (curText ? "\n\n" : "") + block.text;
    }
    push();

    if (chunks.length === 0 && text.trim()) {
      const content = text.trim().slice(0, MAX_CHUNK_CHARS);
      chunks.push({ chunkIndex: 0, content, tokenCount: estimateTokens(content), heading: null });
    }
    return chunks;
  }

  /** Builds a one-line summary for the agent manifest from the document's first meaningful content. */
  summarize(text: string, title: string): string {
    const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    let firstHeading = "";
    let firstContent = "";
    for (const line of lines) {
      const heading = line.match(/^#{1,6}\s+(.*)/);
      if (heading) {
        if (!firstHeading) firstHeading = heading[1].trim();
        continue;
      }
      firstContent = line;
      break;
    }
    const base = firstContent || firstHeading || title;
    const clean = base
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}…` : clean;
  }
}

interface PdfTextParser {
  getText: () => Promise<{ text: string }>;
  destroy: () => Promise<void>;
}

interface HeadedBlock {
  heading: string | null;
  text: string;
}

function stripNullBytes(text: string): string {
  return text.replace(/\u0000/g, "");
}

function toHeadedBlocks(text: string): HeadedBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: HeadedBlock[] = [];
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join("\n").trim();
    if (joined) blocks.push({ heading: currentHeading, text: joined });
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) {
      flush();
      currentHeading = heading[1].trim() || currentHeading;
      continue;
    }
    if (line.trim() === "") {
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}
