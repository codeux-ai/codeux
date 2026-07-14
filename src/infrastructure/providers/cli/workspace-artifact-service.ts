import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { LEARNINGS_FILENAME } from "../../../contracts/memory-types.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import {
  buildGitHttpAuthEnvForRepoWithFallbacks,
  type GitHttpAuthOptions,
} from "../../../services/git-http-auth.js";
import type { IWorkspaceManager } from "./workspace-manager.js";

const TEMP_EXPORT_PATHSPEC = ":(exclude).code-ux-export-*";

export interface AppliedWorkspacePatchResult {
  hasChanges: boolean;
  commitSha?: string;
  stats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface GitCommitIdentity {
  name: string;
  email: string;
}

const parseGitNumstat = (diffOutput: string): NonNullable<AppliedWorkspacePatchResult["stats"]> => {
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const line of diffOutput.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    filesChanged++;
    if (parts[0] !== "-" && parts[1] !== "-") {
      const ins = Number.parseInt(parts[0], 10);
      const del = Number.parseInt(parts[1], 10);
      if (Number.isFinite(ins)) insertions += ins;
      if (Number.isFinite(del)) deletions += del;
    }
  }

  return { filesChanged, insertions, deletions };
};

const buildCommitIdentityEnv = (
  identity: GitCommitIdentity | undefined,
): NodeJS.ProcessEnv => {
  if (!identity?.name.trim() || !identity.email.trim()) {
    return process.env;
  }
  return {
    ...process.env,
    GIT_AUTHOR_NAME: identity.name.trim(),
    GIT_AUTHOR_EMAIL: identity.email.trim(),
    GIT_COMMITTER_NAME: identity.name.trim(),
    GIT_COMMITTER_EMAIL: identity.email.trim(),
  };
};

const GIT_PUSH_RETRY_ATTEMPTS = 3;

function isRetryableGitPushError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /exit code 137|SIGKILL|no output captured|RPC failed|remote end hung up unexpectedly|early EOF/i.test(message);
}

export class WorkspaceArtifactService {
  constructor(private readonly workspaceManager: IWorkspaceManager) {}

  async exportBinaryPatch(workspaceRef: string, baseRef: string): Promise<string> {
    // Stage the workspace tree into an isolated index and diff that index
    // against the base. Git still owns discovery of new, modified, and deleted
    // files, including ignore handling, while Code UX avoids passing a large
    // changed-path list through Docker argv.
    const excludePathspecs = [
      `:(exclude)${LEARNINGS_FILENAME}`,
      TEMP_EXPORT_PATHSPEC,
      ":(exclude).code-ux-home",
      ":(exclude).code-ux-home/**",
      ":(exclude).pnpm-store",
      ":(exclude).pnpm-store/**",
      ":(exclude,glob)**/logs/openai/**",
      ":(exclude,glob)logs/openai/**",
    ];
    const tempIndexFilename = `.code-ux-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.index`;
    const tempIndexPath = workspaceRef.startsWith("docker-volume://") || !path.isAbsolute(workspaceRef)
      ? tempIndexFilename
      : path.join(workspaceRef, tempIndexFilename);
    const tempIndexEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
    };
    const pathspecs = [".", ...excludePathspecs];
    const tempPathListPath = path.join(os.tmpdir(), `code-ux-export-paths-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.paths`);

