import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { createHash, randomUUID } from "crypto";
import { sanitizeToken } from "../../../services/cli-workflow-utils.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { CommandResult, runCommandStrict } from "../../../services/cli-process-runner.js";
import { extractPathHints, normalizePathHint } from "../../../services/cli-workflow-text-utils.js";
import { workspaceVolumeHelperPool } from "./workspace-volume-helper.js";
import { CONTAINER_RUNTIME_HOME } from "./provider-runtime-artifacts.js";
import { getHomeCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import { getRuntimeOwnerDockerArgs } from "../../../shared/config/runtime-owner.js";
import {
  buildGitHttpAuthEnvForRepoWithFallbacks,
  buildNonInteractiveGitEnv,
  type GitHttpAuthOptions,
} from "../../../services/git-http-auth.js";

const WORKSPACE_HANDLE_PREFIX = "docker-volume://";
const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_WORKSPACE_HELPER_HOME = "/tmp/code-ux-home";
const WORKSPACE_HELPER_IMAGE = "alpine/git";
const WORKSPACE_VOLUME_LABEL = "code-ux.workspace=true";
const RUNTIME_VOLUME_LABEL = "code-ux.workspace-runtime=true";
const WORKSPACE_SESSION_LABEL_PREFIX = "code-ux.workspace-session=";
const GIT_BUNDLE_REUSE_GRACE_MS = 10_000;
const REMOTE_FETCH_FRESHNESS_MS = 3_000;
const RUNTIME_OWNER_MARKER = `${CONTAINER_RUNTIME_HOME}/.codeux-owner`;
export const CONTAINER_PERSISTENT_SKILL_STORAGE_ROOT = "/code-ux/persistent-skills";

async function canonicalizeExistingPath(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  try {
    const realPath = await fs.realpath(resolved);
    return typeof realPath === "string" && realPath.length > 0 ? realPath : resolved;
  } catch {
    return resolved;
  }
}

export interface WorkspaceCommandOptions {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  stdinFile?: string;
  trimOutput?: boolean;
}

/**
 * Branch selection for a review snapshot workspace. `branch` is the preferred
 * branch to check out (the task's worker/feature branch, or the sprint base
 * branch); `fallbackBranch` is used when `branch` does not exist on origin or
 * locally, unless `remoteOnly` is true. When omitted entirely the snapshot is checked out onto the
 * repository's current HEAD branch so the working tree is never left empty on
 * the bootstrap branch.
 */
export interface SnapshotCheckout {
  branch?: string;
  fallbackBranch?: string;
  /** When true, checkout only origin-tracking refs and never fall back to local branch refs. */
  remoteOnly?: boolean;
}

/**
 * Options controlling how a snapshot workspace is seeded.
 *
 * `singleBranch` seeds only the checkout branch (a single-ref, full-history bundle) and checks it
 * out in the same helper container, instead of bundling every ref (`--all`) and fetching all of
 * them into the volume. Repos that have run many sprints accumulate thousands of worker/feature
 * branches, so the all-ref seed copies thousands of refs the consumer never needs. Read-only,
 * single-branch consumers (planning) opt into this for a dramatically cheaper, lower-IO seed.
 */
export interface SnapshotWorkspaceOptions {
  singleBranch?: boolean;
}

export interface PrepareWorktreeOptions {
  remoteOnly?: boolean;
  /**
   * Refresh the remote refs needed to seed the workspace. Local-mode invocations disable this
   * because their task and feature branches are authoritative in the project repository.
   */
  refreshRemote?: boolean;
  /** Whether this workspace intentionally continues an already allocated worker branch. */
  allowExistingWorkerBranch?: boolean;
}

export interface IWorkspaceManager {
  buildWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): string;
  buildWorkspaceRef(repoPath: string, workspaceKey: string, executionMode: CliWorkflowSettings["executionMode"]): string;
  createSnapshotWorkspace(repoPath: string, sessionId: string, checkout?: SnapshotCheckout, options?: SnapshotWorkspaceOptions): Promise<string>;
  createHostSnapshotWorkspace(repoPath: string, sessionId: string, checkout?: SnapshotCheckout): Promise<string>;
  createOrReuseSnapshotWorkspace(
    repoPath: string,
    sessionId: string,
    checkout?: SnapshotCheckout,
    beforeCreate?: () => Promise<void>,
  ): Promise<string>;
  resolveResumeWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | undefined>;
  resolveCurrentBranch(worktreePath: string): Promise<string | null>;
  prepareWorktree(repoPath: string, worktreePath: string, workerBranch: string, featureBranch: string, resumeSessionId?: string, gitAuth?: GitHttpAuthOptions, options?: PrepareWorktreeOptions): Promise<{ worktreePath: string; resumed: boolean; createdFreshWorkerBranch?: boolean }>;
  fastForwardResumedWorkspace(worktreePath: string, workerBranch: string, repoPath: string, gitAuth?: GitHttpAuthOptions): Promise<boolean>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  reserveWorkspaceHelper(worktreePath: string): () => void;
  releaseWorkspaceHelper(worktreePath: string): Promise<void>;
  buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string>;
  runWorkspaceCommand(worktreePath: string, command: string, args: string[], options?: WorkspaceCommandOptions): Promise<CommandResult>;
  readWorkspaceFile(worktreePath: string, relativePath: string): Promise<string | null>;
  workspaceExists(worktreePath: string): Promise<boolean>;
  getWorkspaceDirectory(worktreePath: string): string;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const isWorkspaceHandle = (value: string): boolean => value.startsWith(WORKSPACE_HANDLE_PREFIX);

const sanitizePersistentStorageSegment = (value: string, fallback: string): string => {
  const safe = sanitizeToken(value).replace(/^[._-]+/, "").replace(/[._-]+$/, "");
  return safe || fallback;
};

export const buildPersistentSkillStorageHostPath = (
  projectId: string,
  agentPresetId: string,
  storageId: string,
): string => path.join(
  getHomeCodeUxPath("persistent-skill-storages"),
  sanitizePersistentStorageSegment(projectId, "project"),
  sanitizePersistentStorageSegment(agentPresetId, "agent"),
  sanitizePersistentStorageSegment(storageId, "storage"),
);

export const buildPersistentSkillStorageContainerPath = (storageId: string): string =>
  pathPosix.join(CONTAINER_PERSISTENT_SKILL_STORAGE_ROOT, sanitizePersistentStorageSegment(storageId, "storage"));

type RefLookup = (ref: string) => Promise<boolean>;

interface GitBundleLease {
  promise: Promise<{ bundlePath: string; tempDir: string }>;
  leases: number;
  cleanupTimer?: NodeJS.Timeout;
}

interface ExpiringValue<T> {
  expiresAt: number;
  promise: Promise<T>;
}

/**
 * Process-scoped knowledge about provider runtime volumes.
 *
 * Workspace preparation and provider execution intentionally use separate service objects, but
 * they operate on the same Docker volumes. Sharing this registry prevents a second manager from
 * recreating and re-chowning a runtime volume that the preparation manager just initialized.
 */
export class RuntimeVolumeRegistry {
  readonly knownPresent = new Set<string>();
  readonly owners = new Map<string, string>();
  readonly ensureOperations = new Map<string, Promise<void>>();
  readonly repairOperations = new Map<string, Promise<void>>();

  forget(runtimeVolumeName: string): void {
    this.knownPresent.delete(runtimeVolumeName);
    this.owners.delete(runtimeVolumeName);
  }

  clear(): void {
    this.knownPresent.clear();
    this.owners.clear();
    this.ensureOperations.clear();
    this.repairOperations.clear();
  }
}

const sharedRuntimeVolumeRegistry = new RuntimeVolumeRegistry();

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

export const buildRuntimeVolumeName = (workspaceVolumeName: string): string => `${workspaceVolumeName}-runtime`;

const FALLBACK_WORKER_UID = "1000:1000";

const getWorkspaceOwnerSpec = (): string => {
  const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
  if (!getUid || !getGid) {
    return FALLBACK_WORKER_UID;
  }
  const uid = getUid();
  if (uid === 0) {
    return FALLBACK_WORKER_UID;
  }
  return `${uid}:${getGid()}`;
};

const isDockerCredentialHelperError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("error getting credentials") || message.includes("docker-credential");
};

