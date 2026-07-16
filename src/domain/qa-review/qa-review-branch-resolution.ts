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
  let refs: Array<{ ref: string; when: number }>;
  try {
    const out = await runner(
      "git",
      ["for-each-ref", "--format=%(refname:short)%00%(committerdate:unix)", "refs/remotes/origin/"],
      args.repoPath,
    );
    refs = out.stdout.split("\n").map((line) => {
      const [ref = "", rawWhen = ""] = line.trim().split("\0");
      return { ref, when: Number.parseInt(rawWhen, 10) || 0 };
    }).filter(({ ref }) => Boolean(ref));
  } catch {
    return null;
  }

  const candidates = refs.flatMap(({ ref, when }) => {
    const branchName = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
    if (!branchName.startsWith(args.branchPrefix)) {
      return [];
    }
    return [{ name: branchName, when, remoteRef: ref.startsWith("origin/") ? ref : `origin/${branchName}` }];
  });
  const recoverable = (await Promise.all(candidates.map(async (candidate) => (
    await readAheadCount(runner, args.repoPath, args.featureBranch, candidate.remoteRef) > 0
      ? candidate
      : null
  )))).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const best = recoverable.reduce<{ name: string; when: number } | null>(
    (current, candidate) => !current
      || candidate.when > current.when
      || (candidate.when === current.when && candidate.name > current.name)
      ? candidate
      : current,
    null,
  );
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
