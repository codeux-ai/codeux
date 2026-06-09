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

const PROTECTED_EXPORT_PATH_PREFIXES = [
  ".code-ux-home",
];

function isProtectedExportPath(candidate: string): boolean {
  return PROTECTED_EXPORT_PATH_PREFIXES.some((protectedPath) => (
    candidate === protectedPath || candidate.startsWith(`${protectedPath}/`)
  ));
}

// Safety net: qwen-code's OpenAI logger writes `logs/openai/openai-<ts>-<id>.json`
// files. We redirect them out of the worktree via settings, but guard against
// qwen versions that ignore that setting so the logs are never committed.
const QWEN_OPENAI_LOG_FILE_RE = /(^|\/)logs\/openai\/openai-[^/]*\.json$/;

function isQwenOpenAiLogPath(candidate: string): boolean {
  return QWEN_OPENAI_LOG_FILE_RE.test(candidate);
}

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

export class WorkspaceArtifactService {
  constructor(private readonly workspaceManager: IWorkspaceManager) {}

  async exportBinaryPatch(workspaceRef: string, baseRef: string): Promise<string> {
    const diffArgs = [
      "diff",
      "--binary",
      baseRef,
      "--",
      ".",
      `:(exclude)${LEARNINGS_FILENAME}`,
      ":(exclude).code-ux-home",
      ":(exclude).code-ux-home/**",
      ":(exclude,glob)**/logs/openai/openai-*.json",
      ":(exclude,glob)logs/openai/openai-*.json",
    ];
    const untrackedResult = await this.workspaceManager.runWorkspaceCommand(
      workspaceRef,
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { trimOutput: false },
    );
    const untrackedPaths = untrackedResult.stdout
      .split("\0")
      .filter((candidate) => (
        candidate.length > 0
        && candidate !== LEARNINGS_FILENAME
        && !isProtectedExportPath(candidate)
        && !isQwenOpenAiLogPath(candidate)
      ));

    // Git patch payloads are whitespace-sensitive. Preserve raw command output so
    // EOF-only whitespace lines and no-newline markers survive host-side apply.
    if (untrackedPaths.length === 0) {
      const result = await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        diffArgs,
        { trimOutput: false },
      );
      return result.stdout;
    }

    const tempIndexPath = `.code-ux-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.index`;
    const tempIndexEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
    };

    try {
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["read-tree", "HEAD"],
        { env: tempIndexEnv },
      );
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["add", "--intent-to-add", "--", ...untrackedPaths],
        { env: tempIndexEnv },
      );
      const result = await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        diffArgs,
        { env: tempIndexEnv, trimOutput: false },
      );
      return result.stdout;
    } finally {
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "rm",
        ["-f", tempIndexPath],
      ).catch(() => undefined);
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

      await runCommandStrict("git", ["read-tree", args.baseRef], args.repoPath, indexEnv);
      if (hasPatch) {
        await runCommandStrict("git", ["apply", "--cached", "--binary", patchPath], args.repoPath, indexEnv);
      }

      const treeSha = (await runCommandStrict("git", ["write-tree"], args.repoPath, indexEnv)).stdout.trim();
      const baseTree = (await runCommandStrict("git", ["rev-parse", `${args.baseRef}^{tree}`], args.repoPath)).stdout.trim();

      if ((!treeSha || treeSha === baseTree) && !mergeParentsNeedRecording) {
        return { hasChanges: false };
      }

      const parentArgs = [
        "-p",
        args.baseRef,
        ...(args.parentRefs || []).flatMap((parentRef) => ["-p", parentRef]),
      ];
      const commitSha = (await runCommandStrict(
        "git",
        ["commit-tree", treeSha, ...parentArgs, "-m", args.commitMessage],
        args.repoPath,
        buildCommitIdentityEnv(args.gitIdentity),
      )).stdout.trim();

      await runCommandStrict("git", ["update-ref", `refs/heads/${args.workerBranch}`, commitSha], args.repoPath);
      if (args.githubMode !== "LOCAL") {
        const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(args.repoPath, args.gitAuth ?? {});
        await runCommandStrict(
          "git",
          ["push", "-u", "origin", `refs/heads/${args.workerBranch}:refs/heads/${args.workerBranch}`],
          args.repoPath,
          pushEnv ?? process.env,
        );
      }

      const diffOutput = (await runCommandStrict(
        "git",
        ["diff", "--numstat", args.baseRef, commitSha],
        args.repoPath,
      )).stdout;

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

      return {
        hasChanges: true,
        commitSha,
        stats: {
          filesChanged,
          insertions,
          deletions,
        },
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async isAncestor(repoPath: string, ancestorRef: string, descendantRef: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["merge-base", "--is-ancestor", ancestorRef, descendantRef], repoPath);
      return true;
    } catch {
      return false;
    }
  }
}