const DOCKER_WORKSPACE_ENV_KEYS = new Set([
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_ASKPASS",
  "GIT_CONFIG_COUNT",
  "GIT_INDEX_FILE",
  "GIT_TERMINAL_PROMPT",
  "GCM_INTERACTIVE",
  "SSH_ASKPASS",
]);

const DEFAULT_WORKSPACE_GIT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: "Code UX",
  GIT_AUTHOR_EMAIL: "agents@codeux.ai",
  GIT_COMMITTER_NAME: "Code UX",
  GIT_COMMITTER_EMAIL: "agents@codeux.ai",
};

const shouldForwardWorkspaceEnv = (key: string): boolean => (
  DOCKER_WORKSPACE_ENV_KEYS.has(key)
  || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
);

const buildWorkspaceEnvironment = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {
    HOME: CONTAINER_WORKSPACE_HELPER_HOME,
  };
  const dockerEnv = {
    ...DEFAULT_WORKSPACE_GIT_IDENTITY,
    ...env,
  };
  for (const [key, value] of Object.entries(dockerEnv)) {
    if (typeof value !== "string" || !shouldForwardWorkspaceEnv(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
};

const NETWORK_GIT_COMMANDS = new Set(["clone", "fetch", "ls-remote", "pull", "push", "submodule"]);

const resolveGitSubcommand = (args: readonly string[]): string | null => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "-C" || arg === "-c" || arg === "--config-env" || arg === "--git-dir" || arg === "--work-tree") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
};

const requiresNetworkedWorkspaceContainer = (command: string, args: readonly string[]): boolean => (
  command === "git" && NETWORK_GIT_COMMANDS.has(resolveGitSubcommand(args) || "")
);

const assertWorkspaceHelperResult = (
  result: CommandResult,
  command: string,
  args: readonly string[],
): CommandResult => {
  if (result.ok) return result;
  const detail = result.stderr || result.stdout || `Unknown error (exit code ${result.code ?? "unknown"}, no output captured)`;
  throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
};

export class WorkspaceManager implements IWorkspaceManager {
  private readonly repoLocks = new Map<string, Promise<void>>();
  private readonly verifiedRepoRoots = new Map<string, Promise<void>>();
  private readonly workspaceLocks = new Map<string, Promise<void>>();
  private readonly workspaceSessionIds = new Map<string, string>();
  private readonly remoteFetches = new Map<string, Promise<void>>();
  private readonly remoteFetchFreshUntil = new Map<string, number>();
  private readonly gitBundleLeases = new Map<string, GitBundleLease>();
  private readonly publicHelperImageChecks = new Map<string, Promise<void>>();
  private readonly originUrlCache = new Map<string, ExpiringValue<string | null>>();

