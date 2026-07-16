import type { CommandResult } from "../../services/cli-process-runner.js";

const DEFAULT_PUSH_ATTEMPTS = 3;

export type WorkerBranchGitRunner = (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => Promise<CommandResult>;

export class FreshWorkerBranchCollisionError extends Error {
  constructor(
    readonly workerBranch: string,
    readonly localTip: string,
    readonly remoteTip: string,
  ) {
    super(
      `Fresh worker branch allocation collided with remote ref '${workerBranch}' `
      + `(local tip ${localTip}, remote tip ${remoteTip}).`,
    );
    this.name = "FreshWorkerBranchCollisionError";
  }
}

function isAmbiguousGitPushError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /exit code 137|SIGKILL|no output captured|RPC failed|remote end hung up unexpectedly|early EOF/i.test(message);
}

function parseExactRemoteTip(output: string, workerRef: string): string | null {
  if (!output.trim()) {
    return null;
  }
  for (const line of output.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/, 2);
    if (sha && /^[0-9a-f]{40,64}$/i.test(sha) && ref === workerRef) {
      return sha;
    }
  }
  throw new Error(`Remote branch probe returned no exact '${workerRef}' ref.`);
}

async function probeFreshWorkerBranchPublication(args: {
  runner: WorkerBranchGitRunner;
  repoPath: string;
  workerRef: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ localTip: string; remoteTip: string | null }> {
  const localTip = (
    await args.runner(
      "git",
      ["rev-parse", "--verify", args.workerRef],
      args.repoPath,
      args.env,
    )
  ).stdout.trim();
  if (!localTip) {
    throw new Error(`Cannot verify local worker ref '${args.workerRef}' after an ambiguous push.`);
  }

  const remoteResult = await args.runner(
    "git",
    ["ls-remote", "--heads", "origin", args.workerRef],
    args.repoPath,
    args.env,
  );
  return {
    localTip,
    remoteTip: parseExactRemoteTip(remoteResult.stdout, args.workerRef),
  };
}

/**
 * Publishes a worker branch without letting an ambiguous first-push result turn into a false
 * collision. Fresh branches use an expected-absent lease. If that push loses its result, the
 * exact remote ref is reconciled before retrying: the intended tip is accepted, absence is safe
 * to retry, and any different tip remains a hard allocation collision.
 */
export async function pushWorkerBranch(args: {
  runner: WorkerBranchGitRunner;
  repoPath: string;
  workerBranch: string;
  env?: NodeJS.ProcessEnv;
  allowExistingWorkerBranch: boolean;
  maxAttempts?: number;
}): Promise<void> {
  const env = args.env ?? process.env;
  const workerRef = `refs/heads/${args.workerBranch}`;
  const pushArgs = [
    "push",
    "-u",
    ...(!args.allowExistingWorkerBranch ? [`--force-with-lease=${workerRef}:`] : []),
    "origin",
    `${workerRef}:${workerRef}`,
  ];
  const maxAttempts = Math.max(1, args.maxAttempts ?? DEFAULT_PUSH_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await args.runner("git", pushArgs, args.repoPath, env);
      return;
    } catch (error) {
      if (!isAmbiguousGitPushError(error)) {
        throw error;
      }

      if (!args.allowExistingWorkerBranch) {
        const publication = await probeFreshWorkerBranchPublication({
          runner: args.runner,
          repoPath: args.repoPath,
          workerRef,
          env,
        });
        if (publication.remoteTip === publication.localTip) {
          return;
        }
        if (publication.remoteTip) {
          throw new FreshWorkerBranchCollisionError(
            args.workerBranch,
            publication.localTip,
            publication.remoteTip,
          );
        }
      }

      if (attempt >= maxAttempts) {
        throw error;
      }
    }
  }
}
