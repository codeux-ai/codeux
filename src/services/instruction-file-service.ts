import * as fs from "fs/promises";
import * as path from "path";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type {
  InstructionFileContent,
  InstructionFileDescriptor,
  InstructionFileSummary,
} from "../contracts/instruction-file-types.js";
import type { Logger } from "../shared/logging/logger.js";

/** Hard ceiling on instruction file size to avoid accidental huge writes. */
const MAX_INSTRUCTION_BYTES = 1_000_000;

interface CatalogEntry extends InstructionFileDescriptor {
  /** Additional relative paths (case variants) that count as the same file. */
  aliases?: string[];
}

/**
 * Server-owned catalogue of editable agent instruction files. Order here drives
 * display order in the dashboard. Aliases let us pick up existing files written
 * with a different case (e.g. `claude.md`) instead of creating a duplicate.
 */
const INSTRUCTION_FILE_CATALOG: readonly CatalogEntry[] = [
  {
    id: "agents",
    label: "AGENTS.md",
    fileName: "AGENTS.md",
    relativePath: "AGENTS.md",
    aliases: ["agents.md", "Agents.md"],
    description: "Shared playbook for Codex, OpenCode, and general coding agents.",
    providerId: "codex",
  },
  {
    id: "claude",
    label: "CLAUDE.md",
    fileName: "CLAUDE.md",
    relativePath: "CLAUDE.md",
    aliases: ["claude.md", "Claude.md"],
    description: "Project instructions loaded by Claude and Claude Code.",
    providerId: "claude-code",
  },
  {
    id: "gemini",
    label: "GEMINI.md",
    fileName: "GEMINI.md",
    relativePath: "GEMINI.md",
    aliases: ["gemini.md", "Gemini.md"],
    description: "Project instructions loaded by the Gemini CLI.",
    providerId: "gemini",
  },
  {
    id: "qwen",
    label: "QWEN.md",
    fileName: "QWEN.md",
    relativePath: "QWEN.md",
    aliases: ["qwen.md", "Qwen.md"],
    description: "Project instructions loaded by Qwen Code.",
    providerId: "qwen-code",
  },
  {
    id: "copilot",
    label: "copilot-instructions.md",
    fileName: "copilot-instructions.md",
    relativePath: path.join(".github", "copilot-instructions.md"),
    description: "Custom instructions for GitHub Copilot.",
    providerId: "github",
  },
];

export interface InstructionFileServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  logger?: Logger;
}

interface ResolvedFile {
  absolutePath: string;
  relativePath: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
}

/**
 * Reads and writes the curated set of project-root agent instruction files.
 * All paths are derived from {@link INSTRUCTION_FILE_CATALOG}, resolved within
 * the project's base directory, and verified to stay inside it.
 */
export class InstructionFileService {
  constructor(private readonly deps: InstructionFileServiceDeps) {}

  async listInstructionFiles(projectId: string): Promise<InstructionFileSummary[]> {
    const baseDir = this.requireProjectBaseDir(projectId);
    const summaries: InstructionFileSummary[] = [];
    for (const entry of INSTRUCTION_FILE_CATALOG) {
      const resolved = await this.resolveFile(baseDir, entry);
      summaries.push(this.toSummary(entry, resolved));
    }
    return summaries;
  }

  async readInstructionFile(projectId: string, fileId: string): Promise<InstructionFileContent> {
    const baseDir = this.requireProjectBaseDir(projectId);
    const entry = this.requireEntry(fileId);
    const resolved = await this.resolveFile(baseDir, entry);
    let content = "";
    if (resolved.exists) {
      content = await fs.readFile(resolved.absolutePath, "utf8");
    }
    return { ...this.toSummary(entry, resolved), content };
  }

  async writeInstructionFile(
    projectId: string,
    fileId: string,
    content: string,
  ): Promise<InstructionFileContent> {
    if (typeof content !== "string") {
      throw new Error("Instruction file content must be a string.");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_INSTRUCTION_BYTES) {
      throw new Error(`Instruction file exceeds the ${MAX_INSTRUCTION_BYTES.toLocaleString()} byte limit.`);
    }
    const baseDir = this.requireProjectBaseDir(projectId);
    const entry = this.requireEntry(fileId);
    const resolved = await this.resolveFile(baseDir, entry);
    const target = resolved.absolutePath;
    this.assertInside(baseDir, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    this.deps.logger?.info?.(`Wrote instruction file ${entry.label} for project ${projectId}`);
    const stat = await this.statFile(target);
    return {
      ...this.toSummary(entry, {
        absolutePath: target,
        relativePath: path.relative(baseDir, target),
        ...stat,
      }),
      content,
    };
  }

  private requireProjectBaseDir(projectId: string): string {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project || !project.baseDir) {
      throw new Error(`Project ${projectId} not found or has no base directory.`);
    }
    return project.baseDir;
  }

  private requireEntry(fileId: string): CatalogEntry {
    const entry = INSTRUCTION_FILE_CATALOG.find((candidate) => candidate.id === fileId);
    if (!entry) {
      throw new Error(`Unknown instruction file: ${fileId}`);
    }
    return entry;
  }

  private candidatePaths(baseDir: string, entry: CatalogEntry): string[] {
    return [entry.relativePath, ...(entry.aliases ?? [])].map((relative) =>
      path.resolve(baseDir, relative),
    );
  }

  /** Picks the first existing candidate, falling back to the canonical path. */
  private async resolveFile(baseDir: string, entry: CatalogEntry): Promise<ResolvedFile> {
    const candidates = this.candidatePaths(baseDir, entry);
    for (const candidate of candidates) {
      const stat = await this.statFile(candidate);
      if (stat.exists) {
        const actualPath = await this.resolveExistingPathCase(baseDir, candidate);
        return { absolutePath: actualPath, relativePath: path.relative(baseDir, actualPath), ...stat };
      }
    }
    const canonical = candidates[0];
    return {
      absolutePath: canonical,
      relativePath: path.relative(baseDir, canonical),
      exists: false,
      size: 0,
      updatedAt: null,
    };
  }

  private async resolveExistingPathCase(baseDir: string, absolutePath: string): Promise<string> {
    const relative = path.relative(baseDir, absolutePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return absolutePath;
    }

    let current = baseDir;
    for (const segment of relative.split(path.sep)) {
      if (!segment) {
        continue;
      }
      try {
        const entries = await fs.readdir(current);
        const exact = entries.find((entry) => entry === segment);
        const caseInsensitive = exact ?? entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
        current = path.join(current, caseInsensitive ?? segment);
      } catch {
        return absolutePath;
      }
    }
    return current;
  }

  private async statFile(absolutePath: string): Promise<{ exists: boolean; size: number; updatedAt: string | null }> {
    try {
      const stat = await fs.stat(absolutePath);
      return { exists: stat.isFile(), size: stat.size, updatedAt: stat.mtime.toISOString() };
    } catch {
      return { exists: false, size: 0, updatedAt: null };
    }
  }

  private assertInside(baseDir: string, target: string): void {
    const relative = path.relative(path.resolve(baseDir), target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Resolved instruction file path escapes the project directory.");
    }
  }

  private toSummary(entry: CatalogEntry, resolved: ResolvedFile): InstructionFileSummary {
    return {
      id: entry.id,
      label: entry.label,
      fileName: entry.fileName,
      relativePath: resolved.relativePath.split(path.sep).join("/"),
      description: entry.description,
      providerId: entry.providerId,
      exists: resolved.exists,
      size: resolved.size,
      updatedAt: resolved.updatedAt,
    };
  }
}
