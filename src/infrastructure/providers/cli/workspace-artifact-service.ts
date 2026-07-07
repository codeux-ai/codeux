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

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

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
    // Pathspecs shared by intent-to-add staging and the final diff. Keeping them
    // in sync matters: the temporary index asks Git to discover untracked files
    // internally, so Code UX never has to pass a large untracked path list
    // through Docker argv.
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
    const tempIndexPath = `.code-ux-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.index`;
    const tempPathListPath = `${tempIndexPath}.paths`;
    const tempIndexEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
    };

    const exportScript = [
      "set -e",
      `paths=${shellQuote(tempPathListPath)}`,
      "cleanup() { rm -f \"$GIT_INDEX_FILE\" \"$paths\"; }",
      "trap cleanup EXIT",
      "git read-tree HEAD",
      `git ls-files --others --exclude-standard -z -- ${[".", ...excludePathspecs].map(shellQuote).join(" ")} > "$paths"`,
      "if [ -s \"$paths\" ]; then xargs -0 git add --intent-to-add -- < \"$paths\"; fi",
      `git diff --binary ${shellQuote(baseRef)} -- ${[".", ...excludePathspecs].map(shellQuote).join(" ")}`,
    ].join("\n");

    const result = await this.workspaceManager.runWorkspaceCommand(
      workspaceRef,
      "sh",
      ["-lc", exportScript],
      { env: tempIndexEnv, trimOutput: false },
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
    workerBranch: string;
    patchPath: string;
    commitMessage: string;
    parentRefs: string[];
    indexEnv: NodeJS.ProcessEnv;
    gitIdentity?: GitCommitIdentity;
    hasPatch: boolean;
    forceCommitForMergeParent: boolean;
  }): Promise<{ commitSha?: string; stats?: AppliedWorkspacePatchResult["stats"] }> {
    const parentArgs = [
      "-p",
      args.baseRef,
      ...args.parentRefs.flatMap((parentRef) => ["-p", parentRef]),
    ].map(shellQuote).join(" ");
    const script = [
      "set -e",
      "cleanup() { rm -f \"$GIT_INDEX_FILE\"; }",
      "trap cleanup EXIT",
      `git read-tree ${shellQuote(args.baseRef)}`,
      args.hasPatch ? `git apply --cached --binary ${shellQuote(args.patchPath)}` : null,
      "tree=$(git write-tree)",
      `base_tree=$(git rev-parse ${shellQuote(`${args.baseRef}^{tree}`)})`,
      [
        "if [ -z \"$tree\" ] ||",
        `{ [ "$tree" = "$base_tree" ] && [ ${shellQuote(args.forceCommitForMergeParent ? "1" : "0")} != "1" ]; }; then`,
        "  printf 'CODEUX_RESULT\\tNO_CHANGES\\n'",
        "  exit 0",
        "fi",
      ].join("\n"),
      `commit=$(git commit-tree "$tree" ${parentArgs} -m ${shellQuote(args.commitMessage)})`,
      "sync_checked_out=0",
      "current_branch=$(env -u GIT_INDEX_FILE git rev-parse --abbrev-ref HEAD 2>/dev/null || true)",
      [
        `if [ "$current_branch" = ${shellQuote(args.workerBranch)} ] && [ -z "$(env -u GIT_INDEX_FILE git status --porcelain --untracked-files=no)" ]; then`,
        "  sync_checked_out=1",
        "fi",
      ].join("\n"),
      `git update-ref ${shellQuote(`refs/heads/${args.workerBranch}`)} "$commit"`,
      "if [ \"$sync_checked_out\" = \"1\" ]; then env -u GIT_INDEX_FILE git reset --hard \"$commit\" >/dev/null; fi",
      `env -u GIT_INDEX_FILE git diff --numstat ${shellQuote(args.baseRef)} "$commit"`,
      "printf 'CODEUX_COMMIT\\t%s\\n' \"$commit\"",
    ].filter((step): step is string => Boolean(step)).join("\n");

    const result = await runCommandStrict(
      "sh",
      ["-lc", script],
      args.repoPath,
      {
        ...buildCommitIdentityEnv(args.gitIdentity),
        GIT_INDEX_FILE: args.indexEnv.GIT_INDEX_FILE,
      },
      { trimOutput: false },
    );

    const commitLine = result.stdout.split("\n").find((line) => line.startsWith("CODEUX_COMMIT\t"));
    if (!commitLine) {
      return {};
    }
    const numstatOutput = result.stdout
      .split("\n")
      .filter((line) => line && !line.startsWith("CODEUX_"))
      .join("\n");

    return {
      commitSha: commitLine.slice("CODEUX_COMMIT\t".length).trim(),
      stats: parseGitNumstat(numstatOutput),
    };
  }

  private async resolveMaterializationBaseRef(args: {
    repoPath: string;
    baseRef: string;
    workerBranch: string;
    githubMode?: "REMOTE" | "LOCAL";
    gitAuth?: GitHttpAuthOptions;
  }): Promise<string> {
    if (args.githubMode === "LOCAL") {
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
