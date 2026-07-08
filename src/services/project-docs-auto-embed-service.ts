import * as fs from "fs/promises";
import * as path from "path";
import type { Dirent } from "fs";
import type { KnowledgeService } from "./knowledge-service.js";

export interface ProjectDocsAutoEmbedError {
  fileName: string;
  error: string;
}

export interface ProjectDocsAutoEmbedResult {
  documentIds: string[];
  errors: ProjectDocsAutoEmbedError[];
}

export interface ProjectDocsAutoEmbedOptions {
  maxFiles?: number;
  maxTotalBytes?: number;
}

interface DiscoveredDocFile {
  absolutePath: string;
  relativePath: string;
}

interface DiscoveryState {
  realProjectRoot: string;
  files: Map<string, DiscoveredDocFile>;
  errors: ProjectDocsAutoEmbedError[];
  totalBytes: number;
  truncated: boolean;
}

const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const ROOT_DOC_PREFIXES = ["readme", "changelog", "contributing"];
const ROOT_ASSISTANT_DOCS = new Set(["agents.md", "gemini.md", "claude.md"]);
const DOCS_DIRECTORY_NAME = "docs";
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc", ".html", ".htm"]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".next",
  ".output",
]);

/**
 * Discovers project-authored documentation files and sends them through the shared
 * knowledge ingestion pipeline. This service intentionally stops at discovery and
 * file reading; extraction, dedupe, chunking, embedding, and status updates remain
 * centralized in KnowledgeService.
 */
export class ProjectDocsAutoEmbedService {
  private readonly maxFiles: number;
  private readonly maxTotalBytes: number;

