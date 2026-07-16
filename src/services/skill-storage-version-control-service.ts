import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SkillRecord, SkillStorageRecord } from "../contracts/skill-types.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { acquireProjectGitHelper } from "../shared/subprocess/command-runner.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { renderSkillMarkdown } from "./skill-markdown-parser.js";

const STORAGE_REPOSITORY_SCHEMA_VERSION = 1;
const STORAGE_SNAPSHOT_MARKER_SCHEMA_VERSION = 2;
const STORAGE_SNAPSHOT_MARKER_FILENAME = "code-ux-storage-snapshot.json";

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

interface SkillStorageSnapshotMarker {
  schemaVersion: typeof STORAGE_SNAPSHOT_MARKER_SCHEMA_VERSION;
  fingerprint: string;
  indexFingerprint: string;
  revision: string;
}

interface MaterializedSkillStorage {
  fingerprint: string;
  manifestContent: string;
  skills: Array<{ directoryName: string; markdown: string }>;
}

type GitHelperLeaseFactory = (cwd: string) => () => Promise<void>;

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
    private readonly acquireGitHelperLease: GitHelperLeaseFactory = acquireProjectGitHelper,
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
    const materialized = this.buildMaterializedStorage(projectId, storage, skills);
    const reusable = await this.readReusableSnapshot(repositoryPath, skillsPath, materialized);
    if (reusable) {
      return reusable;
    }

    const releaseGitHelper = this.acquireGitHelperLease(repositoryPath);
    try {
      await fs.mkdir(skillsPath, { recursive: true, mode: 0o700 });
      await this.ensureRepository(repositoryPath);

      const expectedDirectories = new Set(materialized.skills.map((skill) => skill.directoryName));
      for (const entry of await fs.readdir(skillsPath, { withFileTypes: true })) {
        if (entry.isDirectory() && expectedDirectories.has(entry.name)) {
          continue;
        }
        await fs.rm(path.join(skillsPath, entry.name), { recursive: true, force: true });
      }

      for (const skill of materialized.skills) {
        const skillDirectory = path.join(skillsPath, skill.directoryName);
        await fs.mkdir(skillDirectory, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(skillDirectory, "SKILL.md"), skill.markdown, { mode: 0o600 });
      }

      await fs.writeFile(path.join(repositoryPath, "storage.json"), materialized.manifestContent, { mode: 0o600 });

      await this.gitRunner.run(["add", "--all"], repositoryPath);
      const status = await this.gitRunner.run(["status", "--porcelain"], repositoryPath);
      if (status.stdout.trim()) {
        await this.gitRunner.run(["commit", "-m", commitMessage], repositoryPath);
      }
      const revision = (await this.gitRunner.run(["rev-parse", "HEAD"], repositoryPath)).stdout.trim();
      const indexFingerprint = await this.readIndexFingerprint(repositoryPath);
      if (!indexFingerprint) {
        await fs.rm(this.snapshotMarkerPath(repositoryPath), { force: true });
        return { repositoryPath, revision };
      }
      await this.writeSnapshotMarker(repositoryPath, {
        schemaVersion: STORAGE_SNAPSHOT_MARKER_SCHEMA_VERSION,
        fingerprint: materialized.fingerprint,
        indexFingerprint,
        revision,
      });
      return { repositoryPath, revision };
    } finally {
      await releaseGitHelper();
    }
  }

  private buildMaterializedStorage(
    projectId: string,
    storage: SkillStorageRecord,
    skills: SkillRecord[],
  ): MaterializedSkillStorage {
    const materializedSkills = skills
      .map((skill) => ({
        directoryName: sanitizeSegment(skill.id, "skill"),
        markdown: `${renderSkillMarkdown(skill).trim()}\n`,
      }))
      .sort((left, right) => left.directoryName.localeCompare(right.directoryName));
    const manifestContent = `${JSON.stringify({
      schemaVersion: STORAGE_REPOSITORY_SCHEMA_VERSION,
      id: storage.id,
      projectId,
      name: storage.name,
      description: storage.description,
      storageKind: storage.storageKind,
      skillCount: skills.length,
    }, null, 2)}\n`;
    const fingerprint = createHash("sha256")
      .update(manifestContent)
      .update("\0")
      .update(materializedSkills.map((skill) => `${skill.directoryName}\0${skill.markdown}`).join("\0"))
      .digest("hex");
    return { fingerprint, manifestContent, skills: materializedSkills };
  }

  private async readReusableSnapshot(
    repositoryPath: string,
    skillsPath: string,
    materialized: MaterializedSkillStorage,
  ): Promise<SkillStorageRepositorySnapshot | null> {
    if (!await this.materializedContentMatches(repositoryPath, skillsPath, materialized)) {
      return null;
    }

    const marker = await this.readSnapshotMarker(repositoryPath);
    if (marker?.fingerprint === materialized.fingerprint && this.isRevision(marker.revision)) {
      const headRevision = await this.readHeadRevision(repositoryPath);
      const indexFingerprint = await this.readIndexFingerprint(repositoryPath);
      if (headRevision === marker.revision && indexFingerprint === marker.indexFingerprint) {
        return { repositoryPath, revision: marker.revision };
      }
    }

    return null;
  }

  private async materializedContentMatches(
    repositoryPath: string,
    skillsPath: string,
    materialized: MaterializedSkillStorage,
  ): Promise<boolean> {
    try {
      if (await fs.readFile(path.join(repositoryPath, "storage.json"), "utf8") !== materialized.manifestContent) {
        return false;
      }
      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
      const expectedDirectories = materialized.skills.map((skill) => skill.directoryName);
      const actualDirectories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      if (
        entries.some((entry) => !entry.isDirectory())
        || actualDirectories.length !== expectedDirectories.length
        || actualDirectories.some((entry, index) => entry !== expectedDirectories[index])
      ) {
        return false;
      }
      for (const skill of materialized.skills) {
        const markdown = await fs.readFile(path.join(skillsPath, skill.directoryName, "SKILL.md"), "utf8");
        if (markdown !== skill.markdown) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readSnapshotMarker(repositoryPath: string): Promise<SkillStorageSnapshotMarker | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.snapshotMarkerPath(repositoryPath), "utf8")) as Partial<SkillStorageSnapshotMarker>;
      return parsed.schemaVersion === STORAGE_SNAPSHOT_MARKER_SCHEMA_VERSION
        && typeof parsed.fingerprint === "string"
        && typeof parsed.indexFingerprint === "string"
        && typeof parsed.revision === "string"
        ? parsed as SkillStorageSnapshotMarker
        : null;
    } catch {
      return null;
    }
  }

  private async writeSnapshotMarker(repositoryPath: string, marker: SkillStorageSnapshotMarker): Promise<void> {
    const markerPath = this.snapshotMarkerPath(repositoryPath);
    const tempPath = `${markerPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, markerPath);
  }

  private snapshotMarkerPath(repositoryPath: string): string {
    return path.join(repositoryPath, ".git", STORAGE_SNAPSHOT_MARKER_FILENAME);
  }

  private async readIndexFingerprint(repositoryPath: string): Promise<string | null> {
    try {
      const index = await fs.readFile(path.join(repositoryPath, ".git", "index"));
      return createHash("sha256").update(index).digest("hex");
    } catch {
      return null;
    }
  }

  private async readHeadRevision(repositoryPath: string): Promise<string | null> {
    try {
      const gitDirectory = path.join(repositoryPath, ".git");
      const head = (await fs.readFile(path.join(gitDirectory, "HEAD"), "utf8")).trim();
      if (this.isRevision(head)) {
        return head;
      }
      if (!head.startsWith("ref: ")) {
        return null;
      }
      const refName = head.slice(5).trim();
      const looseRevision = await fs.readFile(path.join(gitDirectory, ...refName.split("/")), "utf8")
        .then((value) => value.trim())
        .catch(() => "");
      if (this.isRevision(looseRevision)) {
        return looseRevision;
      }
      const packedRefs = await fs.readFile(path.join(gitDirectory, "packed-refs"), "utf8").catch(() => "");
      for (const line of packedRefs.split(/\r?\n/u)) {
        const [revision, packedRefName] = line.trim().split(/\s+/u);
        if (packedRefName === refName && this.isRevision(revision || "")) {
          return revision || null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private isRevision(value: string): boolean {
    return /^[0-9a-f]{40}$/iu.test(value);
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
