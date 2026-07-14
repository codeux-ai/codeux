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
const GIT_REF_UPDATE_RETRY_ATTEMPTS = 8;
const NULL_GIT_OBJECT_ID = "0".repeat(40);

class ConcurrentGitRefUpdateError extends Error {
  constructor(
    readonly ref: string,
    readonly expectedSha: string | null,
    readonly actualSha: string | null,
  ) {
    super(
      `Git ref '${ref}' changed while publishing a workspace patch `
      + `(expected ${expectedSha ?? "missing"}, found ${actualSha ?? "missing"}).`,
    );
    this.name = "ConcurrentGitRefUpdateError";
  }
}

const resolveGitAdministrativeDirectory = async (repoPath: string): Promise<string | null> => {
  const dotGitPath = path.join(repoPath, ".git");
  try {
    const stat = await fs.stat(dotGitPath);
    if (stat.isDirectory()) return dotGitPath;
    if (!stat.isFile()) return null;
    const match = /^gitdir:\s*(.+)$/i.exec((await fs.readFile(dotGitPath, "utf8")).trim());
    return match ? path.resolve(repoPath, match[1]) : null;
  } catch {
    return null;
  }
};

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
    const pathspecs = [".", ...excludePathspecs];
    const tempIndexFilename = `.code-ux-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.index`;
    if (workspaceRef.startsWith("docker-volume://")) {
      return await this.exportDockerVolumeBinaryPatch(
        workspaceRef,
        baseRef,
        pathspecs,
        tempIndexFilename,
      );
    }
    const tempIndexPath = !path.isAbsolute(workspaceRef)
      ? tempIndexFilename
      : path.join(workspaceRef, tempIndexFilename);
    const tempIndexEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
    };
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
      const hostTempIndexPath = path.isAbsolute(tempIndexPath)
        ? tempIndexPath
        : path.join(workspaceRef, tempIndexPath);
      await fs.rm(hostTempIndexPath, { force: true }).catch(() => undefined);
    }
  }

  private async exportDockerVolumeBinaryPatch(
    workspaceRef: string,
    baseRef: string,
    pathspecs: string[],
    tempIndexFilename: string,
  ): Promise<string> {
    const tempPathListFilename = tempIndexFilename.replace(/\.index$/, ".paths");
    const script = [
      "index_file=$1",
      "path_file=$2",
      "base_ref=$3",
      "shift 3",
      "trap 'rm -f \"$index_file\" \"$path_file\"' EXIT",
      "export GIT_INDEX_FILE=$index_file",
      "git read-tree HEAD",
      "git ls-files --modified --deleted --others --exclude-standard -z -- \"$@\" > \"$path_file\"",
      "if [ -s \"$path_file\" ]; then",
      "  git add -A --pathspec-from-file=- --pathspec-file-nul < \"$path_file\"",
      "fi",
      "git diff --binary --cached \"$base_ref\" -- \"$@\"",
    ].join("\n");
    const result = await this.workspaceManager.runWorkspaceCommand(
      workspaceRef,
      "sh",
      [
        "-ceu",
        script,
        "code-ux-export",
        tempIndexFilename,
        tempPathListFilename,
        baseRef,
        ...pathspecs,
      ],
      { trimOutput: false },
    );
    return result.stdout;
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

    // Keep patch transaction files under Git's administrative directory whenever possible.
    // Containerized Git can then reuse the warm project helper container; putting the index in
    // the host temp directory forces every Git command onto a new helper because of the extra bind.
    const gitAdministrativeDirectory = await resolveGitAdministrativeDirectory(args.repoPath);
    const tempDir = await fs.mkdtemp(path.join(gitAdministrativeDirectory ?? os.tmpdir(), "code-ux-patch-"));
    const patchPath = path.join(tempDir, "workspace.patch");
    const indexPath = path.join(tempDir, "workspace.index");

    try {
      await fs.writeFile(patchPath, args.patchText, "utf8");

      const indexEnv = {
        ...process.env,
        GIT_INDEX_FILE: indexPath,
      };

      let materialized: {
        commitSha?: string;
        stats?: AppliedWorkspacePatchResult["stats"];
      } | null = null;

      for (let attempt = 1; attempt <= GIT_REF_UPDATE_RETRY_ATTEMPTS; attempt++) {
        const materializationBase = await this.resolveMaterializationBase(args);
        try {
          materialized = await this.materializePatchCommit({
            repoPath: args.repoPath,
            patchBaseRef: args.baseRef,
            commitBaseRef: materializationBase.commitBaseRef,
            expectedWorkerTip: materializationBase.expectedWorkerTip,
            workerBranch: args.workerBranch,
            patchPath,
            commitMessage: args.commitMessage,
            parentRefs,
            indexEnv,
            gitIdentity: args.gitIdentity,
            hasPatch,
            forceCommitForMergeParent: mergeParentsNeedRecording,
          });
          break;
        } catch (error) {
          if (!(error instanceof ConcurrentGitRefUpdateError) || attempt === GIT_REF_UPDATE_RETRY_ATTEMPTS) {
            throw error;
          }
          // Another task merge or repair advanced the same branch. Rebuild the patch commit on
          // that new tip instead of overwriting it; Git's compare-and-swap ref update keeps both
          // writers parallel without a process-wide branch lock.
        }
      }

      if (!materialized) {
        throw new Error(`Failed to materialize workspace patch for '${args.workerBranch}'.`);
      }

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
    /** Ref the exported patch was diffed against. */
    patchBaseRef: string;
    /** Latest worker-branch tip that the final commit must descend from. */
    commitBaseRef: string;
    /** Worker ref value used to choose commitBaseRef, or null when the ref did not exist. */
    expectedWorkerTip: string | null;
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
      // Always apply against the ref used to export the patch. A resumed Docker clone can lag the
      // host worker ref in LOCAL mode; applying that old-base patch directly to the advanced tip
      // makes an already-landed file fail with "already exists in index".
      await git(["read-tree", args.patchBaseRef]);
      if (args.hasPatch) {
        await git(["apply", "--cached", "--binary", args.patchPath]);
      }

      const patchTree = (await git(["write-tree"])).trim();
      const patchBaseTree = (await git(["rev-parse", `${args.patchBaseRef}^{tree}`])).trim();
      if (!patchTree || (patchTree === patchBaseTree && !args.forceCommitForMergeParent)) {
        return {};
      }

      let tree = patchTree;
      if (args.patchBaseRef !== args.commitBaseRef && patchTree !== patchBaseTree) {
        // Materialize an internal commit solely as the second head for Git's three-way tree merge.
        // This preserves changes added by either side, de-duplicates identical additions, and
        // rejects genuine content conflicts instead of silently overwriting newer branch work.
        const patchCommit = (await git([
          "commit-tree",
          patchTree,
          "-p",
          args.patchBaseRef,
          "-m",
          `${args.commitMessage} (workspace patch base)`,
        ])).trim();
        tree = (await git(["merge-tree", "--write-tree", args.commitBaseRef, patchCommit])).trim();
      }

      const commitBaseTree = (await git(["rev-parse", `${args.commitBaseRef}^{tree}`])).trim();
      if (!tree || (tree === commitBaseTree && !args.forceCommitForMergeParent)) {
        return {};
      }

      const commit = (await git([
        "commit-tree",
        tree,
        "-p",
        args.commitBaseRef,
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

      const workerRef = `refs/heads/${args.workerBranch}`;
      try {
        await git([
          "update-ref",
          workerRef,
          commit,
          args.expectedWorkerTip ?? NULL_GIT_OBJECT_ID,
        ], normalEnv);
      } catch (error) {
        const actualWorkerTip = (await git(["rev-parse", "--verify", workerRef], normalEnv).catch(() => "")).trim() || null;
        if (actualWorkerTip !== args.expectedWorkerTip) {
          if (syncCheckedOut && actualWorkerTip) {
            // update-ref moves a checked-out branch without refreshing its index/worktree. Restore
            // the clean checkout before retrying so the final successful publication can keep it
            // clean as well; user-dirty checkouts never enter this path.
            await git(["reset", "--hard", actualWorkerTip], normalEnv).catch(() => undefined);
          }
          throw new ConcurrentGitRefUpdateError(workerRef, args.expectedWorkerTip, actualWorkerTip);
        }
        throw error;
      }
      if (syncCheckedOut) {
        await git(["reset", "--hard", commit], normalEnv);
      }
      const numstatOutput = await git(["diff", "--numstat", args.commitBaseRef, commit], normalEnv, { trimOutput: false });

      return {
        commitSha: commit,
        stats: parseGitNumstat(numstatOutput),
      };
    } finally {
      await fs.rm(indexPath, { force: true }).catch(() => undefined);
    }
  }

  private async resolveMaterializationBase(args: {
    repoPath: string;
    baseRef: string;
    workerBranch: string;
    githubMode?: "REMOTE" | "LOCAL";
    gitAuth?: GitHttpAuthOptions;
  }): Promise<{ commitBaseRef: string; expectedWorkerTip: string | null }> {
    const localRef = `refs/heads/${args.workerBranch}`;
    let expectedWorkerTip: string | null = null;
    try {
      expectedWorkerTip = (await runCommandStrict(
        "git",
        ["rev-parse", "--verify", localRef],
        args.repoPath,
      )).stdout.trim() || null;
    } catch {
      // A fresh worker branch may not exist in the host repository yet.
    }

    if (args.githubMode === "LOCAL") {
      if (expectedWorkerTip && await this.isAncestor(args.repoPath, args.baseRef, expectedWorkerTip)) {
        return { commitBaseRef: expectedWorkerTip, expectedWorkerTip };
      }
      return { commitBaseRef: args.baseRef, expectedWorkerTip };
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
      const remoteTip = (await runCommandStrict(
        "git",
        ["rev-parse", "--verify", remoteRef],
        args.repoPath,
      )).stdout.trim();
      if (await this.isAncestor(args.repoPath, args.baseRef, remoteRef)) {
        return { commitBaseRef: remoteTip, expectedWorkerTip };
      }
    } catch {
      // No remote worker branch exists yet, or it is unrelated to this workspace base.
      // In either case keep the normal base-ref materialization path.
    }
    return { commitBaseRef: args.baseRef, expectedWorkerTip };
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
