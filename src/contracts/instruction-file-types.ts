/**
 * Project-level agent instruction markdown files (AGENTS.md, CLAUDE.md,
 * GEMINI.md, …) that live at the repo root and are edited from the Agents page.
 *
 * The set of editable files is a fixed, server-owned catalogue keyed by `id`.
 * Clients only ever send the catalogue `id` — never a raw path — so there is no
 * way to read or write outside the curated list.
 */
export interface InstructionFileDescriptor {
  /** Stable catalogue id used in API routes (e.g. "claude"). */
  id: string;
  /** Display label, e.g. "CLAUDE.md". */
  label: string;
  /** Canonical filename written when the file does not yet exist. */
  fileName: string;
  /** Path relative to the project root where the canonical file lives. */
  relativePath: string;
  /** One-line description of what the file controls. */
  description: string;
  /** Associated provider brand id for iconography, when applicable. */
  providerId?: string;
}

export interface InstructionFileSummary extends InstructionFileDescriptor {
  /** Whether a matching file currently exists on disk. */
  exists: boolean;
  /** Byte size of the file (0 when missing). */
  size: number;
  /** ISO modification timestamp, or null when missing. */
  updatedAt: string | null;
}

export interface InstructionFileContent extends InstructionFileSummary {
  /** Full UTF-8 file contents ("" when the file does not exist yet). */
  content: string;
}
