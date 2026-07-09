import * as fs from "fs/promises";
import * as path from "path";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ValidationError } from "../repositories/repository-utils.js";
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

interface ResolvedProjectBase {
  realPath: string;
}

interface ResolvedInstructionFile {
  entry: CatalogEntry;
  file: ResolvedFile;
}

/**
 * Reads and writes the curated set of project-root agent instruction files.
 * All paths are derived from {@link INSTRUCTION_FILE_CATALOG}, resolved within
 * the project's base directory, and verified to stay inside it.
 */
export class InstructionFileService {
  constructor(private readonly deps: InstructionFileServiceDeps) {}

  async listInstructionFiles(projectId: string): Promise<InstructionFileSummary[]> {
    const projectBase = await this.resolveProjectBase(projectId);
    const summaries: InstructionFileSummary[] = [];
    for (const entry of INSTRUCTION_FILE_CATALOG) {
      const resolved = await this.resolveInstructionFile(projectBase, entry.id);
      summaries.push(this.toSummary(resolved.entry, resolved.file));
    }
    return summaries;
  }

  async readInstructionFile(projectId: string, fileId: string): Promise<InstructionFileContent> {
    const projectBase = await this.resolveProjectBase(projectId);
    const { entry, file } = await this.resolveInstructionFile(projectBase, fileId);
    let content = "";
    if (file.exists) {
      await this.assertExistingTargetContained(projectBase, file.absolutePath);
      content = await fs.readFile(file.absolutePath, "utf8");
    }
    return { ...this.toSummary(entry, file), content };
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
      throw new ValidationError(`Invalid instruction file content: exceeds the ${MAX_INSTRUCTION_BYTES.toLocaleString()} byte limit.`);
    }
    const projectBase = await this.resolveProjectBase(projectId);
    const { entry, file } = await this.resolveInstructionFile(projectBase, fileId);
    const target = file.absolutePath;
    await this.assertWritableTargetContained(projectBase, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.assertWritableTargetContained(projectBase, target);
    await fs.writeFile(target, content, "utf8");
    this.deps.logger?.info?.(`Wrote instruction file ${entry.label} for project ${projectId}`);
    const stat = await this.statFile(projectBase, target);
    return {
      ...this.toSummary(entry, {
        absolutePath: target,
        relativePath: path.relative(projectBase.realPath, target),
        ...stat,
      }),
      content,
    };
  }

  private async resolveProjectBase(projectId: string): Promise<ResolvedProjectBase> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project || !project.baseDir) {
      throw new ValidationError("Missing project or base directory.");
    }
    try {
      const absolutePath = path.resolve(project.baseDir);
      const realPath = await fs.realpath(absolutePath);
      return { realPath };
    } catch {
      throw new ValidationError("Missing project or base directory.");
    }
  }

  private requireEntry(fileId: string): CatalogEntry {
    const entry = INSTRUCTION_FILE_CATALOG.find((candidate) => candidate.id === fileId);
    if (!entry) {
      throw new ValidationError("Invalid instruction file id.");
    }
    return entry;
  }

  private candidatePaths(projectBase: ResolvedProjectBase, entry: CatalogEntry): string[] {
    return [entry.relativePath, ...(entry.aliases ?? [])].map((relative) => {
      this.assertCatalogRelativePath(relative);
      const candidate = path.join(projectBase.realPath, relative);
      this.assertInside(projectBase.realPath, candidate, "catalog target");
      return candidate;
    });
  }

  /**
   * Single resolver for editable instruction files. File IDs must match the
   * static catalog; all filesystem paths come from catalog-owned relative paths.
   */
  private async resolveInstructionFile(
    projectBase: ResolvedProjectBase,
    fileId: string,
  ): Promise<ResolvedInstructionFile> {
    const entry = this.requireEntry(fileId);
    const candidates = this.candidatePaths(projectBase, entry);
    for (const candidate of candidates) {
      const stat = await this.statFile(projectBase, candidate);
      if (stat.exists) {
        const actualPath = await this.resolveExistingPathCase(projectBase.realPath, candidate);
        return {
          entry,
          file: {
            absolutePath: actualPath,
            relativePath: path.relative(projectBase.realPath, actualPath),
            ...stat,
          },
        };
      }
    }
    const canonical = candidates[0];
    return {
      entry,
      file: {
        absolutePath: canonical,
        relativePath: path.relative(projectBase.realPath, canonical),
        exists: false,
        size: 0,
        updatedAt: null,
      },
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

  private async statFile(
    projectBase: ResolvedProjectBase,
    absolutePath: string,
  ): Promise<{ exists: boolean; size: number; updatedAt: string | null }> {
    try {
      await fs.lstat(absolutePath);
      await this.assertExistingTargetContained(projectBase, absolutePath);
      const stat = await fs.stat(absolutePath);
      return { exists: stat.isFile(), size: stat.size, updatedAt: stat.mtime.toISOString() };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      return { exists: false, size: 0, updatedAt: null };
    }
  }

  private assertCatalogRelativePath(relativePath: string): void {
    if (
      !relativePath
      || path.isAbsolute(relativePath)
      || relativePath.split(/[\\/]/).some((segment) => segment === "..")
    ) {
      throw new ValidationError("Invalid instruction file catalog path.");
    }
  }

  private async assertExistingTargetContained(projectBase: ResolvedProjectBase, target: string): Promise<void> {
    let realTarget: string;
    try {
      realTarget = await fs.realpath(target);
    } catch {
      throw new ValidationError("Invalid instruction file path: symlink target cannot be resolved.");
    }
    this.assertInside(projectBase.realPath, realTarget, "symlink target");
  }

  private async assertWritableTargetContained(projectBase: ResolvedProjectBase, target: string): Promise<void> {
    try {
      await fs.lstat(target);
      await this.assertExistingTargetContained(projectBase, target);
      return;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    const parentDir = await this.findNearestExistingParent(target);
    try {
      const parentRealPath = await fs.realpath(parentDir);
      this.assertInside(projectBase.realPath, parentRealPath, "parent directory");
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError("Invalid instruction file path: parent directory cannot be resolved.");
    }
  }

  private async findNearestExistingParent(target: string): Promise<string> {
    let current = path.dirname(target);
    while (true) {
      try {
        await fs.lstat(current);
        return current;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw error;
        }
      }

      const parent = path.dirname(current);
      if (parent === current) {
        throw new ValidationError("Invalid instruction file path: parent directory cannot be resolved.");
      }
      current = parent;
    }
  }

  private assertInside(baseDir: string, target: string, label: string): void {
    const relative = path.relative(baseDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ValidationError(`Invalid instruction file path: ${label} escapes the project directory.`);
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
