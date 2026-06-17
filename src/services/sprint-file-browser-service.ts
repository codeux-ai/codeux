import type { DockerContainerSummary } from "./docker-session-lifecycle.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as pathPosix from "path/posix";
import os from "os";
import type {
  FileBrowserChange,
  FileBrowserChangeSet,
  FileBrowserChangeStatus,
  FileBrowserDiff,
  FileBrowserFileContent,
  FileBrowserSession,
  FileBrowserTree,
  FileBrowserTreeNode,
} from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { SprintFileBrowserRepository } from "../repositories/sprint-file-browser-repository.js";
import { resolveDockerRuntimeRoot } from "../infrastructure/providers/cli/docker-runtime-paths.js";
import { formatSprintBranch } from "../domain/sprint/branch-name-generator.js";
import { commandRunner, runCommandStrict } from "./cli-process-runner.js";
import { getDockerUserSpec, mapPathPrefix, toDockerMountArg } from "./cli-docker-utils.js";
import type { Logger } from "../shared/logging/logger.js";
import { fetchOriginIfAvailable } from "./git-branch-sync-service.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks, type GitHttpAuthOptions } from "./git-http-auth.js";
import { resolveLanguageForPath } from "./file-browser-language.js";

const FILE_BROWSER_LABEL = "code-ux.file-browser=true";
const FILE_BROWSER_IMAGE = "alpine:3.20";
const CONTAINER_WORKSPACE_PATH = "/workspace";
const MAX_TREE_ENTRIES = 20_000;
const MAX_FILE_BYTES = 2_000_000;
const PRUNED_DIRECTORIES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
  ".cache",
  ".vite",
  ".svelte-kit",
  "vendor",
];

interface SprintFileBrowserServiceDeps {
  sprintFileBrowserRepository: SprintFileBrowserRepository;
  projectManagementRepository: ProjectManagementRepository;
  settingsRepository: SettingsRepository;
  logger?: Logger;
}


interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export class SprintFileBrowserService {
  private readonly sessionLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: SprintFileBrowserServiceDeps) {}

  async listSessions(projectId?: string): Promise<FileBrowserSession[]> {
    const sessions = this.deps.sprintFileBrowserRepository.listSessions(projectId);
    // One `docker ps` for the whole batch instead of one per session.
    const containers = await this.listFileBrowserContainers(process.cwd());
    return await Promise.all(sessions.map((session) => this.refreshRuntimeState(session, containers)));
  }

  async getSession(sessionId: string): Promise<FileBrowserSession | null> {
    const session = this.deps.sprintFileBrowserRepository.getSession(sessionId);
    return session ? await this.refreshRuntimeState(session) : null;
  }

  async startSession(projectId: string, sprintId: string, options?: { rebuild?: boolean }): Promise<FileBrowserSession> {
    return await this.withSessionLock(this.buildSessionLockKey(projectId, sprintId), async () => {
      const project = this.requireProject(projectId);
      const sprint = this.requireSprint(projectId, sprintId);
      const effectiveSettings = this.resolveSettings(projectId, sprintId);
      const featureBranch = sprint.featureBranch?.trim() || this.resolveSprintFeatureBranch(projectId, sprintId);
      const defaultBranch = effectiveSettings.git.defaultBranch?.trim() || project.defaultBranch?.trim() || "main";
      const projectRuntimeRoot = resolveDockerRuntimeRoot(project.baseDir);
      const runtimeRoot = path.join(projectRuntimeRoot, "file-browser", sprintId);
      const workspacePath = path.join(runtimeRoot, "workspace");
      const containerName = this.buildContainerName(projectId, sprintId);
      const completedTaskCount = this.countCompletedTasks(projectId, sprintId);

      // Only one file browser container is allowed at a time across all sprints/projects.
      await this.stopOtherSessions(project.baseDir, projectId, sprintId);

      const existing = this.deps.sprintFileBrowserRepository.getSessionByProjectSprint(projectId, sprintId);
      if (existing && !options?.rebuild) {
        const refreshedExisting = await this.refreshRuntimeState(existing);
        if (refreshedExisting.status === "running" || refreshedExisting.status === "starting") {
          return refreshedExisting;
        }
      }

      const session = existing || this.deps.sprintFileBrowserRepository.createSession({
        projectId,
        sprintId,
        status: "starting",
        featureBranch,
        defaultBranch,
        workspacePath,
        lastCompletedTaskCount: completedTaskCount,
        lastSeenSprintStatus: sprint.status,
      });

      const basePatch = {
        status: "starting" as const,
        featureBranch,
        defaultBranch,
        workspacePath,
        lastCompletedTaskCount: completedTaskCount,
        lastSeenSprintStatus: sprint.status,
        lastError: null,
      };

      this.deps.sprintFileBrowserRepository.updateSession(session.id, {
        ...basePatch,
        containerId: null,
        containerName: null,
      });

      try {
        await this.removeContainerIfPresent(existing?.containerId || existing?.containerName || containerName, project.baseDir);
        await this.removeContainerIfPresent(containerName, project.baseDir);

        await this.materializeWorkspace(
          project.baseDir,
          workspacePath,
          featureBranch,
          defaultBranch,
          effectiveSettings.git.githubMode === "REMOTE",
          {
            githubToken: effectiveSettings.git.githubToken,
            gitlabToken: effectiveSettings.git.gitlabToken,
          },
        );

        const volumeName = `code-ux-file-browser-volume-${sprintId}`;
        await runCommandStrict("docker", ["volume", "rm", "-f", volumeName], project.baseDir).catch(() => undefined);

        const archivePath = `${workspacePath}.tar`;
        const dockerArgs = [
          "create",
          "--name", containerName,
          "--label", FILE_BROWSER_LABEL,
          "--label", `code-ux.project-id=${projectId}`,
          "--label", `code-ux.sprint-id=${sprintId}`,
          "--label", `code-ux.session-id=${session.id}`,
          "--workdir", CONTAINER_WORKSPACE_PATH,
          "--mount", toDockerMountArg({ type: "volume", source: volumeName, destination: CONTAINER_WORKSPACE_PATH, readonly: false }),
          FILE_BROWSER_IMAGE,
          "tail", "-f", "/dev/null",
        ];

        const createResult = await runCommandStrict("docker", dockerArgs, project.baseDir);
        const containerId = createResult.stdout.trim();
        if (!containerId) {
          throw new Error("Docker file browser container did not return a container id.");
        }

        await runCommandStrict("docker", ["cp", archivePath, `${containerName}:/tmp/workspace.tar`], project.baseDir);
        await fs.rm(archivePath, { force: true }).catch(() => undefined);

        await runCommandStrict("docker", ["start", containerName], project.baseDir);

        const extractCmd = `tar -xf /tmp/workspace.tar -C ${CONTAINER_WORKSPACE_PATH} && rm -f /tmp/workspace.tar`;
        await runCommandStrict("docker", ["exec", containerName, "sh", "-c", extractCmd], project.baseDir);

        const updated = this.deps.sprintFileBrowserRepository.updateSession(session.id, {
          ...basePatch,
          status: "running",
          containerId,
          containerName,
          lastBuildAt: new Date().toISOString(),
          lastStartedAt: new Date().toISOString(),
        });
        return await this.refreshRuntimeState(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.removeContainerIfPresent(containerName, project.baseDir);
        return this.deps.sprintFileBrowserRepository.updateSession(session.id, {
          ...basePatch,
          status: "error",
          containerId: null,
          containerName: null,
          lastError: message,
        });
      }
    });
  }

  async rebuildSession(sessionId: string): Promise<FileBrowserSession> {
    const session = await this.requireSession(sessionId);
    return await this.startSession(session.projectId, session.sprintId, { rebuild: true });
  }

  async stopSession(sessionId: string): Promise<FileBrowserSession> {
    const session = await this.requireSession(sessionId);
    return await this.withSessionLock(this.buildSessionLockKey(session.projectId, session.sprintId), async () => {
      const containerRef = session.containerId || session.containerName || this.buildContainerName(session.projectId, session.sprintId);
      await this.removeContainerIfPresent(containerRef, process.cwd());
      return this.deps.sprintFileBrowserRepository.updateSession(sessionId, {
        status: "stopped",
        containerId: null,
        containerName: null,
        lastError: null,
        lastStoppedAt: new Date().toISOString(),
      });
    });
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    await this.withSessionLock(this.buildSessionLockKey(session.projectId, session.sprintId), async () => {
      const containerRef = session.containerId || session.containerName || this.buildContainerName(session.projectId, session.sprintId);
      await this.removeContainerIfPresent(containerRef, process.cwd());
      await runCommandStrict("docker", ["volume", "rm", `code-ux-file-browser-volume-${session.sprintId}`], process.cwd()).catch(() => undefined);
      this.deps.sprintFileBrowserRepository.deleteSession(sessionId);
    });
  }

  async getTree(sessionId: string): Promise<FileBrowserTree> {
    const session = await this.requireRunningSession(sessionId);
    const script = this.buildTreeScript();
    const result = await commandRunner.run("docker", ["exec", session.containerId!, "sh", "-c", script], {
      cwd: process.cwd(),
    });
    if (!result.ok) {
      throw new Error(result.stderr.trim() || "Failed to read file tree from container.");
    }
    return this.buildTree(sessionId, result.stdout);
  }

  async readFile(sessionId: string, requestedPath: string): Promise<FileBrowserFileContent> {
    const session = await this.requireRunningSession(sessionId);
    const relPath = this.normalizeRelativePath(requestedPath);
    const containerPath = pathPosix.join(CONTAINER_WORKSPACE_PATH, relPath);
    const script = `head -c ${MAX_FILE_BYTES + 1} -- ${this.shellQuote(containerPath)}`;
    const result = await commandRunner.run("docker", ["exec", session.containerId!, "sh", "-c", script], {
      cwd: process.cwd(),
      trimOutput: false,
    });
    if (!result.ok) {
      throw new Error(result.stderr.trim() || `Failed to read file: ${relPath}`);
    }
    const raw = result.stdout;
    const truncated = raw.length > MAX_FILE_BYTES;
    const content = truncated ? raw.slice(0, MAX_FILE_BYTES) : raw;
    const binary = content.includes("\u0000");
    return {
      path: relPath,
      content: binary ? "" : content,
      encoding: "utf8",
      size: content.length,
      truncated,
      binary,
      language: resolveLanguageForPath(relPath),
    };
  }

  async getChangeSet(sessionId: string): Promise<FileBrowserChangeSet> {
    const session = await this.requireSession(sessionId);
    const project = this.requireProject(session.projectId);
    const featureBranch = session.featureBranch?.trim() || this.resolveSprintFeatureBranch(session.projectId, session.sprintId);
    const defaultBranch = session.defaultBranch?.trim() || project.defaultBranch?.trim() || "main";
    const settings = this.resolveSettings(session.projectId, session.sprintId);

    const unavailable = (reason: string): FileBrowserChangeSet => ({
      sessionId,
      featureBranch,
      defaultBranch,
      available: false,
      reason,
      files: [],
    });

    await this.fetchOrigin(project.baseDir, settings.git.githubMode === "REMOTE", {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    });

    const featureRef = await this.resolveExistingRef(project.baseDir, featureBranch);
    if (!featureRef) {
      return unavailable(`Feature branch ${featureBranch} was not found locally or on origin.`);
    }
    const compareRef = await this.resolveDiffBaseRef(project.baseDir, session.projectId, session.sprintId, defaultBranch, featureRef);
    if (!compareRef) {
      return unavailable(`Default branch ${defaultBranch} was not found locally or on origin.`);
    }

    const nameStatus = await this.runGit(project.baseDir, ["diff", "--name-status", "-M", `${compareRef}`, `${featureRef}`]);
    if (!nameStatus.ok) {
      return unavailable(nameStatus.stderr.trim() || "git diff failed.");
    }
    const numstat = await this.runGit(project.baseDir, ["diff", "--numstat", "-M", `${compareRef}`, `${featureRef}`]);

    const stats = this.parseNumstat(numstat.ok ? numstat.stdout : "");
    const files = this.parseNameStatus(nameStatus.stdout, stats);

    return {
      sessionId,
      featureBranch,
      defaultBranch,
      available: true,
      reason: null,
      files,
    };
  }

  async getDiff(sessionId: string, requestedPath: string): Promise<FileBrowserDiff> {
    const session = await this.requireSession(sessionId);
    const project = this.requireProject(session.projectId);
    const featureBranch = session.featureBranch?.trim() || this.resolveSprintFeatureBranch(session.projectId, session.sprintId);
    const defaultBranch = session.defaultBranch?.trim() || project.defaultBranch?.trim() || "main";
    const settings = this.resolveSettings(session.projectId, session.sprintId);
    const relPath = this.normalizeRelativePath(requestedPath);

    await this.fetchOrigin(project.baseDir, settings.git.githubMode === "REMOTE", {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    });

    const featureRef = await this.resolveExistingRef(project.baseDir, featureBranch);
    if (!featureRef) {
      throw new Error("Cannot compute diff: feature branch reference is unavailable.");
    }
    const compareRef = await this.resolveDiffBaseRef(project.baseDir, session.projectId, session.sprintId, defaultBranch, featureRef);
    if (!compareRef) {
      throw new Error("Cannot compute diff: base reference is unavailable.");
    }

    const changeSet = await this.getChangeSet(sessionId);
    const change = changeSet.files.find((entry) => entry.path === relPath)
      || { path: relPath, oldPath: null, status: "modified" as FileBrowserChangeStatus, additions: 0, deletions: 0 };

    const originalPath = change.oldPath || relPath;
    const original = change.status === "added"
      ? null
      : await this.showFileAtRef(project.baseDir, compareRef, originalPath);
    const modified = change.status === "deleted"
      ? null
      : await this.showFileAtRef(project.baseDir, featureRef, relPath);

    const binary = (original !== null && original.includes("\u0000")) || (modified !== null && modified.includes("\u0000"));

    return {
      path: relPath,
      oldPath: change.oldPath,
      status: change.status,
      original: binary ? null : original,
      modified: binary ? null : modified,
      binary,
      language: resolveLanguageForPath(relPath),
    };
  }

  async cleanupStaleContainersOnStartup(): Promise<void> {
    const containerIds = await this.listFileBrowserContainerIds();
    for (const containerId of containerIds) {
      await runCommandStrict("docker", ["rm", "-f", containerId], process.cwd()).catch(() => undefined);
    }

    const sessions = this.deps.sprintFileBrowserRepository.listSessions();
    for (const session of sessions) {
      if (!session.containerId && !session.containerName && session.status === "stopped") {
        continue;
      }
      this.deps.sprintFileBrowserRepository.updateSession(session.id, {
        status: "stopped",
        containerId: null,
        containerName: null,
        lastError: null,
        lastStoppedAt: new Date().toISOString(),
      });
    }

    if (containerIds.length > 0) {
      this.deps.logger?.info("Stopped stale file browser containers on startup", {
        stoppedCount: containerIds.length,
      });
    }
  }

  async reconcileSessions(): Promise<void> {
    const sessions = this.deps.sprintFileBrowserRepository.listSessions();
    // Fetch the file-browser container listing once for the whole pass (was one `docker ps` per session).
    const containers = await this.listFileBrowserContainers(process.cwd());
    for (const session of sessions) {
      const sprint = this.deps.projectManagementRepository.getSprint(session.sprintId);
      if (!sprint) {
        // Sprint was deleted — drop the orphaned session record.
        this.deps.sprintFileBrowserRepository.deleteSession(session.id);
        continue;
      }
      const refreshed = await this.refreshRuntimeState(session, containers);
      if (refreshed.status !== "running") {
        // Prune dead records for finished sprints so they don't accumulate and get reconciled
        // forever; recreated on demand if the file browser is opened again.
        const sprintTerminal = sprint.status === "completed" || sprint.status === "failed" || sprint.status === "cancelled";
        if (sprintTerminal && !refreshed.containerId && !refreshed.containerName) {
          this.deps.sprintFileBrowserRepository.deleteSession(refreshed.id);
        }
        continue;
      }

      const completedTaskCount = this.countCompletedTasks(session.projectId, session.sprintId);

      // When a task finishes and changes land on the feature branch, rebuild so the
      // browsable snapshot reflects the latest state (no app build is performed).
      if (completedTaskCount > refreshed.lastCompletedTaskCount) {
        await this.rebuildSession(refreshed.id).catch((error) => {
          this.deps.logger?.warn("Failed to auto-rebuild file browser after task completion", {
            sessionId: refreshed.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }

      if (sprint.status === "completed" && refreshed.lastSeenSprintStatus !== "completed") {
        await this.rebuildSession(refreshed.id).catch((error) => {
          this.deps.logger?.warn("Failed to auto-rebuild file browser after sprint completion", {
            sessionId: refreshed.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }

      this.deps.sprintFileBrowserRepository.updateSession(refreshed.id, {
        lastCompletedTaskCount: completedTaskCount,
        lastSeenSprintStatus: sprint.status,
      });
    }
  }

  private async refreshRuntimeState(
    session: FileBrowserSession,
    preFetchedContainers?: DockerContainerSummary[],
  ): Promise<FileBrowserSession> {
    const container = await this.findManagedContainerForSession(session, preFetchedContainers);
    if (!container) {
      if (!session.containerId && !session.containerName) {
        return session;
      }
      return this.deps.sprintFileBrowserRepository.updateSession(session.id, {
        status: "stopped",
        containerId: null,
        containerName: null,
      });
    }

    const adopted = session.containerId === container.id && session.containerName === container.name
      ? session
      : this.deps.sprintFileBrowserRepository.updateSession(session.id, {
        containerId: container.id,
        containerName: container.name,
      });

    if (container.status !== "running") {
      return this.deps.sprintFileBrowserRepository.updateSession(adopted.id, {
        status: "error",
        lastError: adopted.lastError || `File browser container is ${container.status}.`,
      });
    }

    if (adopted.status === "running") {
      return adopted;
    }
    return this.deps.sprintFileBrowserRepository.updateSession(adopted.id, {
      status: "running",
      lastError: null,
    });
  }

  private buildTreeScript(): string {
    const pruneExpr = PRUNED_DIRECTORIES.map((name) => `-name ${this.shellQuote(name)}`).join(" -o ");
    const prune = `\\( ${pruneExpr} \\) -prune`;
    const dirs = `find . ${prune} -o -type d -print | sed 's#^#D#'`;
    const files = `find . ${prune} -o -type f -print | sed 's#^#F#'`;
    return `cd ${CONTAINER_WORKSPACE_PATH} && { ${dirs}; ${files}; }`;
  }

  private buildTree(sessionId: string, output: string): FileBrowserTree {
    const lines = output.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    let truncated = false;
    let fileCount = 0;
    const nodes = new Map<string, FileBrowserTreeNode>();
    const rootNodes: FileBrowserTreeNode[] = [];

    const ensureNode = (relPath: string, type: "file" | "directory"): FileBrowserTreeNode | null => {
      if (relPath === "" || relPath === ".") {
        return null;
      }
      const existing = nodes.get(relPath);
      if (existing) {
        return existing;
      }
      const name = pathPosix.basename(relPath);
      const node: FileBrowserTreeNode = {
        id: relPath,
        name,
        path: relPath,
        type,
        ...(type === "directory" ? { children: [] } : {}),
      };
      nodes.set(relPath, node);
      const parentPath = pathPosix.dirname(relPath);
      if (parentPath === "." || parentPath === "") {
        rootNodes.push(node);
      } else {
        const parent = ensureNode(parentPath, "directory");
        parent?.children?.push(node);
      }
      return node;
    };

    for (const line of lines) {
      if (nodes.size >= MAX_TREE_ENTRIES) {
        truncated = true;
        break;
      }
      const marker = line[0];
      const rawPath = line.slice(1).replace(/^\.\//, "");
      if (!rawPath || rawPath === ".") {
        continue;
      }
      const type = marker === "D" ? "directory" : "file";
      const node = ensureNode(rawPath, type);
      if (node && type === "file") {
        fileCount += 1;
      }
    }

    const sortNodes = (list: FileBrowserTreeNode[]): FileBrowserTreeNode[] => {
      list.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      for (const node of list) {
        if (node.children) {
          sortNodes(node.children);
        }
      }
      return list;
    };

    return {
      sessionId,
      root: sortNodes(rootNodes),
      fileCount,
      truncated,
    };
  }

  private parseNameStatus(output: string, stats: Map<string, { additions: number; deletions: number }>): FileBrowserChange[] {
    const changes: FileBrowserChange[] = [];
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split("\t");
      const code = parts[0] || "";
      let status: FileBrowserChangeStatus = "modified";
      let oldPath: string | null = null;
      let filePath = parts[1] || "";

      if (code.startsWith("A")) {
        status = "added";
      } else if (code.startsWith("D")) {
        status = "deleted";
      } else if (code.startsWith("R")) {
        status = "renamed";
        oldPath = parts[1] || null;
        filePath = parts[2] || filePath;
      } else if (code.startsWith("C")) {
        status = "added";
        oldPath = parts[1] || null;
        filePath = parts[2] || filePath;
      } else {
        status = "modified";
      }

      if (!filePath) {
        continue;
      }
      const stat = stats.get(filePath) || { additions: 0, deletions: 0 };
      changes.push({
        path: filePath,
        oldPath,
        status,
        additions: stat.additions,
        deletions: stat.deletions,
      });
    }
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return changes;
  }

  private parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 3) {
        continue;
      }
      const additions = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
      const deletions = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
      // Rename numstat path may be in the form "old => new"; prefer the final path segment.
      let filePath = parts[2];
      const renameMatch = filePath.match(/\{.*? => (.*?)\}/) || filePath.match(/ => (.*)$/);
      if (renameMatch) {
        filePath = filePath.replace(/\{.*? => (.*?)\}/, "$1").replace(/^.* => /, "");
      }
      map.set(filePath, { additions, deletions });
    }
    return map;
  }

  private async showFileAtRef(repoPath: string, ref: string, filePath: string): Promise<string | null> {
    const result = await this.runGit(repoPath, ["show", `${ref}:${filePath}`]);
    if (!result.ok) {
      return null;
    }
    return result.stdout;
  }

  /**
   * Resolves the ref the feature branch is diffed against. Prefers the fork point
   * recorded on the sprint when its branch was created, so diffs keep showing the
   * sprint's changes even after it merges back into the default branch (at which
   * point merge-base(default, feature) collapses onto the feature tip → empty diff).
   * Falls back to the live merge-base for sprints created before the checkpoint was
   * tracked.
   */
  private async resolveDiffBaseRef(
    repoPath: string,
    projectId: string,
    sprintId: string,
    defaultBranch: string,
    featureRef: string,
  ): Promise<string | null> {
    const recordedBase = this.resolveRecordedBaseCommit(projectId, sprintId);
    if (recordedBase && await this.commitExists(repoPath, recordedBase)) {
      return recordedBase;
    }
    const baseRef = await this.resolveExistingRef(repoPath, defaultBranch);
    if (!baseRef) {
      return null;
    }
    return (await this.resolveMergeBase(repoPath, baseRef, featureRef)) || baseRef;
  }

  private resolveRecordedBaseCommit(projectId: string, sprintId: string): string | null {
    try {
      const sprint = this.requireSprint(projectId, sprintId);
      return sprint.baseCommitSha?.trim() || null;
    } catch {
      return null;
    }
  }

  private async commitExists(repoPath: string, sha: string): Promise<boolean> {
    const result = await this.runGit(repoPath, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
    return result.ok && result.stdout.trim().length > 0;
  }

  private async resolveMergeBase(repoPath: string, baseRef: string, featureRef: string): Promise<string | null> {
    const result = await this.runGit(repoPath, ["merge-base", baseRef, featureRef]);
    if (!result.ok) {
      return null;
    }
    const sha = result.stdout.trim();
    return sha || null;
  }

  private async resolveExistingRef(repoPath: string, branch: string): Promise<string | null> {
    if (await this.remoteTrackingRefExists(repoPath, branch)) {
      return `origin/${branch}`;
    }
    if (await this.localBranchExists(repoPath, branch)) {
      return branch;
    }
    return null;
  }

  private async localBranchExists(repoPath: string, branch: string): Promise<boolean> {
    const result = await this.runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return result.ok;
  }

  private async remoteTrackingRefExists(repoPath: string, branch: string): Promise<boolean> {
    const result = await this.runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
    return result.ok;
  }

  private async fetchOrigin(repoPath: string, syncFromOrigin: boolean, gitAuthOptions: GitHttpAuthOptions): Promise<void> {
    if (!syncFromOrigin) {
      return;
    }
    await fetchOriginIfAvailable(repoPath, gitAuthOptions).catch(() => undefined);
  }

  private async runGit(repoPath: string, args: string[]): Promise<GitRunResult> {
    const result = await commandRunner.run("git", args, { cwd: repoPath, trimOutput: false });
    return { ok: result.ok, stdout: result.stdout, stderr: result.stderr };
  }

  private async materializeWorkspace(
    repoPath: string,
    workspacePath: string,
    featureBranch: string,
    defaultBranch: string,
    syncLatestFromOrigin = true,
    gitAuthOptions?: GitHttpAuthOptions,
  ): Promise<void> {
    if (syncLatestFromOrigin) {
      await fetchOriginIfAvailable(repoPath, gitAuthOptions);
    }
    await this.ensureBranchExists(repoPath, featureBranch, defaultBranch, gitAuthOptions || {});
    const exportRef = await this.resolveExistingRef(repoPath, featureBranch);
    if (!exportRef) {
      throw new Error(`Cannot export file browser workspace: branch ${featureBranch} does not exist locally or on origin.`);
    }
    const archivePath = `${workspacePath}.tar`;

    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.rm(archivePath, { force: true }).catch(() => undefined);

    await runCommandStrict("git", ["archive", "--format=tar", "-o", archivePath, exportRef], repoPath);
  }

  private async ensureBranchExists(
    repoPath: string,
    featureBranch: string,
    defaultBranch: string,
    gitAuthOptions: GitHttpAuthOptions,
  ): Promise<void> {
    if (await this.localBranchExists(repoPath, featureBranch)) {
      return;
    }
    if (await this.remoteTrackingRefExists(repoPath, featureBranch)) {
      return;
    }
    if (await this.remoteBranchExists(repoPath, featureBranch, gitAuthOptions)) {
      return;
    }

    const baseRef = (await this.localBranchExists(repoPath, defaultBranch))
      ? defaultBranch
      : (await this.remoteTrackingRefExists(repoPath, defaultBranch))
        ? `origin/${defaultBranch}`
        : "HEAD";
    const created = await this.runGit(repoPath, ["branch", featureBranch, baseRef]);
    if (!created.ok && !(await this.localBranchExists(repoPath, featureBranch))) {
      throw new Error(created.stderr.trim() || `Failed to create branch ${featureBranch}.`);
    }
  }

  private async remoteBranchExists(repoPath: string, branch: string, gitAuthOptions: GitHttpAuthOptions): Promise<boolean> {
    try {
      const env = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuthOptions ?? {});
      const result = await commandRunner.run("git", ["ls-remote", "--heads", "origin", branch], {
        cwd: repoPath,
        env: env ?? process.env,
        trimOutput: false,
      });
      return result.ok && result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async stopOtherSessions(cwd: string, keepProjectId: string, keepSprintId: string): Promise<void> {
    const containers = await this.listFileBrowserContainers(cwd);
    for (const container of containers) {
      const sameProject = container.labels["code-ux.project-id"] === keepProjectId;
      const sameSprint = container.labels["code-ux.sprint-id"] === keepSprintId;
      if (sameProject && sameSprint) {
        continue;
      }
      await this.removeContainerIfPresent(container.id, cwd);
    }

    const sessions = this.deps.sprintFileBrowserRepository.listSessions();
    for (const session of sessions) {
      if (session.projectId === keepProjectId && session.sprintId === keepSprintId) {
        continue;
      }
      if (session.status === "stopped" && !session.containerId && !session.containerName) {
        continue;
      }
      this.deps.sprintFileBrowserRepository.updateSession(session.id, {
        status: "stopped",
        containerId: null,
        containerName: null,
        lastStoppedAt: new Date().toISOString(),
      });
    }
  }

  private async listFileBrowserContainerIds(): Promise<string[]> {
    try {
      const result = await runCommandStrict(
        "docker",
        ["ps", "-aq", "--filter", `label=${FILE_BROWSER_LABEL}`],
        process.cwd(),
      );
      return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  private async listFileBrowserContainers(cwd: string): Promise<DockerContainerSummary[]> {
    try {
      const result = await runCommandStrict(
        "docker",
        [
          "ps",
          "-a",
          "--filter", `label=${FILE_BROWSER_LABEL}`,
          "--format",
          "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Label \"code-ux.project-id\"}}\t{{.Label \"code-ux.sprint-id\"}}\t{{.Label \"code-ux.session-id\"}}",
        ],
        cwd,
      );
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [id, name, rawStatus, projectId, sprintId, sessionId] = line.split("\t");
          return {
            id,
            name: name || null,
            status: this.normalizeDockerState(rawStatus),
            labels: {
              "code-ux.project-id": projectId || "",
              "code-ux.sprint-id": sprintId || "",
              "code-ux.session-id": sessionId || "",
            },
          } satisfies DockerContainerSummary;
        });
    } catch {
      return [];
    }
  }

  private async findManagedContainerForSession(
    session: FileBrowserSession,
    preFetchedContainers?: DockerContainerSummary[],
  ): Promise<DockerContainerSummary | null> {
    // Callers reconciling/listing many sessions pass one shared container listing so we run a single
    // `docker ps` per pass instead of one per session (was an N+1 spawning hundreds of `docker ps`).
    const containers = preFetchedContainers ?? await this.listFileBrowserContainers(process.cwd());
    const bySession = containers.find((container) => container.labels["code-ux.session-id"] === session.id);
    if (bySession) {
      return bySession;
    }
    const byIdentity = containers.find((container) =>
      container.labels["code-ux.project-id"] === session.projectId
      && container.labels["code-ux.sprint-id"] === session.sprintId,
    );
    if (byIdentity) {
      return byIdentity;
    }
    if (!session.containerId && !session.containerName) {
      return null;
    }
    return containers.find((container) =>
      container.id === session.containerId
      || (session.containerName ? container.name === session.containerName : false),
    ) || null;
  }

  private normalizeDockerState(rawStatus: string | null | undefined): string | null {
    const normalized = String(rawStatus || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized.startsWith("up ")) {
      return "running";
    }
    if (normalized.startsWith("exited ")) {
      return "exited";
    }
    if (normalized.startsWith("created")) {
      return "created";
    }
    if (normalized.startsWith("restarting")) {
      return "restarting";
    }
    return normalized;
  }

  private async removeContainerIfPresent(containerRef: string, cwd: string): Promise<void> {
    if (!containerRef.trim()) {
      return;
    }
    await runCommandStrict("docker", ["rm", "-f", containerRef], cwd).catch(() => undefined);
  }

  private buildSessionLockKey(projectId: string, sprintId: string): string {
    return `${projectId}:${sprintId}`;
  }

  private async withSessionLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(lockKey) || Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.finally(() => gate);
    this.sessionLocks.set(lockKey, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.sessionLocks.get(lockKey) === queued) {
        this.sessionLocks.delete(lockKey);
      }
    }
  }

  private normalizeRelativePath(requestedPath: string): string {
    const trimmed = (requestedPath || "").trim().replace(/\\/g, "/");
    const withoutLeading = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
    const normalized = pathPosix.normalize(withoutLeading);
    if (!normalized || normalized === "." || normalized.startsWith("..") || normalized.includes("../")) {
      throw new Error(`Invalid file path: ${requestedPath}`);
    }
    return normalized;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  private countCompletedTasks(projectId: string, sprintId: string): number {
    return this.deps.projectManagementRepository.listTasks(projectId, sprintId)
      .filter((task) => task.status === "completed")
      .length;
  }

  private requireProject(projectId: string) {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(projectId: string, sprintId: string) {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }
    return sprint;
  }

  private async requireSession(sessionId: string): Promise<FileBrowserSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`File browser session not found: ${sessionId}`);
    }
    return session;
  }

  private async requireRunningSession(sessionId: string): Promise<FileBrowserSession> {
    const session = await this.requireSession(sessionId);
    if (session.status !== "running" || !session.containerId) {
      throw new Error("File browser container is not running. Start it before browsing files.");
    }
    return session;
  }

  private resolveSettings(projectId: string, sprintId: string) {
    return this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings;
  }

  private resolveSprintFeatureBranch(projectId: string, sprintId: string): string {
    const sprint = this.requireSprint(projectId, sprintId);
    if (sprint.featureBranch?.trim()) {
      return sprint.featureBranch.trim();
    }
    const settings = this.resolveSettings(projectId, sprintId);
    const sprintNumber = typeof sprint.number === "number" ? sprint.number : 0;
    return formatSprintBranch(settings.git.sprintBranchScheme, {
      sprint_key_prefix: settings.git.sprintKeyPrefix,
      sprint_number: sprintNumber,
      sprint_id: sprint.slug || String(sprintNumber),
      sprint_name: sprint.name || "",
      planning_agent: settings.agents.routing.planning.agentPresetId || "default",
      agent_routing: settings.agents.routing.taskCoding.mode,
      worker_agent: settings.agents.routing.taskCoding.agentPresetId || "default",
      worker_provider: settings.workers.virtualWorkerProvider,
      worker_model: settings.workers.model,
    });
  }

  private mapDockerSourcePathForDaemon(sourcePath: string, repoPath: string): string {
    const normalizedSource = path.resolve(sourcePath);
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    const homeMapping = (process.env.JULES_DOCKER_HOST_HOME_ROOT || "").trim();
    let mapped = normalizedSource;
    if (workspaceMapping.length > 0) mapped = mapPathPrefix(mapped, repoPath, workspaceMapping);
    if (homeMapping.length > 0) mapped = mapPathPrefix(mapped, os.homedir(), homeMapping);
    return mapped;
  }

  private async resolveDockerUserSpec(workspacePath: string): Promise<string> {
    try {
      const stats = await fs.stat(workspacePath);
      if (typeof stats.uid === "number" && typeof stats.gid === "number" && stats.uid !== 0) {
        return `${stats.uid}:${stats.gid}`;
      }
    } catch {
      // fall through to getDockerUserSpec
    }
    return getDockerUserSpec();
  }

  private buildContainerName(projectId: string, sprintId: string): string {
    const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").slice(0, 22);
    return `code-ux-filebrowser-${sanitize(projectId)}-${sanitize(sprintId)}`.slice(0, 63);
  }

}