  constructor(
    private readonly knowledgeService: Pick<KnowledgeService, "ingestDocument">,
    options: ProjectDocsAutoEmbedOptions = {},
  ) {
    this.maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES));
    this.maxTotalBytes = Math.max(1, Math.floor(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES));
  }

  async embedProjectDocs(projectId: string, projectBaseDir: string): Promise<ProjectDocsAutoEmbedResult> {
    const discovered = await this.discoverProjectDocs(projectBaseDir);
    const documentIds: string[] = [];
    const errors = [...discovered.errors];

    for (const file of discovered.files) {
      try {
        const buffer = await fs.readFile(file.absolutePath);
        const document = await this.knowledgeService.ingestDocument(projectId, {
          title: file.relativePath,
          sourceType: "repo_path",
          sourceRef: file.relativePath,
          buffer,
        });
        documentIds.push(document.id);
      } catch (error) {
        errors.push({ fileName: file.relativePath, error: toErrorMessage(error, "Failed to ingest file") });
      }
    }

    return { documentIds, errors };
  }

  private async discoverProjectDocs(projectBaseDir: string): Promise<{ files: DiscoveredDocFile[]; errors: ProjectDocsAutoEmbedError[] }> {
    let realProjectRoot: string;
    try {
      realProjectRoot = await fs.realpath(path.resolve(projectBaseDir));
      const stat = await fs.stat(realProjectRoot);
      if (!stat.isDirectory()) {
        return { files: [], errors: [{ fileName: ".", error: "Project base path is not a directory" }] };
      }
    } catch (error) {
      return { files: [], errors: [{ fileName: ".", error: toErrorMessage(error, "Project base directory is not readable") }] };
    }

    const state: DiscoveryState = {
      realProjectRoot,
      files: new Map(),
      errors: [],
      totalBytes: 0,
      truncated: false,
    };

    const rootEntries = await this.readSortedDirectory(realProjectRoot, ".", state.errors);
    for (const entry of rootEntries) {
      if (state.truncated) break;
      const entryPath = path.join(realProjectRoot, entry.name);
      if (entry.isSymbolicLink()) {
        if (this.isRootDocFileName(entry.name) || entry.name === DOCS_DIRECTORY_NAME) {
          state.errors.push({ fileName: entry.name, error: "Skipped symbolic link" });
        }
        continue;
      }

      if (entry.isFile() && this.isRootDocFileName(entry.name)) {
        await this.addCandidate(state, entryPath, entry.name);
      } else if (entry.isDirectory() && entry.name === DOCS_DIRECTORY_NAME) {
        await this.walkDocsDirectory(state, entryPath, DOCS_DIRECTORY_NAME);
      }
    }

    return {
      files: [...state.files.values()].sort((left, right) => compareStable(left.relativePath, right.relativePath)),
      errors: state.errors,
    };
  }

  private async walkDocsDirectory(state: DiscoveryState, directoryPath: string, relativeDirectory: string): Promise<void> {
    if (state.truncated || this.isExcludedDirectory(relativeDirectory, path.basename(relativeDirectory))) {
      return;
    }

    const realDirectoryPath = await this.ensureContainedDirectory(state, directoryPath, relativeDirectory);
    if (!realDirectoryPath) {
      return;
    }

    const entries = await this.readSortedDirectory(realDirectoryPath, relativeDirectory, state.errors);
    for (const entry of entries) {
      if (state.truncated) break;

      const childPath = path.join(realDirectoryPath, entry.name);
      const childRelative = toPosixPath(path.join(relativeDirectory, entry.name));

      if (entry.isSymbolicLink()) {
        state.errors.push({ fileName: childRelative, error: "Skipped symbolic link" });
        continue;
      }

      if (entry.isDirectory()) {
        if (this.isExcludedDirectory(childRelative, entry.name)) {
          continue;
        }
        await this.walkDocsDirectory(state, childPath, childRelative);
      } else if (entry.isFile() && DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        await this.addCandidate(state, childPath, childRelative);
      }
    }
  }

  private async addCandidate(state: DiscoveryState, absolutePath: string, relativePath: string): Promise<void> {
    if (state.files.has(relativePath)) {
      return;
    }
    if (state.files.size >= this.maxFiles) {
      this.markTruncated(state, relativePath, `Documentation discovery truncated at ${this.maxFiles} files`);
      return;
    }

    try {
      const linkStat = await fs.lstat(absolutePath);
      if (linkStat.isSymbolicLink()) {
        state.errors.push({ fileName: relativePath, error: "Skipped symbolic link" });
        return;
      }
      const realFilePath = await fs.realpath(absolutePath);
      if (!isPathInside(state.realProjectRoot, realFilePath)) {
        state.errors.push({ fileName: relativePath, error: "Skipped path outside project directory" });
        return;
      }

      const stat = await fs.stat(realFilePath);
      if (!stat.isFile()) {
        return;
      }
      if (state.totalBytes + stat.size > this.maxTotalBytes) {
        this.markTruncated(state, relativePath, `Documentation discovery truncated at ${this.maxTotalBytes} bytes`);
        return;
      }

      state.totalBytes += stat.size;
      state.files.set(relativePath, { absolutePath: realFilePath, relativePath });
    } catch (error) {
      state.errors.push({ fileName: relativePath, error: toErrorMessage(error, "Failed to inspect file") });
    }
  }

  private async ensureContainedDirectory(state: DiscoveryState, directoryPath: string, relativeDirectory: string): Promise<string | null> {
    try {
      const linkStat = await fs.lstat(directoryPath);
      if (linkStat.isSymbolicLink()) {
        state.errors.push({ fileName: relativeDirectory, error: "Skipped symbolic link" });
        return null;
      }
      const realDirectoryPath = await fs.realpath(directoryPath);
      if (!isPathInside(state.realProjectRoot, realDirectoryPath)) {
        state.errors.push({ fileName: relativeDirectory, error: "Skipped path outside project directory" });
        return null;
      }
      const stat = await fs.stat(realDirectoryPath);
      if (!stat.isDirectory()) {
        return null;
      }
      return realDirectoryPath;
    } catch (error) {
      state.errors.push({ fileName: relativeDirectory, error: toErrorMessage(error, "Failed to inspect directory") });
      return null;
    }
  }

  private async readSortedDirectory(
    directoryPath: string,
    relativeDirectory: string,
    errors: ProjectDocsAutoEmbedError[],
  ): Promise<Dirent[]> {
    try {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      return entries.sort((left, right) => compareStable(left.name, right.name));
    } catch (error) {
      errors.push({ fileName: relativeDirectory, error: toErrorMessage(error, "Failed to read directory") });
      return [];
    }
  }

  private isRootDocFileName(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    if (ROOT_ASSISTANT_DOCS.has(lower)) {
      return true;
    }
    return ROOT_DOC_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }

  private isExcludedDirectory(relativeDirectory: string, directoryName: string): boolean {
    if (EXCLUDED_DIRECTORY_NAMES.has(directoryName)) {
      return true;
    }
    const normalized = toPosixPath(relativeDirectory);
    return normalized === ".code-ux/embeddings" || normalized.endsWith("/.code-ux/embeddings");
  }

  private markTruncated(state: DiscoveryState, fileName: string, error: string): void {
    if (!state.truncated) {
      state.errors.push({ fileName, error });
    }
    state.truncated = true;
  }
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