  constructor(
    private readonly runtimeVolumeRegistry: RuntimeVolumeRegistry = sharedRuntimeVolumeRegistry,
  ) {}

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
    const sanitizedWorkspaceKey = sanitizeToken(workspaceKey);
    const workspaceToken = workspaceKey.length > 48
      ? `${sanitizedWorkspaceKey.slice(0, 39).replace(/[._-]+$/g, "")}-${createHash("sha256").update(workspaceKey).digest("hex").slice(0, 8)}`
      : sanitizedWorkspaceKey;
    const volumeName = `code-ux-${repoName}-${repoHash}-${workspaceToken}`;
    const workspaceRef = `${WORKSPACE_HANDLE_PREFIX}${volumeName}`;
    this.workspaceSessionIds.set(workspaceRef, workspaceKey);
    return workspaceRef;
  }

  async createSnapshotWorkspace(repoPath: string, sessionId: string, checkout?: SnapshotCheckout, _options?: SnapshotWorkspaceOptions): Promise<string> {
    await this.assertExactGitWorktreeRoot(repoPath);
    const workspaceRef = this.buildWorktreePath(repoPath, `${sessionId}-snapshot`, "DOCKER");
    this.workspaceSessionIds.set(workspaceRef, sessionId);
    const refLookup = this.createRefLookup(repoPath);
    await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
    await this.createVolume(workspaceRef, sessionId);
    if (await this.trySeedSingleBranchWorkspace(repoPath, workspaceRef, checkout, refLookup).catch(() => false)) {
      return workspaceRef;
    }
    await this.seedAndCheckoutVolume(
      repoPath,
      workspaceRef,
      await this.snapshotSeedBranches(repoPath, checkout),
      () => this.checkoutSnapshotBranch(repoPath, workspaceRef, checkout, refLookup),
      refLookup,
      checkout?.remoteOnly === true,
    );
    return workspaceRef;
  }

  /**
   * Creates a detached host worktree for read-only provider work such as QA.
   * HOST-mode callers must never review from the visible repository checkout,
   * because it may still be on the default branch while task work lives on a
   * worker or sprint feature branch.
   */
  async createHostSnapshotWorkspace(repoPath: string, sessionId: string, checkout?: SnapshotCheckout): Promise<string> {
    await this.assertExactGitWorktreeRoot(repoPath);
    // QA snapshot paths are also used as the spawned CLI cwd. Keeping them under
    // a deeply nested project `.worktrees` directory exceeds Windows' process
    // path limit in CI, so place the detached read-only snapshot under the OS
    // temp root with a short deterministic token instead.
    const snapshotToken = createHash("sha256")
      .update(`${path.resolve(repoPath)}:${sessionId}`)
      .digest("hex")
      .slice(0, 16);
    const workspacePath = path.join(os.tmpdir(), `code-ux-qa-${snapshotToken}`);
    await this.withWorkspaceLock(workspacePath, async () => {
      await this.removeWorktree(repoPath, workspacePath).catch(() => undefined);
      await fs.mkdir(path.dirname(workspacePath), { recursive: true });

      const candidates = [checkout?.branch, checkout?.fallbackBranch]
        .map((branch) => branch?.trim())
        .filter((branch): branch is string => Boolean(branch));
      for (const branch of candidates) {
        const refs = checkout?.remoteOnly
          ? [`refs/remotes/origin/${branch}`]
          : [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`];
        for (const ref of refs) {
          try {
            await runCommandStrict("git", ["rev-parse", "--verify", "--quiet", ref], repoPath);
            await runCommandStrict("git", ["worktree", "add", "--detach", workspacePath, ref], repoPath);
            return;
          } catch {
            // Try the next local/remote ref before falling back to the current HEAD.
          }
        }
      }
      await runCommandStrict("git", ["worktree", "add", "--detach", workspacePath, "HEAD"], repoPath);
    });
    return workspacePath;
  }

  async createOrReuseSnapshotWorkspace(
    repoPath: string,
    sessionId: string,
    checkout?: SnapshotCheckout,
    beforeCreate?: () => Promise<void>,
  ): Promise<string> {
    await this.assertExactGitWorktreeRoot(repoPath);
    const workspaceRef = this.buildWorktreePath(repoPath, `${sessionId}-snapshot`, "DOCKER");
    this.workspaceSessionIds.set(workspaceRef, sessionId);
    return await this.withWorkspaceLock(workspaceRef, async () => {
      if (await this.workspaceExists(workspaceRef)) {
        try {
          await this.assertWorkspaceHasHead(workspaceRef);
          return workspaceRef;
        } catch {
          // A restart can land after the volume is created but before its Git
          // snapshot is initialized. Do not resume into that partial workspace:
          // rebuild it from the requested branch so review/provider work sees a
          // complete repository instead of an empty volume.
          await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
        }
      }
      // Remote refs are needed only when a snapshot must actually be materialized. Keep the
      // callback inside the workspace lock so a valid preserved volume returns without network
      // traffic and concurrent creators cannot duplicate the refresh.
      await beforeCreate?.();
      const refLookup = this.createRefLookup(repoPath);
      await this.createVolume(workspaceRef, sessionId);
      if (await this.trySeedSingleBranchWorkspace(repoPath, workspaceRef, checkout, refLookup).catch(() => false)) {
        return workspaceRef;
      }
      await this.seedAndCheckoutVolume(
        repoPath,
        workspaceRef,
        await this.snapshotSeedBranches(repoPath, checkout),
        () => this.checkoutSnapshotBranch(repoPath, workspaceRef, checkout, refLookup),
        refLookup,
        checkout?.remoteOnly === true,
      );
      return workspaceRef;
    });
  }

  /**
   * Candidate branches whose refs a snapshot seed must carry so {@link checkoutSnapshotBranch} can
   * resolve its checkout: the requested branch, its fallback, and the repository's current HEAD
   * branch (the no-explicit-branch fallback). The full-seed fallback in {@link seedAndCheckoutVolume}
   * still covers the rare HEAD-detached / arbitrary-SHA case.
   */
  private async snapshotSeedBranches(repoPath: string, checkout?: SnapshotCheckout): Promise<Array<string | null | undefined>> {
    if (checkout?.remoteOnly) {
      return [checkout.branch, checkout.fallbackBranch];
    }
    return [checkout?.branch, checkout?.fallbackBranch, await this.resolveRepoCurrentBranch(repoPath)];
  }

  /**
   * Check out the requested branch inside a freshly seeded snapshot workspace.
   *
   * `seedWorkspaceFromBundle` leaves HEAD on an unborn `code-ux-bootstrap-*`
   * branch with an empty working tree (it only copies refs, it never checks one
   * out). Without this step the agent running in the snapshot — e.g. a QA review
   * — sees an empty repository or the wrong branch even though the work exists on
   * the requested branch. Resolve the desired branch against the (already
   * fetched) repository refs and check it out so the snapshot reflects the right
   * code. Falls back to the repository HEAD so the working tree is never empty.
   */
  private async checkoutSnapshotBranch(
    repoPath: string,
    workspaceRef: string,
    checkout?: SnapshotCheckout,
    refLookup: RefLookup = this.createRefLookup(repoPath),
  ): Promise<void> {
    const requested = [checkout?.branch, checkout?.fallbackBranch]
      .map((branch) => branch?.trim())
      .filter((branch): branch is string => Boolean(branch));

    for (const branch of requested) {
      // The pushed origin tip is authoritative for review (the worker/base work
      // is pushed there), so prefer it over any local ref.
      const startRef = (await refLookup(`refs/remotes/origin/${branch}`))
        ? `origin/${branch}`
        : (!checkout?.remoteOnly && await refLookup(`refs/heads/${branch}`))
          ? branch
          : null;
      if (startRef) {
        await this.runWorkspaceCommand(workspaceRef, "git", ["checkout", "-B", branch, startRef]);
        return;
      }
    }
    if (checkout?.remoteOnly && requested.length > 0) {
      throw new Error(`Cannot prepare remote-only snapshot workspace: none of ${requested.map((branch) => `origin/${branch}`).join(", ")} exists.`);
    }

    // No explicit branch resolved — mirror the repository's current checkout so
    // the snapshot is never left on the empty bootstrap branch. Remote-only snapshots
    // still require an origin-tracking ref and never fall back to local-only state.
    const headBranch = await this.resolveRepoCurrentBranch(repoPath);
    if (headBranch) {
      const startRef = (await refLookup(`refs/remotes/origin/${headBranch}`))
          ? `origin/${headBranch}`
        : (!checkout?.remoteOnly && await refLookup(`refs/heads/${headBranch}`))
          ? headBranch
          : null;
      if (startRef) {
        await this.runWorkspaceCommand(workspaceRef, "git", ["checkout", "-B", headBranch, startRef]);
        return;
      }
    }
    if (checkout?.remoteOnly) {
      throw new Error(`Cannot prepare remote-only snapshot workspace: origin/${headBranch || "HEAD"} does not exist.`);
    }

    const headSha = await this.resolveRepoHeadSha(repoPath);
    if (headSha) {
      await this.runWorkspaceCommand(workspaceRef, "git", ["checkout", headSha]);
    }
  }

  private async resolveRepoCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = await runCommandStrict("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
      const branch = result.stdout.trim();
      if (!branch || branch === "HEAD" || branch === "(unknown)") {
        return null;
      }
      return branch;
    } catch {
      return null;
    }
  }

  private async resolveRepoHeadSha(repoPath: string): Promise<string | null> {
    try {
      const result = await runCommandStrict("git", ["rev-parse", "HEAD"], repoPath);
      const sha = result.stdout.trim();
      return sha.length > 0 ? sha : null;
    } catch {
      return null;
    }
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
    gitAuth?: GitHttpAuthOptions,
    options: PrepareWorktreeOptions = {},
  ): Promise<{ worktreePath: string; resumed: boolean; createdFreshWorkerBranch?: boolean }> {
    let resumed = false;
    let createdFreshWorkerBranch = false;
    const workspaceRef = worktreePath;
    const workspaceSessionId = this.resolveWorkspaceSessionId(workspaceRef);
    const isFreshWorkerBranch = !resumeSessionId && options.allowExistingWorkerBranch !== true;

    await this.assertExactGitWorktreeRoot(repoPath);
    // Fresh remote tasks start from the feature branch; their generated worker branch normally
    // does not exist on origin yet. Continuations also refresh the worker branch because it may
    // contain the provider's previously pushed commits. Local-mode invocations skip remote
    // refresh entirely, avoiding serialized failing fetches in repositories without an origin.
    if (options.refreshRemote !== false) {
      const fetchEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth ?? {});
      const fetchRefs = Array.from(new Set(
        (resumeSessionId || options.remoteOnly !== true
          ? [workerBranch, featureBranch]
          : [featureBranch])
          .filter((branch) => Boolean(branch)),
      ));
      await Promise.all(fetchRefs.map((branch) => (
        this.fetchRemoteBranchBestEffort(repoPath, branch, fetchEnv ?? process.env)
      )));
    }

    const refLookup = this.createRefLookup(repoPath);

    await this.withWorkspaceLock(workspaceRef, async () => {
      await this.assertExactGitWorktreeRoot(repoPath);

      if (resumeSessionId && await this.workspaceExists(workspaceRef) && await this.canResumeExistingWorkspace(workspaceRef, workerBranch)) {
        // Re-point the resumed workspace at the already-pushed worker-branch tip so a
        // follow-up run (e.g. continuing on a different provider) commits on top of the
        // pushed history instead of a stale base ref, which would be rejected as a
        // non-fast-forward push. No-ops when the workspace is already at the tip.
        await this.fastForwardResumedWorkspace(workspaceRef, workerBranch, repoPath, gitAuth).catch(() => undefined);
        resumed = true;
        return;
      }

      const startRef = await this.resolveWorktreeStartRef(
        repoPath,
        workerBranch,
        featureBranch,
        refLookup,
        options.remoteOnly === true,
        !isFreshWorkerBranch,
      );
      if (isWorkspaceHandle(workspaceRef)) {
        await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
        await this.createVolume(workspaceRef, workspaceSessionId);
        // Coding tasks only need the worker and feature branches to resolve the start ref; seed just
        // those instead of every accumulated branch (falls back to the full seed if a ref is missing).
        await this.seedAndCheckoutBranchVolume(
          repoPath,
          workspaceRef,
          [workerBranch, featureBranch],
          workerBranch,
          startRef,
          refLookup,
          options.remoteOnly === true,
        );
        try {
          await this.assertWorkspaceHasHead(workspaceRef);
        } catch {
          await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
          await this.createVolume(workspaceRef, workspaceSessionId);
          await this.seedWorkspaceFromBundle(
            repoPath,
            workspaceRef,
            undefined,
            [workerBranch, featureBranch],
            { branch: workerBranch, startRef },
          );
          await this.assertWorkspaceHasHead(workspaceRef);
        }
      } else {
        await this.withRepoLock(repoPath, async () => {
          await this.removeWorktree(repoPath, workspaceRef).catch(() => undefined);
          await fs.mkdir(path.dirname(workspaceRef), { recursive: true });
          const worktreeArgs = isFreshWorkerBranch
            ? ["worktree", "add", "--force", "-b", workerBranch, workspaceRef, startRef]
            : ["worktree", "add", "--force", "-B", workerBranch, workspaceRef, startRef];
          try {
            await runCommandStrict("git", worktreeArgs, repoPath);
          } catch {
            await runCommandStrict("git", ["worktree", "prune"], repoPath).catch(() => undefined);
            await fs.rm(workspaceRef, { recursive: true, force: true }).catch(() => undefined);
            await runCommandStrict("git", worktreeArgs, repoPath);
          }
          createdFreshWorkerBranch = isFreshWorkerBranch;
        });
      }
    });

    return { worktreePath: workspaceRef, resumed, createdFreshWorkerBranch };
  }

  private async assertWorkspaceHasHead(worktreePath: string): Promise<void> {
    await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--verify", "HEAD"]);
  }

  /**
   * Re-point a resumed workspace at the already-pushed worker-branch tip.
   *
   * Docker-volume workspaces are independent clones, so the host-side
   * commit-tree/update-ref that finalises a task never advances the volume's
   * branch ref — it stays parked on the original start ref with the prior work
   * sitting as uncommitted changes. A follow-up run (a QA fix or a restart on a
   * different provider) that commits from that stale base produces a commit which
   * does not descend from origin, so the push is rejected as non-fast-forward.
   * Fetch the pushed tip and fast-forward the workspace onto it so subsequent
   * commits descend from origin.
   *
   * Only fast-forwards when the current HEAD is an ancestor of the pushed tip, so
   * unpushed local work (e.g. an interrupted failed run that never pushed) is
   * never discarded. Returns true when the workspace was advanced.
   */
  async fastForwardResumedWorkspace(
    worktreePath: string,
    workerBranch: string,
    repoPath: string,
    gitAuth?: GitHttpAuthOptions,
  ): Promise<boolean> {
    const baseAuthEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth ?? {});
    const fetchEnv = buildNonInteractiveGitEnv(baseAuthEnv ?? process.env);
    let fetchedTip = false;
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["fetch", "origin", workerBranch], { env: fetchEnv });
      fetchedTip = true;
    } catch {
      // origin may be unavailable or not yet have the branch; fall back to local refs.
    }

    const tip = await this.resolveWorkspaceRef(worktreePath, [
      ...(fetchedTip ? ["FETCH_HEAD"] : []),
      `refs/remotes/origin/${workerBranch}`,
      `refs/heads/${workerBranch}`,
    ]);
    if (!tip) {
      return false;
    }
    const currentHead = await this.resolveWorkspaceRef(worktreePath, ["HEAD"]);
    if (!currentHead || currentHead === tip) {
      return false;
    }
    const fastForwardable = await this.runWorkspaceCommand(
      worktreePath,
      "git",
      ["merge-base", "--is-ancestor", currentHead, tip],
    ).then(() => true).catch(() => false);
    if (!fastForwardable) {
      return false;
    }
    await this.runWorkspaceCommand(worktreePath, "git", ["reset", "--hard", tip]);
    return true;
  }

  private async resolveWorkspaceRef(worktreePath: string, candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
      const sha = (await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--verify", "--quiet", candidate])
        .catch(() => null))?.stdout.trim();
      if (sha) {
        return sha;
      }
    }
    return null;
  }

  async resolveCurrentBranch(worktreePath: string): Promise<string | null> {
    if (!await this.workspaceExists(worktreePath)) {
      return null;
    }
    try {
      const result = await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = result.stdout.trim();
      if (!branch || branch === "HEAD" || branch === "(unknown)") {
        return null;
      }
      return branch;
    } catch {
      return null;
    }
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    if (isWorkspaceHandle(worktreePath)) {
      const { volumeName } = parseWorkspaceHandle(worktreePath);
      if (!await this.isCodeUxManagedVolume(volumeName)) {
        const runtimeVolumeName = buildRuntimeVolumeName(volumeName);
        this.runtimeVolumeRegistry.forget(runtimeVolumeName);
        this.workspaceSessionIds.delete(worktreePath);
        return;
      }
      // Tear down the persistent read helper first; it holds the volume mounted and would
      // otherwise block its removal.
      await workspaceVolumeHelperPool.releaseVolume(volumeName).catch(() => undefined);
      const runtimeVolumeName = buildRuntimeVolumeName(volumeName);
      await Promise.all([
        runCommandStrict("docker", ["volume", "rm", "-f", volumeName], process.cwd()).catch(() => undefined),
        runCommandStrict("docker", ["volume", "rm", "-f", runtimeVolumeName], process.cwd()).catch(() => undefined),
      ]);
      this.runtimeVolumeRegistry.forget(runtimeVolumeName);
      this.workspaceSessionIds.delete(worktreePath);
      return;
    }

    await runCommandStrict("git", ["worktree", "remove", "--force", worktreePath], repoPath).catch(() => undefined);
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
    await runCommandStrict("git", ["worktree", "prune"], repoPath).catch(() => undefined);
  }

  async releaseWorkspaceHelper(worktreePath: string): Promise<void> {
    if (!isWorkspaceHandle(worktreePath)) return;
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    await workspaceVolumeHelperPool.releaseVolume(volumeName);
  }

  reserveWorkspaceHelper(worktreePath: string): () => void {
    if (!isWorkspaceHandle(worktreePath)) return () => undefined;
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    // Normal workspace commands mount both the task workspace and its provider-runtime volume.
    // Reservations must use that exact composite key or the live helper remains LRU-evictable.
    return workspaceVolumeHelperPool.reserve(volumeName, buildRuntimeVolumeName(volumeName));
  }

  async buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string> {
    const hints = extractPathHints(taskPrompt).slice(0, 10);
    const isDockerWorkspace = isWorkspaceHandle(worktreePath);
    const workspaceRoot = isDockerWorkspace ? CONTAINER_WORKSPACE_ROOT : path.resolve(worktreePath);
    const hintStatuses = await Promise.all(hints.map(async (hint) => {
      const normalizedHint = normalizePathHint(hint);
      if (isDockerWorkspace) {
        const safePath = pathPosix.normalize(pathPosix.join(CONTAINER_WORKSPACE_ROOT, normalizedHint));
        if (!safePath.startsWith(`${CONTAINER_WORKSPACE_ROOT}/`) && safePath !== CONTAINER_WORKSPACE_ROOT) {
          return `- ${normalizedHint}: outside-workspace`;
        }
        const probe = await this.runWorkspaceCommand(
          worktreePath,
          "sh",
          ["-lc", `if [ -e ${shellQuote(safePath)} ]; then echo exists; else echo not-found; fi`],
        );
        return `- ${normalizedHint}: ${probe.stdout.trim() || "not-found"}`;
      }

      const safePath = path.resolve(worktreePath, normalizedHint);
      if (!safePath.startsWith(`${workspaceRoot}${path.sep}`) && safePath !== workspaceRoot) {
        return `- ${normalizedHint}: outside-workspace`;
      }
      try {
        await fs.access(safePath);
        return `- ${normalizedHint}: exists`;
      } catch {
        return `- ${normalizedHint}: not-found`;
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
        stdinFile: options.stdinFile,
        trimOutput: options.trimOutput,
      });
    }
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const ownerSpec = getWorkspaceOwnerSpec();
    await this.ensurePublicHelperImage(WORKSPACE_HELPER_IMAGE, process.cwd(), options.env ?? process.env);
    if (requiresNetworkedWorkspaceContainer(command, args)) {
      return await this.runNetworkedWorkspaceCommand(volumeName, command, args, options, ownerSpec);
    }
    const result = await workspaceVolumeHelperPool.exec(
      volumeName,
      [command, ...args],
      buildRuntimeVolumeName(volumeName),
      {
        environment: buildWorkspaceEnvironment(options.env ?? process.env),
        signal: options.signal,
        stdinFile: options.stdinFile,
        trimOutput: options.trimOutput,
        user: ownerSpec,
        workdir: CONTAINER_WORKSPACE_ROOT,
      },
    );
    return assertWorkspaceHelperResult(result, command, args);
  }

  private async runNetworkedWorkspaceCommand(
    volumeName: string,
    command: string,
    args: string[],
    options: WorkspaceCommandOptions,
    ownerSpec: string,
  ): Promise<CommandResult> {
    const environment = buildWorkspaceEnvironment(options.env ?? process.env);
    const containerName = `code-ux-net-git-${createHash("sha1")
      .update(`${volumeName}:${randomUUID()}`)
      .digest("hex")
      .slice(0, 24)}`;
    const dockerArgs = [
      "run",
      "--rm",
      "-i",
      "--name",
      containerName,
      "--label",
      "code-ux.managed=true",
      "--label",
      "code-ux.helper=network-git",
      ...getRuntimeOwnerDockerArgs(),
      "--security-opt",
      "no-new-privileges",
      "--pull",
      "never",
      "--workdir",
      CONTAINER_WORKSPACE_ROOT,
      "--mount",
      `type=volume,source=${volumeName},target=${CONTAINER_WORKSPACE_ROOT}`,
      "--mount",
      "type=tmpfs,target=/git",
      "--entrypoint",
      command,
      ...Object.entries(environment).flatMap(([key, value]) => typeof value === "string" ? ["-e", `${key}=${value}`] : []),
      WORKSPACE_HELPER_IMAGE,
      ...args,
    ];
    if (ownerSpec) {
      dockerArgs.splice(dockerArgs.length - args.length - 1, 0, "--user", ownerSpec);
    }
    return await runCommandStrict("docker", dockerArgs, process.cwd(), options.env ?? process.env, {
      signal: options.signal,
      stdinFile: options.stdinFile,
      trimOutput: options.trimOutput,
    });
  }

  async readWorkspaceFile(worktreePath: string, relativePath: string): Promise<string | null> {
    const normalizedRelativePath = normalizePathHint(relativePath);
    if (
      normalizedRelativePath.startsWith("/")
      || normalizedRelativePath.startsWith("//")
      || /^[A-Za-z]:\//.test(normalizedRelativePath)
    ) {
      return null;
    }
    if (!isWorkspaceHandle(worktreePath)) {
      const workspaceRoot = path.resolve(worktreePath);
      const resolved = path.resolve(worktreePath, normalizedRelativePath);
      if (!resolved.startsWith(`${workspaceRoot}${path.sep}`) && resolved !== workspaceRoot) {
        return null;
      }
      try {
        return await fs.readFile(resolved, "utf8");
      } catch {
        return null;
      }
    }
    const normalized = pathPosix.normalize(pathPosix.join(CONTAINER_WORKSPACE_ROOT, normalizedRelativePath));
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

  private async createVolume(worktreePath: string, workspaceSessionId?: string): Promise<void> {
    const resolvedWorkspaceSessionId = workspaceSessionId?.trim() || this.resolveWorkspaceSessionId(worktreePath);
    this.workspaceSessionIds.set(worktreePath, resolvedWorkspaceSessionId);
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    await this.createManagedWorkspaceVolume(volumeName, resolvedWorkspaceSessionId);
    await this.ensureRuntimeVolume(worktreePath, { initializeOwnership: false });
  }

  async ensureRuntimeVolume(
    worktreePath: string,
    options: {
      initializeOwnership?: boolean;
      ownerSpec?: string;
      forceOwnershipInitialization?: boolean;
    } = {},
  ): Promise<void> {
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const runtimeVolumeName = buildRuntimeVolumeName(volumeName);
    const ownerSpec = options.ownerSpec || getWorkspaceOwnerSpec();
    for (;;) {
      const existing = this.runtimeVolumeRegistry.ensureOperations.get(runtimeVolumeName);
      if (existing) {
        await existing;
        continue;
      }
      if (
        this.runtimeVolumeRegistry.knownPresent.has(runtimeVolumeName)
        && (
          options.initializeOwnership === false
          || !ownerSpec
          || (
            !options.forceOwnershipInitialization
            && this.runtimeVolumeRegistry.owners.get(runtimeVolumeName) === ownerSpec
          )
        )
      ) {
        return;
      }
      const ensure = this.ensureRuntimeVolumeInternal(
        worktreePath,
        runtimeVolumeName,
        ownerSpec,
        options,
      ).finally(() => {
        if (this.runtimeVolumeRegistry.ensureOperations.get(runtimeVolumeName) === ensure) {
          this.runtimeVolumeRegistry.ensureOperations.delete(runtimeVolumeName);
        }
      });
      this.runtimeVolumeRegistry.ensureOperations.set(runtimeVolumeName, ensure);
      return await ensure;
    }
  }

  private async ensureRuntimeVolumeInternal(
    worktreePath: string,
    runtimeVolumeName: string,
    ownerSpec: string,
    options: {
      initializeOwnership?: boolean;
      forceOwnershipInitialization?: boolean;
    },
  ): Promise<void> {
    if (!this.runtimeVolumeRegistry.knownPresent.has(runtimeVolumeName)) {
      const sessionKey = this.resolveWorkspaceSessionId(worktreePath);
      await runCommandStrict(
        "docker",
        [
          "volume",
          "create",
          "--label",
          RUNTIME_VOLUME_LABEL,
          "--label",
          `${WORKSPACE_SESSION_LABEL_PREFIX}${sessionKey}`,
          ...getRuntimeOwnerDockerArgs(),
          runtimeVolumeName,
        ],
        process.cwd(),
      );
      this.runtimeVolumeRegistry.knownPresent.add(runtimeVolumeName);
    }
    if (
      options.initializeOwnership === false
      || !ownerSpec
      || (
        !options.forceOwnershipInitialization
        && this.runtimeVolumeRegistry.owners.get(runtimeVolumeName) === ownerSpec
      )
    ) {
      return;
    }
    await this.initializeRuntimeVolumeOwnership(runtimeVolumeName, ownerSpec);
    this.runtimeVolumeRegistry.owners.set(runtimeVolumeName, ownerSpec);
  }

  async repairRuntimeVolume(
    worktreePath: string,
    options: { initializeOwnership: boolean; ownerSpec?: string },
  ): Promise<void> {
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const runtimeVolumeName = buildRuntimeVolumeName(volumeName);
    const existing = this.runtimeVolumeRegistry.repairOperations.get(runtimeVolumeName);
    if (existing) return await existing;
    const repair = this.repairRuntimeVolumeInternal(worktreePath, volumeName, runtimeVolumeName, options)
      .finally(() => {
        if (this.runtimeVolumeRegistry.repairOperations.get(runtimeVolumeName) === repair) {
          this.runtimeVolumeRegistry.repairOperations.delete(runtimeVolumeName);
        }
      });
    this.runtimeVolumeRegistry.repairOperations.set(runtimeVolumeName, repair);
    return await repair;
  }

  private async repairRuntimeVolumeInternal(
    worktreePath: string,
    workspaceVolumeName: string,
    runtimeVolumeName: string,
    options: { initializeOwnership: boolean; ownerSpec?: string },
  ): Promise<void> {
    this.runtimeVolumeRegistry.forget(runtimeVolumeName);
    const managed = await runCommandStrict(
      "docker",
      ["volume", "inspect", "--format", "{{ index .Labels \"code-ux.workspace-runtime\" }}", runtimeVolumeName],
      process.cwd(),
    ).then((result) => result.stdout.trim() === "true").catch(() => false);
    if (managed) {
      this.runtimeVolumeRegistry.knownPresent.add(runtimeVolumeName);
    } else {
      await workspaceVolumeHelperPool.releaseVolume(workspaceVolumeName).catch(() => undefined);
      await runCommandStrict("docker", ["volume", "rm", "-f", runtimeVolumeName], process.cwd()).catch(() => undefined);
    }
    await this.ensureRuntimeVolume(worktreePath, {
      initializeOwnership: options.initializeOwnership,
      ownerSpec: options.ownerSpec,
      forceOwnershipInitialization: true,
    });
  }

  private async createManagedWorkspaceVolume(volumeName: string, sessionKey: string): Promise<void> {
    await runCommandStrict(
      "docker",
      [
        "volume",
        "create",
        "--label",
        WORKSPACE_VOLUME_LABEL,
        "--label",
        `${WORKSPACE_SESSION_LABEL_PREFIX}${sessionKey}`,
        ...getRuntimeOwnerDockerArgs(),
        volumeName,
      ],
      process.cwd(),
    );
  }

  private resolveWorkspaceSessionId(worktreePath: string): string {
    const remembered = this.workspaceSessionIds.get(worktreePath)?.trim();
    if (remembered) {
      return remembered;
    }
    if (!isWorkspaceHandle(worktreePath)) {
      return path.basename(worktreePath);
    }
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    return volumeName.match(/^code-ux-.+-([a-f0-9]{12})-(.+)$/)?.[2] || volumeName;
  }

  private async initializeRuntimeVolumeOwnership(
    runtimeVolumeName: string,
    ownerSpec: string,
  ): Promise<void> {
    await this.ensurePublicHelperImage(WORKSPACE_HELPER_IMAGE, process.cwd(), process.env);
    await runCommandStrict(
      "docker",
      [
        "run",
        "--rm",
        "--mount",
        `type=volume,source=${runtimeVolumeName},target=${CONTAINER_RUNTIME_HOME}`,
        "--entrypoint",
        "sh",
        WORKSPACE_HELPER_IMAGE,
        "-lc",
        this.buildRuntimeOwnershipInitializationScript(ownerSpec),
      ],
      process.cwd(),
    );
  }

  private buildRuntimeOwnershipInitializationScript(ownerSpec: string): string {
    const quotedOwner = shellQuote(ownerSpec);
    const quotedHome = shellQuote(CONTAINER_RUNTIME_HOME);
    const quotedMarker = shellQuote(RUNTIME_OWNER_MARKER);
    return [
      `owner=${quotedOwner}`,
      `marker=${quotedMarker}`,
      `current_owner="$(stat -c '%u:%g' ${quotedHome} 2>/dev/null || true)"`,
      `marked_owner="$(cat "$marker" 2>/dev/null || true)"`,
      `if [ "$current_owner" != "$owner" ] || [ "$marked_owner" != "$owner" ]; then chown -R "$owner" ${quotedHome}; printf '%s\\n' "$owner" > "$marker"; chown "$owner" "$marker"; fi`,
    ].join("; ");
  }

  private buildRuntimeOwnershipMarkerCommand(ownerSpec: string): string {
    return [
      `printf '%s\\n' ${shellQuote(ownerSpec)} > ${shellQuote(RUNTIME_OWNER_MARKER)}`,
      `chown ${shellQuote(ownerSpec)} ${shellQuote(RUNTIME_OWNER_MARKER)}`,
    ].join(" && ");
  }

  private async isCodeUxManagedVolume(volumeName: string): Promise<boolean> {
    if (!volumeName.startsWith("code-ux-")) {
      return false;
    }
    try {
      const inspected = await runCommandStrict(
        "docker",
        ["volume", "inspect", "--format", "{{ index .Labels \"code-ux.workspace\" }}", volumeName],
        process.cwd(),
      );
      return inspected.stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Seeds only a resolved snapshot branch and checks it out in the same helper container. Snapshot
   * workspaces never need unrelated refs, so this is the normal path for planning, QA, and replies;
   * unresolved/detached refs still fall back to the complete seed below.
   */
  private async trySeedSingleBranchWorkspace(
    repoPath: string,
    worktreePath: string,
    checkout?: SnapshotCheckout,
    refLookup: RefLookup = this.createRefLookup(repoPath),
  ): Promise<boolean> {
    const candidates = [checkout?.branch, checkout?.fallbackBranch]
      .map((branch) => branch?.trim())
      .filter((branch): branch is string => Boolean(branch));
    const requested = candidates.length > 0 ? candidates : [await this.resolveRepoCurrentBranch(repoPath)];

    let resolvedBranch: string | null = null;
    let resolvedStartRef: string | null = null;
    for (const candidate of requested) {
      if (!candidate) {
        continue;
      }
      const remoteRef = `refs/remotes/origin/${candidate}`;
      const localRef = `refs/heads/${candidate}`;
      if (await refLookup(remoteRef)) {
        resolvedBranch = candidate;
        resolvedStartRef = remoteRef;
        break;
      }
      if (checkout?.remoteOnly) {
        continue;
      }
      if (await refLookup(localRef)) {
        resolvedBranch = candidate;
        resolvedStartRef = localRef;
        break;
      }
    }
    if (!resolvedBranch || !resolvedStartRef) {
      return false;
    }

    await this.seedWorkspaceFromBundle(
      repoPath,
      worktreePath,
      [resolvedStartRef],
      [resolvedBranch],
      { branch: resolvedBranch, startRef: resolvedStartRef },
    );
    return true;
  }

  /**
   * Returns the subset of `refs/heads/<b>` and `refs/remotes/origin/<b>` that actually exist on the
   * host for each candidate branch — the exact refs a targeted seed must carry so the volume can
   * later check out either the local or origin-tracking form of those branches.
   */
  private async resolveExistingSeedRefs(
    repoPath: string,
    branches: Array<string | null | undefined>,
    refLookup: RefLookup,
    remoteOnly = false,
  ): Promise<string[]> {
    const refs: string[] = [];
    const seen = new Set<string>();
    for (const branch of branches) {
      const name = branch?.trim();
      if (!name) {
        continue;
      }
      const candidates = remoteOnly
        ? [`refs/remotes/origin/${name}`]
        : [`refs/remotes/origin/${name}`, `refs/heads/${name}`];
      for (const ref of candidates) {
        if (!seen.has(ref) && await refLookup(ref)) {
          seen.add(ref);
          refs.push(ref);
        }
      }
    }
    return refs;
  }

  /**
   * Seeds a workspace volume with only the refs the given branches need, then runs `checkout`. If
   * the targeted seed misses a ref the checkout requires (the checkout throws), the volume is
   * re-seeded with every ref and the checkout retried once — so this is never less correct than the
   * full seed, just cheaper in the common case. Re-seeding fully resets the volume (the init script
   * wipes `/workspace` and re-inits), so the retry starts clean.
   */
  private async seedAndCheckoutVolume(
    repoPath: string,
    worktreePath: string,
    branches: Array<string | null | undefined>,
    checkout: () => Promise<void>,
    refLookup: RefLookup = this.createRefLookup(repoPath),
    remoteOnly = false,
  ): Promise<void> {
    const seedRefs = await this.resolveExistingSeedRefs(repoPath, branches, refLookup, remoteOnly);
    if (seedRefs.length === 0) {
      await this.seedWorkspaceFromBundle(repoPath, worktreePath, undefined, branches);
      await checkout();
      return;
    }
    await this.seedWorkspaceFromBundle(repoPath, worktreePath, seedRefs, branches);
    try {
      await checkout();
    } catch {
      await this.seedWorkspaceFromBundle(repoPath, worktreePath, undefined, branches);
      await checkout();
    }
  }

  private async seedAndCheckoutBranchVolume(
    repoPath: string,
    worktreePath: string,
    branches: Array<string | null | undefined>,
    checkoutBranch: string,
    startRef: string,
    refLookup: RefLookup = this.createRefLookup(repoPath),
    remoteOnly = false,
  ): Promise<void> {
    const checkout = { branch: checkoutBranch, startRef };
    const seedRefs = await this.resolveExistingSeedRefs(repoPath, branches, refLookup, remoteOnly);
    if (seedRefs.length === 0) {
      await this.seedWorkspaceFromBundle(repoPath, worktreePath, undefined, branches, checkout);
      return;
    }
    try {
      await this.seedWorkspaceFromBundle(repoPath, worktreePath, seedRefs, branches, checkout);
    } catch {
      await this.seedWorkspaceFromBundle(repoPath, worktreePath, undefined, branches, checkout);
    }
  }

  /**
   * Seeds the workspace volume from a host git bundle. By default it bundles every ref (`--all`),
   * which on repos that have run many sprints copies thousands of accumulated branches the consumer
   * never needs. Pass `seedRefs` (concrete refs that exist on the host) to bundle only those — the
   * caller is responsible for including every ref its checkout will consult. The volume's
   * `+refs/*:refs/*` fetch preserves the full ref path, so both `refs/heads/x` and
   * `refs/remotes/origin/x` resolve afterwards exactly as with the full seed.
   */
  private async seedWorkspaceFromBundle(
    repoPath: string,
    worktreePath: string,
    seedRefs?: string[],
    localBranchAliases?: Array<string | null | undefined>,
    checkout?: { branch: string; startRef: string },
  ): Promise<void> {
    const { volumeName } = parseWorkspaceHandle(worktreePath);
    const runtimeVolumeName = buildRuntimeVolumeName(volumeName);
    const originUrl = await this.resolveOriginUrl(repoPath);
    const ownerSpec = getWorkspaceOwnerSpec();

    await this.ensurePublicHelperImage(WORKSPACE_HELPER_IMAGE, repoPath, process.env);
    const bundleRefArgs = seedRefs && seedRefs.length > 0 ? seedRefs : ["--all"];
    await this.withGitBundle(repoPath, bundleRefArgs, async (bundlePath) => {
      const initScript = [
        "set -e",
        "tmp=$(mktemp)",
        "cat > \"$tmp\"",
        "(rm -rf /workspace/* /workspace/.[!.]* /workspace/..?* 2>/dev/null || true)",
        // The helper is root while the persistent volume root belongs to the provider UID/GID.
        "git config --global --add safe.directory /workspace",
        "git init /workspace >/dev/null",
        "git -C /workspace symbolic-ref HEAD refs/heads/code-ux-bootstrap-$$",
        "git -C /workspace remote add origin \"$tmp\"",
        "git -C /workspace fetch origin '+refs/*:refs/*' >/dev/null",
        "rm -f \"$tmp\"",
        originUrl
          ? `git -C /workspace remote set-url origin ${shellQuote(originUrl)}`
          : "(git -C /workspace remote remove origin >/dev/null 2>&1 || true)",
        ...this.buildLocalBranchAliasCommands(localBranchAliases),
        "git -C /workspace config user.name \"${CODE_UX_GIT_USER_NAME:-Code UX}\"",
        "git -C /workspace config user.email \"${CODE_UX_GIT_USER_EMAIL:-agents@codeux.ai}\"",
        checkout
          ? `git -C /workspace checkout -B ${shellQuote(checkout.branch)} ${shellQuote(checkout.startRef)} >/dev/null`
          : null,
        ownerSpec ? `chown -R ${shellQuote(ownerSpec)} /workspace ${shellQuote(CONTAINER_RUNTIME_HOME)}` : null,
        ownerSpec ? this.buildRuntimeOwnershipMarkerCommand(ownerSpec) : null,
      ].filter((step): step is string => Boolean(step)).join(" && ");

      const commandArgs = ["sh", "-lc", initScript];
      const result = await workspaceVolumeHelperPool.exec(
        volumeName,
        commandArgs,
        runtimeVolumeName,
        {
          environment: buildWorkspaceEnvironment(process.env),
          stdinFile: bundlePath,
          workdir: CONTAINER_WORKSPACE_ROOT,
        },
      );
      assertWorkspaceHelperResult(result, commandArgs[0], commandArgs.slice(1));
      if (ownerSpec) this.runtimeVolumeRegistry.owners.set(runtimeVolumeName, ownerSpec);
      this.runtimeVolumeRegistry.knownPresent.add(runtimeVolumeName);
    });
  }

  private async withGitBundle<T>(
    repoPath: string,
    bundleRefArgs: string[],
    useBundle: (bundlePath: string) => Promise<T>,
  ): Promise<T> {
    const cacheKey = await this.resolveGitBundleCacheKey(repoPath, bundleRefArgs);
    const reuseGraceMs = this.resolveGitBundleReuseGraceMs(bundleRefArgs);
    let lease = this.gitBundleLeases.get(cacheKey);
    if (!lease) {
      lease = {
        promise: this.createGitBundle(repoPath, bundleRefArgs),
        leases: 0,
      };
      this.gitBundleLeases.set(cacheKey, lease);
    } else if (lease.cleanupTimer) {
      clearTimeout(lease.cleanupTimer);
      lease.cleanupTimer = undefined;
    }

    lease.leases += 1;
    try {
      const { bundlePath } = await lease.promise;
      return await useBundle(bundlePath);
    } finally {
      lease.leases -= 1;
      if (lease.leases === 0) {
        if (reuseGraceMs === 0) {
          this.gitBundleLeases.delete(cacheKey);
          await lease.promise
            .then(({ tempDir }) => fs.rm(tempDir, { recursive: true, force: true }))
            .catch(() => undefined);
        } else {
          lease.cleanupTimer = setTimeout(() => {
          if (lease.leases !== 0 || this.gitBundleLeases.get(cacheKey) !== lease) {
            return;
          }
          this.gitBundleLeases.delete(cacheKey);
          void lease.promise
            .then(({ tempDir }) => fs.rm(tempDir, { recursive: true, force: true }))
            .catch(() => undefined);
          }, reuseGraceMs);
          lease.cleanupTimer.unref?.();
        }
      }
    }
  }

  private resolveGitBundleReuseGraceMs(bundleRefArgs: string[]): number {
    return bundleRefArgs.length === 1 && bundleRefArgs[0] === "--all"
      ? 0
      : GIT_BUNDLE_REUSE_GRACE_MS;
  }

  private async resolveGitBundleCacheKey(repoPath: string, bundleRefArgs: string[]): Promise<string> {
    if (bundleRefArgs.length === 1 && bundleRefArgs[0] === "--all") {
      return `${path.resolve(repoPath)}\0--all`;
    }
    const refTips = await Promise.all(bundleRefArgs.map(async (ref) => {
      try {
        const result = await runCommandStrict("git", ["rev-parse", "--verify", ref], repoPath);
        return `${ref}:${result.stdout.trim()}`;
      } catch {
        return `${ref}:missing`;
      }
    }));
    return `${path.resolve(repoPath)}\0${refTips.join("\0")}`;
  }

  private async createGitBundle(repoPath: string, bundleRefArgs: string[]): Promise<{ bundlePath: string; tempDir: string }> {
    // Keep the temporary output under `.git` so the project helper's existing bind mount can write
    // it via `docker exec`. An OS-temp destination needs an extra bind mount and forces the command
    // runner back to a cold one-shot Git container. Linked worktrees whose `.git` is a file safely
    // fall back to the OS temp root.
    let tempDir: string;
    try {
      const bundleRoot = path.join(path.resolve(repoPath), ".git", "code-ux-bundles");
      await fs.mkdir(bundleRoot, { recursive: true, mode: 0o700 });
      tempDir = await fs.mkdtemp(path.join(bundleRoot, "bundle-"));
    } catch {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-bundle-"));
    }
    const bundlePath = path.join(tempDir, "repo.bundle");
    try {
      await runCommandStrict("git", ["bundle", "create", bundlePath, ...bundleRefArgs], repoPath);
      return { bundlePath, tempDir };
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private buildLocalBranchAliasCommands(branches?: Array<string | null | undefined>): string[] {
    if (!branches || branches.length === 0) {
      return [];
    }
    const uniqueBranches = Array.from(new Set(branches.map((branch) => branch?.trim()).filter(Boolean) as string[]));
    return uniqueBranches.map((branch) => {
      const localRef = `refs/heads/${branch}`;
      const remoteRef = `refs/remotes/origin/${branch}`;
      return [
        `if ! git -C /workspace show-ref --verify --quiet ${shellQuote(localRef)}`,
        `&& git -C /workspace show-ref --verify --quiet ${shellQuote(remoteRef)}`,
        `; then git -C /workspace update-ref ${shellQuote(localRef)} ${shellQuote(remoteRef)}; fi`,
      ].join(" ");
    });
  }

  private async ensurePublicHelperImage(image: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    const existingCheck = this.publicHelperImageChecks.get(image);
    if (existingCheck) {
      await existingCheck;
      return;
    }

    const check = this.ensurePublicHelperImageUncached(image, cwd, env).catch((error) => {
      this.publicHelperImageChecks.delete(image);
      throw error;
    });
    this.publicHelperImageChecks.set(image, check);
    await check;
  }

  private async ensurePublicHelperImageUncached(image: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    try {
      await runCommandStrict("docker", ["image", "inspect", image], cwd, env);
      return;
    } catch {
      // Missing local public helper image. Pull below.
    }

    try {
      await runCommandStrict("docker", ["pull", image], cwd, env);
      return;
    } catch (error) {
      if (!isDockerCredentialHelperError(error)) {
        throw error;
      }
    }

    const dockerConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-docker-config-"));
    try {
      await fs.writeFile(path.join(dockerConfigDir, "config.json"), "{}\n", "utf8");
      await runCommandStrict(
        "docker",
        ["pull", image],
        cwd,
        {
          ...env,
          DOCKER_CONFIG: dockerConfigDir,
        },
      );
    } finally {
      await fs.rm(dockerConfigDir, { recursive: true, force: true }).catch(() => undefined);
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

  private async resolveWorktreeStartRef(
    repoPath: string,
    workerBranch: string,
    featureBranch: string,
    refLookup: RefLookup = this.createRefLookup(repoPath),
    remoteOnly = false,
    includeWorkerBranch = true,
  ): Promise<string> {
    if (includeWorkerBranch && await refLookup(`refs/remotes/origin/${workerBranch}`)) {
      return `origin/${workerBranch}`;
    }
    if (remoteOnly) {
      if (await refLookup(`refs/remotes/origin/${featureBranch}`)) {
        return `origin/${featureBranch}`;
      }
      throw new Error(`Cannot prepare remote-only isolated workspace: neither origin/${workerBranch} nor origin/${featureBranch} exists.`);
    }
    if (includeWorkerBranch && await refLookup(`refs/heads/${workerBranch}`)) {
      return workerBranch;
    }
    if (await refLookup(`refs/remotes/origin/${featureBranch}`)) {
      return `origin/${featureBranch}`;
    }
    if (await refLookup(`refs/heads/${featureBranch}`)) {
      return featureBranch;
    }
    throw new Error(`Cannot prepare isolated workspace: neither worker branch ${workerBranch} nor feature branch ${featureBranch} exists locally or on origin.`);
  }

  /**
   * Exact-ref lookup cache scoped to one workspace preparation. Git repos with long-lived sprint
   * history can accumulate thousands of branches, so callers check only concrete refs they already
   * know about and memoize those answers across start-ref resolution, bundle seeding, and checkout.
   */
  private createRefLookup(repoPath: string): RefLookup {
    const cache = new Map<string, Promise<boolean>>();
    return async (ref: string): Promise<boolean> => {
      const cached = cache.get(ref);
      if (cached) {
        return await cached;
      }
      const lookup = this.refExists(repoPath, ref);
      cache.set(ref, lookup);
      return await lookup;
    };
  }

  private async refExists(repoPath: string, ref: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["show-ref", "--verify", "--quiet", ref], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async fetchRemoteBranchBestEffort(repoPath: string, branch: string, env: NodeJS.ProcessEnv): Promise<void> {
    const branchName = branch.trim();
    if (!branchName) {
      return;
    }

    const key = `${path.resolve(repoPath)}\0${branchName}`;
    if ((this.remoteFetchFreshUntil.get(key) ?? 0) > Date.now()) {
      return;
    }
    this.remoteFetchFreshUntil.delete(key);
    const existing = this.remoteFetches.get(key);
    if (existing) {
      await existing;
      return;
    }

    const fetch = runCommandStrict(
      "git",
      ["fetch", "origin", `+refs/heads/${branchName}:refs/remotes/origin/${branchName}`],
      repoPath,
      env,
    )
      .then(() => {
        this.remoteFetchFreshUntil.set(key, Date.now() + REMOTE_FETCH_FRESHNESS_MS);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.remoteFetches.get(key) === fetch) {
          this.remoteFetches.delete(key);
        }
      });
    this.remoteFetches.set(key, fetch);
    await fetch;
  }

  private async resolveOriginUrl(repoPath: string): Promise<string | null> {
    const key = path.resolve(repoPath);
    const cached = this.originUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return await cached.promise;
    const promise = runCommandStrict("git", ["remote", "get-url", "origin"], repoPath)
      .then((result) => result.stdout.trim() || null)
      .catch(() => null);
    this.originUrlCache.set(key, { expiresAt: Date.now() + REMOTE_FETCH_FRESHNESS_MS, promise });
    return await promise;
  }

  private async assertExactGitWorktreeRoot(repoPath: string): Promise<void> {
    const key = path.resolve(repoPath);
    const cached = this.verifiedRepoRoots.get(key);
    if (cached) return await cached;
    const verification = this.verifyExactGitWorktreeRoot(repoPath).catch((error) => {
      if (this.verifiedRepoRoots.get(key) === verification) this.verifiedRepoRoots.delete(key);
      throw error;
    });
    this.verifiedRepoRoots.set(key, verification);
    return await verification;
  }

  private async verifyExactGitWorktreeRoot(repoPath: string): Promise<void> {
    let result: CommandResult;
    try {
      result = await runCommandStrict("git", ["rev-parse", "--show-toplevel"], repoPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Project repository path is not a Git checkout: ${repoPath}. ${message}`);
    }

    const actualRoot = path.resolve(result.stdout.trim());
    const expectedRoot = path.resolve(repoPath);
    const canonicalActualRoot = await canonicalizeExistingPath(actualRoot);
    const canonicalExpectedRoot = await canonicalizeExistingPath(expectedRoot);
    if (canonicalActualRoot !== canonicalExpectedRoot) {
      throw new Error(`Project repository path must be a Git checkout root. Configured path ${expectedRoot} resolves to parent Git root ${actualRoot}. Re-add the Git project so Code UX clones it into a local checkout directory.`);
    }
  }

  private async withRepoLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(repoPath);
    return await this.withKeyedLock(this.repoLocks, key, operation);
  }

  private async withWorkspaceLock<T>(workspaceRef: string, operation: () => Promise<T>): Promise<T> {
    return await this.withKeyedLock(this.workspaceLocks, workspaceRef, operation);
  }

  private async withKeyedLock<T>(locks: Map<string, Promise<void>>, key: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(key, previous.then(() => next));
    try {
      await previous;
      return await operation();
    } finally {
      release();
      if (locks.get(key) === next) {
        locks.delete(key);
      }
    }
  }
}

export function isDockerWorkspaceRef(value: string): boolean {
  return isWorkspaceHandle(value);
}
