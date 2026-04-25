import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { createHash } from "crypto";
import { sanitizeToken } from "../../../services/cli-workflow-utils.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { CommandResult, runCommandStrict } from "../../../services/cli-process-runner.js";
import { extractPathHints } from "../../../services/cli-workflow-text-utils.js";

const WORKSPACE_HANDLE_PREFIX = "docker-volume://";
const CONTAINER_WORKSPACE_ROOT = "/workspace";
const WORKSPACE_HELPER_IMAGE = "alpine/git";
const WORKSPACE_VOLUME_LABEL = "sprint-os.workspace=true";
const WORKSPACE_SESSION_LABEL_PREFIX = "sprint-os.workspace-session=";

export interface WorkspaceCommandOptions {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  trimOutput?: boolean;
}

export interface IWorkspaceManager {
  buildWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): string;
  buildWorkspaceRef(repoPath: string, workspaceKey: string, executionMode: CliWorkflowSettings["executionMode"]): string;
  createSnapshotWorkspace(repoPath: string, sessionId: string): Promise<string>;
  resolveResumeWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | undefined>;
  prepareWorktree(repoPath: string, worktreePath: string, workerBranch: string, featureBranch: string, resumeSessionId?: string): Promise<{ worktreePath: string; resumed: boolean }>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string>;
  runWorkspaceCommand(worktreePath: string, command: string, args: string[], options?: WorkspaceCommandOptions): Promise<CommandResult>;
  readWorkspaceFile(worktreePath: string, relativePath: string): Promise<string | null>;
  workspaceExists(worktreePath: string): Promise<boolean>;
  getWorkspaceDirectory(worktreePath: string): string;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const isWorkspaceHandle = (value: string): boolean => value.startsWith(WORKSPACE_HANDLE_PREFIX);

const parseWorkspaceHandle = (value: string): { volumeName: string } => {
  if (!isWorkspaceHandle(value)) {
    throw new Error(`Unsupported workspace reference: ${value}`);
  }
  const volumeName = value.slice(WORKSPACE_HANDLE_PREFIX.length).trim();
  if (!volumeName) {
    throw new Error(`Missing Docker volume name in workspace reference: ${value}`);
  }
  return { volumeName };
};

const getWorkspaceOwnerSpec = (): string | undefined => {
  const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
  if (!getUid || !getGid) {
    return undefined;
  }
  return `${getUid()}:${getGid()}`;
};

export class WorkspaceManager implements IWorkspaceManager {
  private readonly repoLocks = new Map<string, Promise<void>>();

  buildWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): string {
    return this.buildWorkspaceRef(repoPath, sessionId, executionMode);
  }

  buildWorkspaceRef(repoPath: string, workspaceKey: string, executionMode: CliWorkflowSettings["executionMode"]): string {
    if (executionMode !== "DOCKER") {
      return path.join(path.resolve(repoPath), ".worktrees", sanitizeToken(workspaceKey) || "workspace");
    }
    const normalizedRepoPath = path.resolve(repoPath);
    const repoName = sanitizeToken(path.basename(normalizedRepoPath)) || "repo";
    const repoHash = createHash("sha256").update(normalizedRepoPath).digest("hex").slice(0, 12);
    const volumeName = `sprint-os-${repoName}-${repoHash}-${sanitizeToken(workspaceKey)}`;
    return `${WORKSPACE_HANDLE_PREFIX}${volumeName}`;
  }

  async createSnapshotWorkspace(repoPath: string, sessionId: string): Promise<string> {
    const workspaceRef = this.buildWorktreePath(repoPath, `${sessionId}-snapshot`, "DOCKER");
    await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
    await this.createVolume(workspaceRef);
    await this.seedWorkspaceFromBundle(repoPath, workspaceRef);
    return workspaceRef;
  }

  async resolveResumeWorktreePath(
    repoPath: string,
    sessionId: string,
    executionMode: CliWorkflowSettings["executionMode"],
  ): Promise<string | undefined> {
    const workspaceRef = this.buildWorktreePath(repoPath, sessionId, executionMode);
    return await this.workspaceExists(workspaceRef) ? workspaceRef : undefined;
  }

  async prepareWorktree(
    repoPath: string,
    worktreePath: string,
    workerBranch: string,
    featureBranch: string,
    resumeSessionId?: string,
  ): Promise<{ worktreePath: string; resumed: boolean }> {
    let resumed = false;
    const workspaceRef = worktreePath;

    await this.withRepoLock(repoPath, async () => {
      try {
        await runCommandStrict("git", ["fetch", "origin"], repoPath);
      } catch {
        // continue with local refs when origin is unavailable
      }

      if (resumeSessionId && await this.workspaceExists(workspaceRef) && await this.canResumeExistingWorkspace(workspaceRef, workerBranch)) {
        resumed = true;
        return;
      }

      const startRef = await this.resolveWorktreeStartRef(repoPath, featureBranch);
      await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
      if (isWorkspaceHandle(workspaceRef)) {
        await this.createVolume(workspaceRef);
        await this.seedWorkspaceFromBundle(repoPath, workspaceRef);
        await this.runWorkspaceCommand(workspaceRef, "git", ["checkout", "-B", workerBranch, startRef]);
      } else {
        await fs.mkdir(path.dirname(workspaceRef), { recursive: true });
        try {
          await runCommandStrict("git", ["worktree", "add", "--force", "-B", workerBranch, workspaceRef, startRef], repoPath);
        } catch {
          await runCommandStrict("git", ["worktree", "prune"], repoPath).catch(() => undefined);
          await fs.rm(workspaceRef, { recursive: true, force: true }).catch(() => undefined);
          await runCommandStrict("git", ["worktree", "add", "--force", "-B", workerBranch, workspaceRef, startRef], repoPath);
        }
      }
    });

    return { worktreePath: workspaceRef, resumed };
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    if (isWorkspaceHandle(worktreePath)) {
      if (!await this.workspaceExists(worktreePath)) {
        return;
      }
      const { volumeName } = parseWorkspaceHandle(worktreePath);
      await runCommandStrict("docker", ["volume", "rm", "-f", volumeName], process.cwd()).catch(() => undefined);
      return;
    }

    await runCommandStrict("git", ["worktree", "remove", "--force", worktreePath], repoPath).catch(() => undefined);
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
    await runCommandStrict("git", ["worktree", "prune"], repoPath).catch(() => undefined);
  }

  async buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string> {
    const hints = extractPathHints(taskPrompt).slice(0, 10);
    const isDockerWorkspace = isWorkspaceHandle(worktreePath);
    const workspaceRoot = isDockerWorkspace ? CONTAINER_WORKSPACE_ROOT : path.resolve(worktreePath);
    const hintStatuses = await Promise.all(hints.map(async (hint) => {
      if (isDockerWorkspace) {
        const safePath = pathPosix.normalize(pathPosix.join(CONTAINER_WORKSPACE_ROOT, hint));
        if (!safePath.startsWith(`${CONTAINER_WORKSPACE_ROOT}/`) && safePath !== CONTAINER_WORKSPACE_ROOT) {
          return `- ${hint}: outside-workspace`;
        }
        const probe = await this.runWorkspaceCommand(
          worktreePath,
          "sh",
          ["-lc", `if [ -e ${shellQuote(safePath)} ]; then echo exists; else echo not-found; fi`],
        );
        return `- ${hint}: ${probe.stdout.trim() || "not-found"}`;
      }

      const safePath = path.resolve(worktreePath, hint);
      if (!safePath.startsWith(`${workspaceRoot}${path.sep}`) && safePath !== workspaceRoot) {
        return `- ${hint}: outside-workspace`;
      }
      try {
        await fs.access(safePath);
        return `- ${hint}: exists`;
      } catch {
        return `- ${hint}: not-found`;
      }
    }));

    const hintSection = hintStatuses.length > 0
      ? [
        "Task path hints (from prompt) with existence pre-check:",
        ...hintStatuses,
      ].join("\n")
      : "Task path hints (from prompt): none detected.";

    return [
      "## Workspace Context (Headless Session)",
      `Repository root: ${workspaceRoot}`,
      `Current working directory: ${workspaceRoot}`,
      "",
      "Path safety requirements:",
      "- Before any read_file call, discover exact paths first (glob/grep/find).",
      "- Use repo-relative paths from the repository root shown above.",
      "- Do not assume filenames or directories. Verify existence before reading.",
      "- If a hinted path is not found, locate the nearest real file and continue.",
      "",
      hintSection,
    ].join("\n");
  }

  async runWorkspaceCommand(
    worktreePath: string,
    command: string,
    args: string[],
    options: WorkspaceCommandOptions = {},
  ): Promise<CommandResult> {
    if (!isWorkspaceHandle(worktreePath)) {
      return await runCommandStrict(command, args, worktreePath, options.env ?? process.env, {
        signal: options.signal,
        trimOutput: options.trimOutput,
      });
    }
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const ownerSpec = getWorkspaceOwnerSpec();
    const dockerArgs = [
      "run",
      "--rm",
      "-i",
      "--workdir",
      CONTAINER_WORKSPACE_ROOT,
      "--mount",
      `type=volume,source=${volumeName},target=${CONTAINER_WORKSPACE_ROOT}`,
      "--entrypoint",
      command,
      "-e",
      `HOME=${CONTAINER_WORKSPACE_ROOT}/.sprint-os-home`,
      WORKSPACE_HELPER_IMAGE,
      ...args,
    ];
    if (ownerSpec) {
      dockerArgs.splice(dockerArgs.length - args.length - 1, 0, "--user", ownerSpec);
    }
    return await runCommandStrict("docker", dockerArgs, process.cwd(), options.env ?? process.env, {
      signal: options.signal,
      trimOutput: options.trimOutput,
    });
  }

  async readWorkspaceFile(worktreePath: string, relativePath: string): Promise<string | null> {
    if (!isWorkspaceHandle(worktreePath)) {
      const workspaceRoot = path.resolve(worktreePath);
      const resolved = path.resolve(worktreePath, relativePath);
      if (!resolved.startsWith(`${workspaceRoot}${path.sep}`) && resolved !== workspaceRoot) {
        return null;
      }
      try {
        return await fs.readFile(resolved, "utf8");
      } catch {
        return null;
      }
    }
    const normalized = pathPosix.normalize(pathPosix.join(CONTAINER_WORKSPACE_ROOT, relativePath));
    if (!normalized.startsWith(`${CONTAINER_WORKSPACE_ROOT}/`)) {
      return null;
    }
    try {
      const result = await this.runWorkspaceCommand(worktreePath, "cat", [normalized]);
      return result.stdout;
    } catch {
      return null;
    }
  }

  async workspaceExists(worktreePath: string): Promise<boolean> {
    if (!isWorkspaceHandle(worktreePath)) {
      try {
        await fs.access(worktreePath);
        return true;
      } catch {
        return false;
      }
    }
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    try {
      await runCommandStrict("docker", ["volume", "inspect", volumeName], process.cwd());
      return true;
    } catch {
      return false;
    }
  }

  getWorkspaceDirectory(worktreePath: string): string {
    return isWorkspaceHandle(worktreePath) ? CONTAINER_WORKSPACE_ROOT : path.resolve(worktreePath);
  }

  private async createVolume(worktreePath: string): Promise<void> {
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const sessionKey = volumeName.match(/^sprint-os-.+-([a-f0-9]{12})-(.+)$/)?.[2] || volumeName;
    await runCommandStrict(
      "docker",
      [
        "volume",
        "create",
        "--label",
        WORKSPACE_VOLUME_LABEL,
        "--label",
        `${WORKSPACE_SESSION_LABEL_PREFIX}${sessionKey}`,
        volumeName,
      ],
      process.cwd(),
    );
  }

  private async seedWorkspaceFromBundle(repoPath: string, worktreePath: string): Promise<void> {
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-bundle-"));
    const bundlePath = path.join(tempDir, "repo.bundle");
    const originUrl = await this.resolveOriginUrl(repoPath);
    const ownerSpec = getWorkspaceOwnerSpec();

    try {
      await runCommandStrict("git", ["bundle", "create", bundlePath, "--all"], repoPath);
      const initScript = [
        "set -e",
        "tmp=$(mktemp)",
        "cat > \"$tmp\"",
        "rm -rf /workspace/* /workspace/.[!.]* /workspace/..?* 2>/dev/null || true",
        "git init /workspace >/dev/null",
        "git -C /workspace symbolic-ref HEAD refs/heads/sprint-os-bootstrap-$$",
        "git -C /workspace remote add origin \"$tmp\"",
        "git -C /workspace fetch origin '+refs/*:refs/*' >/dev/null",
        "rm -f \"$tmp\"",
        originUrl
          ? `git -C /workspace remote set-url origin ${shellQuote(originUrl)}`
          : "git -C /workspace remote remove origin >/dev/null 2>&1 || true",
        "mkdir -p /workspace/.sprint-os-home",
        ownerSpec ? `chown -R ${shellQuote(ownerSpec)} /workspace` : null,
      ].filter((step): step is string => Boolean(step)).join(" && ");

      await runCommandStrict(
        "bash",
        [
          "-lc",
          `cat ${shellQuote(bundlePath)} | docker run --rm -i --mount type=volume,source=${shellQuote(volumeName)},target=${shellQuote(CONTAINER_WORKSPACE_ROOT)} --entrypoint sh ${shellQuote(WORKSPACE_HELPER_IMAGE)} -lc ${shellQuote(initScript)}`,
        ],
        repoPath,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async canResumeExistingWorkspace(worktreePath: string, expectedBranch: string): Promise<boolean> {
    try {
      const inside = await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--is-inside-work-tree"]);
      if (inside.stdout.trim() !== "true") {
        return false;
      }
      const branch = (await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
      if (branch !== expectedBranch) {
        await this.runWorkspaceCommand(worktreePath, "git", ["checkout", expectedBranch]);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async resolveWorktreeStartRef(repoPath: string, branch: string): Promise<string> {
    if (await this.refExists(repoPath, `refs/remotes/origin/${branch}`)) {
      return `origin/${branch}`;
    }
    if (await this.refExists(repoPath, `refs/heads/${branch}`)) {
      return branch;
    }
    throw new Error(`Cannot prepare isolated workspace: branch ${branch} does not exist locally or on origin.`);
  }

  private async refExists(repoPath: string, ref: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["show-ref", "--verify", "--quiet", ref], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveOriginUrl(repoPath: string): Promise<string | null> {
    try {
      const result = await runCommandStrict("git", ["remote", "get-url", "origin"], repoPath);
      const value = result.stdout.trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private async withRepoLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(repoPath);
    const previous = this.repoLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.repoLocks.set(key, previous.then(() => next));
    try {
      await previous;
      return await operation();
    } finally {
      release();
      if (this.repoLocks.get(key) === next) {
        this.repoLocks.delete(key);
      }
    }
  }
}

export function isDockerWorkspaceRef(value: string): boolean {
  return isWorkspaceHandle(value);
}
