import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SkillRecord, SkillStorageRecord } from "../contracts/skill-types.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { renderSkillMarkdown } from "./skill-markdown-parser.js";

const STORAGE_REPOSITORY_SCHEMA_VERSION = 1;

const sanitizeSegment = (value: string, fallback: string): string => {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return normalized || fallback;
};

export interface SkillStorageRepositorySnapshot {
  repositoryPath: string;
  revision: string;
}

export interface SkillStorageGitResult {
  stdout: string;
  stderr: string;
}

export interface SkillStorageGitRunner {
  run(args: string[], cwd: string): Promise<SkillStorageGitResult>;
}

/** Forces every skill-history Git command through the standard Docker Git helper. */
export class ContainerizedSkillStorageGitRunner implements SkillStorageGitRunner {
  async run(args: string[], cwd: string): Promise<SkillStorageGitResult> {
    const env: NodeJS.ProcessEnv = { ...process.env, CODE_UX_CONTAINERIZED_GIT: "1" };
    delete env.CODE_UX_GIT_CONTAINER_MODE;
    return await runCommandStrict("git", args, cwd, env);
  }
}

/**
 * Materializes each persistent skill storage as an internal, local-only Git repository.
 * SQLite remains the indexed projection during migration; this repository provides a
 * readable runtime mount, immutable revisions, and a rebuild source for the next phase.
 */
export class SkillStorageVersionControlService {
  private readonly locks = new Map<string, Promise<SkillStorageRepositorySnapshot>>();

  constructor(
    private readonly repositoriesRoot = getHomeCodeUxPath("skill-storages"),
    private readonly gitRunner: SkillStorageGitRunner = new ContainerizedSkillStorageGitRunner(),
  ) {}

  getRepositoryPath(projectId: string, storageId: string): string {
    return path.join(
      this.repositoriesRoot,
      sanitizeSegment(projectId, "project"),
      sanitizeSegment(storageId, "storage"),
      "repo",
    );
  }

  async synchronize(
    projectId: string,
    storage: SkillStorageRecord,
    skills: SkillRecord[],
    commitMessage = "skill: synchronize storage",
  ): Promise<SkillStorageRepositorySnapshot> {
    const key = `${projectId}:${storage.id}`;
    const previous = this.locks.get(key) ?? Promise.resolve({ repositoryPath: "", revision: "" });
    const next = previous.catch(() => ({ repositoryPath: "", revision: "" })).then(async () => {
      return await this.synchronizeUnlocked(projectId, storage, skills, commitMessage);
    });
    this.locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  private async synchronizeUnlocked(
    projectId: string,
    storage: SkillStorageRecord,
    skills: SkillRecord[],
    commitMessage: string,
  ): Promise<SkillStorageRepositorySnapshot> {
    const repositoryPath = this.getRepositoryPath(projectId, storage.id);
    const skillsPath = path.join(repositoryPath, "skills");
    await fs.mkdir(skillsPath, { recursive: true, mode: 0o700 });
    await this.ensureRepository(repositoryPath);

    const expectedDirectories = new Set(skills.map((skill) => sanitizeSegment(skill.id, "skill")));
    for (const entry of await fs.readdir(skillsPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || expectedDirectories.has(entry.name)) {
        continue;
      }
      await fs.rm(path.join(skillsPath, entry.name), { recursive: true, force: true });
    }

    for (const skill of skills) {
      const skillDirectory = path.join(skillsPath, sanitizeSegment(skill.id, "skill"));
      await fs.mkdir(skillDirectory, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(skillDirectory, "SKILL.md"), `${renderSkillMarkdown(skill).trim()}\n`, { mode: 0o600 });
    }

    const storageManifest = {
      schemaVersion: STORAGE_REPOSITORY_SCHEMA_VERSION,
      id: storage.id,
      projectId,
      name: storage.name,
      description: storage.description,
      storageKind: storage.storageKind,
      skillCount: skills.length,
    };
    await fs.writeFile(
      path.join(repositoryPath, "storage.json"),
      `${JSON.stringify(storageManifest, null, 2)}\n`,
      { mode: 0o600 },
    );

    await this.gitRunner.run(["add", "--all"], repositoryPath);
    const status = await this.gitRunner.run(["status", "--porcelain"], repositoryPath);
    if (status.stdout.trim()) {
      await this.gitRunner.run(["commit", "-m", commitMessage], repositoryPath);
    }
    const revision = (await this.gitRunner.run(["rev-parse", "HEAD"], repositoryPath)).stdout.trim();
    return { repositoryPath, revision };
  }

  private async ensureRepository(repositoryPath: string): Promise<void> {
    try {
      await fs.access(path.join(repositoryPath, ".git"));
    } catch {
      await this.gitRunner.run(["init", "-b", "main"], repositoryPath);
      await this.gitRunner.run(["config", "user.name", "Code UX"], repositoryPath);
      await this.gitRunner.run(["config", "user.email", "runtime@codeux.local"], repositoryPath);
      await this.gitRunner.run(["config", "commit.gpgSign", "false"], repositoryPath);
    }
  }
}