    try {
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["read-tree", "HEAD"],
        { env: tempIndexEnv },
      );
      const changedPaths = await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z", "--", ...pathspecs],
        { env: tempIndexEnv, trimOutput: false },
      );
      if (changedPaths.stdout.length > 0) {
        await fs.writeFile(tempPathListPath, changedPaths.stdout, "utf8");
        await this.workspaceManager.runWorkspaceCommand(
          workspaceRef,
          "git",
          ["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
          { env: tempIndexEnv, stdinFile: tempPathListPath },
        );
      }
      const result = await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["diff", "--binary", "--cached", baseRef, "--", ...pathspecs],
        { env: tempIndexEnv, trimOutput: false },
      );
      return result.stdout;
    } finally {
      await fs.rm(tempPathListPath, { force: true }).catch(() => undefined);
      if (workspaceRef.startsWith("docker-volume://")) {
        await this.workspaceManager.runWorkspaceCommand(workspaceRef, "rm", ["-f", tempIndexFilename]).catch(() => undefined);
      } else {
        const hostTempIndexPath = path.isAbsolute(tempIndexPath)
          ? tempIndexPath
          : path.join(workspaceRef, tempIndexPath);
        await fs.rm(hostTempIndexPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async applyPatchToBranch(args: {
    repoPath: string;
    baseRef: string;
    workerBranch: string;
    patchText: string;
    commitMessage: string;
    parentRefs?: string[];
    gitAuth?: GitHttpAuthOptions;
    gitIdentity?: GitCommitIdentity;
    githubMode?: "REMOTE" | "LOCAL";
    /**
     * When true, a merge commit is recorded even if the resolved tree is identical to
     * the base tree, as long as a parent ref is not yet an ancestor of the base. This is
     * required for merge-conflict resolution: a conflict resolved by keeping the source
     * side produces an empty diff, but the branch must still record the target branch as
     * a parent so the upstream PR stops reporting the conflict.
     */
    forceMergeCommit?: boolean;
  }): Promise<AppliedWorkspacePatchResult> {
    const hasPatch = args.patchText.trim().length > 0;
    const parentRefs = args.parentRefs ?? [];
    const materializationBaseRef = await this.resolveMaterializationBaseRef(args);

    // Determine whether a merge commit must be recorded even without a tree change:
    // when at least one parent ref is not yet contained in the base branch.
    let mergeParentsNeedRecording = false;
    if (args.forceMergeCommit && parentRefs.length > 0) {
      for (const parentRef of parentRefs) {
        if (!(await this.isAncestor(args.repoPath, parentRef, args.baseRef))) {
          mergeParentsNeedRecording = true;
          break;
        }
      }
    }

    if (!hasPatch && !mergeParentsNeedRecording) {
      return { hasChanges: false };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-patch-"));
    const patchPath = path.join(tempDir, "workspace.patch");
    const indexPath = path.join(tempDir, "workspace.index");

    try {
      await fs.writeFile(patchPath, args.patchText, "utf8");

      const indexEnv = {
        ...process.env,
        GIT_INDEX_FILE: indexPath,
      };

      const materialized = await this.materializePatchCommit({
        repoPath: args.repoPath,
        baseRef: materializationBaseRef,
        patchBaseRef: args.baseRef,
        workerBranch: args.workerBranch,
        patchPath,
        commitMessage: args.commitMessage,
        parentRefs,
        indexEnv,
        gitIdentity: args.gitIdentity,
        hasPatch,
        forceCommitForMergeParent: mergeParentsNeedRecording,
      });

      if (!materialized.commitSha) {
        return { hasChanges: false };
      }

      if (args.githubMode !== "LOCAL") {
        const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(args.repoPath, args.gitAuth ?? {});
        await this.pushWorkerBranchWithRetry(args.repoPath, args.workerBranch, pushEnv ?? process.env);
      }

      return {
        hasChanges: true,
        commitSha: materialized.commitSha,
        stats: materialized.stats,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async materializePatchCommit(args: {
    repoPath: string;
    baseRef: string;
    patchBaseRef: string;
    workerBranch: string;
    patchPath: string;
    commitMessage: string;
    parentRefs: string[];
    indexEnv: NodeJS.ProcessEnv;
    gitIdentity?: GitCommitIdentity;
    hasPatch: boolean;
    forceCommitForMergeParent: boolean;
  }): Promise<{ commitSha?: string; stats?: AppliedWorkspacePatchResult["stats"] }> {
    const indexPath = args.indexEnv.GIT_INDEX_FILE;
    if (!indexPath) {
      throw new Error("GIT_INDEX_FILE is required for workspace patch materialization.");
    }
    const indexEnv = {
      ...buildCommitIdentityEnv(args.gitIdentity),
      GIT_INDEX_FILE: indexPath,
    };
    const git = async (
      gitArgs: string[],
      env: NodeJS.ProcessEnv = indexEnv,
      options: { trimOutput?: boolean } = {},
    ): Promise<string> => {
      const result = await runCommandStrict("git", gitArgs, args.repoPath, env, {
        trimOutput: options.trimOutput,
      });
      return result.stdout;
    };

    try {
      let tree: string;
      if (args.hasPatch) {
        await git(["read-tree", args.patchBaseRef]);
        await git(["apply", "--cached", "--binary", args.patchPath]);
        const patchTree = (await git(["write-tree"])).trim();
        if (args.patchBaseRef === args.baseRef) {
          tree = patchTree;
        } else {
          await git(["read-tree", "-m", args.patchBaseRef, args.baseRef, patchTree]);
          tree = (await git(["write-tree"])).trim();
        }
      } else {
        await git(["read-tree", args.baseRef]);
        tree = (await git(["write-tree"])).trim();
      }

      const baseTree = (await git(["rev-parse", `${args.baseRef}^{tree}`])).trim();
      if (!tree || (tree === baseTree && !args.forceCommitForMergeParent)) {
        return {};
      }

      const commit = (await git([
        "commit-tree",
        tree,
        "-p",
        args.baseRef,
        ...args.parentRefs.flatMap((parentRef) => ["-p", parentRef]),
        "-m",
        args.commitMessage,
      ])).trim();

      const normalEnv = buildCommitIdentityEnv(args.gitIdentity);
      const currentBranch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], normalEnv).catch(() => "")).trim();
      const status = currentBranch === args.workerBranch
        ? (await git(["status", "--porcelain", "--untracked-files=no"], normalEnv, { trimOutput: false }).catch(() => "")).trim()
        : "not-current";
      const syncCheckedOut = currentBranch === args.workerBranch && status.length === 0;

      await git(["update-ref", `refs/heads/${args.workerBranch}`, commit], normalEnv);
      if (syncCheckedOut) {
        await git(["reset", "--hard", commit], normalEnv);
      }
      const numstatOutput = await git(["diff", "--numstat", args.baseRef, commit], normalEnv, { trimOutput: false });

      return {
        commitSha: commit,
        stats: parseGitNumstat(numstatOutput),
      };
    } finally {
      await fs.rm(indexPath, { force: true }).catch(() => undefined);
    }
  }

  private async resolveMaterializationBaseRef(args: {
    repoPath: string;
    baseRef: string;
    workerBranch: string;
    githubMode?: "REMOTE" | "LOCAL";
    gitAuth?: GitHttpAuthOptions;
  }): Promise<string> {
    if (args.githubMode === "LOCAL") {
      const localRef = `refs/heads/${args.workerBranch}`;
      try {
        const currentTip = (await runCommandStrict(
          "git",
          ["rev-parse", "--verify", localRef],
          args.repoPath,
        )).stdout.trim();
        if (currentTip && await this.isAncestor(args.repoPath, args.baseRef, currentTip)) {
          return currentTip;
        }
      } catch {
        // A fresh worker branch may not exist in the host repository yet.
      }
      return args.baseRef;
    }

    const remoteRef = `refs/remotes/origin/${args.workerBranch}`;
    try {
      const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(args.repoPath, args.gitAuth ?? {});
      await runCommandStrict(
        "git",
        ["fetch", "origin", `+refs/heads/${args.workerBranch}:${remoteRef}`],
        args.repoPath,
        pushEnv ?? process.env,
      );
      await runCommandStrict("git", ["rev-parse", "--verify", remoteRef], args.repoPath);
      if (await this.isAncestor(args.repoPath, args.baseRef, remoteRef)) {
        return remoteRef;
      }
    } catch {
      // No remote worker branch exists yet, or it is unrelated to this workspace base.
      // In either case keep the normal base-ref materialization path.
    }
    return args.baseRef;
  }

  private async isAncestor(repoPath: string, ancestorRef: string, descendantRef: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["merge-base", "--is-ancestor", ancestorRef, descendantRef], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async pushWorkerBranchWithRetry(
    repoPath: string,
    workerBranch: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    const pushArgs = ["push", "-u", "origin", `refs/heads/${workerBranch}:refs/heads/${workerBranch}`];
    for (let attempt = 1; attempt <= GIT_PUSH_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await runCommandStrict("git", pushArgs, repoPath, env);
        return;
      } catch (error) {
        if (attempt >= GIT_PUSH_RETRY_ATTEMPTS || !isRetryableGitPushError(error)) {
          throw error;
        }
      }
    }
  }
}
