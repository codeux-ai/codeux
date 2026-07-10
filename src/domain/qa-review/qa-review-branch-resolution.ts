import { findRecoverableWorkerBranch } from "../../infrastructure/git/local-merge.js";
import { runCommandStrict } from "../../services/cli-process-runner.js";
import { buildWorkerBranchPrefix } from "../../services/cli-workflow-utils.js";
import type { Subtask } from "../../contracts/app-types.js";
import type { TaskRunRecord } from "../../contracts/execution-types.js";
import type { ProviderId } from "../../contracts/app-types.js";

export interface ResolveReviewBranchArgs {
  task: Subtask;
  taskRun: TaskRunRecord | null;
  repoPath: string;
  featureBranch: string;
  githubMode: "REMOTE" | "LOCAL";
}

export interface ResolveReviewBranchResult {
  reviewBranch: string;
  recoveredWorkerBranch: string | null;
}

type GitRunner = (command: string, args: string[], cwd: string) => Promise<{ stdout: string }>;

export async function resolveReviewBranch(
  args: ResolveReviewBranchArgs,
  deps: {
    findRecoverableWorkerBranch: typeof findRecoverableWorkerBranch;
    runner?: GitRunner;
    logger?: { info?: (msg: string) => void; warn?: (msg: string) => void };
  }
): Promise<ResolveReviewBranchResult> {
  const direct = args.task.worker_branch?.trim() || args.taskRun?.workerBranch?.trim();
  if (direct) {
    return { reviewBranch: direct, recoveredWorkerBranch: null };
  }

  const provider = (args.task.provider || args.taskRun?.provider || undefined) as ProviderId | undefined;
  if (args.featureBranch && args.task.id && provider) {
    const branchPrefix = buildWorkerBranchPrefix(args.featureBranch, args.task.id, provider);
    try {
      const recovered = await deps.findRecoverableWorkerBranch({
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        branchPrefix,
      });
      if (recovered) {
        deps.logger?.info?.(
          `${args.githubMode} Mode: Recovered worker branch ${recovered} for QA review of task ${args.task.id} from local refs.`
        );
        return { reviewBranch: recovered, recoveredWorkerBranch: recovered };
      }
    } catch (err) {
      deps.logger?.warn?.(`Failed to recover local worker branch for QA review of task ${args.task.id}: ${err}`);
    }

    try {
      const recovered = await findRecoverableRemoteWorkerBranch({
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        branchPrefix,
        runner: deps.runner,
      });
      if (recovered) {
        deps.logger?.info?.(
          `${args.githubMode} Mode: Recovered worker branch ${recovered} for QA review of task ${args.task.id} from remote refs.`
        );
        return { reviewBranch: recovered, recoveredWorkerBranch: recovered };
      }
    } catch (err) {
      deps.logger?.warn?.(`Failed to recover remote worker branch for QA review of task ${args.task.id}: ${err}`);
    }
  }

  return { reviewBranch: args.featureBranch, recoveredWorkerBranch: null };
}

async function findRecoverableRemoteWorkerBranch(args: {
  repoPath: string;
  featureBranch: string;
  branchPrefix: string;
  runner?: GitRunner;
}): Promise<string | null> {
  const runner = args.runner ?? ((command, commandArgs, cwd) => runCommandStrict(command, commandArgs, cwd));
  let refs: string[];
  try {
    const out = await runner("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/"], args.repoPath);
    refs = out.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }

  let best: { name: string; when: number } | null = null;
  for (const ref of refs) {
    const branchName = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
    if (!branchName.startsWith(args.branchPrefix)) {
      continue;
    }

    const remoteRef = ref.startsWith("origin/") ? ref : `origin/${branchName}`;
    const ahead = await readAheadCount(runner, args.repoPath, args.featureBranch, remoteRef);
    if (ahead <= 0) {
      continue;
    }

    const when = await readCommitTimestamp(runner, args.repoPath, remoteRef);
    if (!best || when > best.when) {
      best = { name: branchName, when };
    }
  }
  return best?.name ?? null;
}

async function readAheadCount(
  runner: GitRunner,
  repoPath: string,
  featureBranch: string,
  candidateRef: string,
): Promise<number> {
  const baseRefs = [`origin/${featureBranch}`, featureBranch];
  for (const baseRef of baseRefs) {
    try {
      const res = await runner("git", ["rev-list", "--count", `${baseRef}..${candidateRef}`], repoPath);
      return Number.parseInt(res.stdout.trim(), 10) || 0;
    } catch {
      // Try the next base ref.
    }
  }
  return 0;
}

async function readCommitTimestamp(runner: GitRunner, repoPath: string, ref: string): Promise<number> {
  try {
    const res = await runner("git", ["log", "-1", "--format=%ct", ref], repoPath);
    return Number.parseInt(res.stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}
