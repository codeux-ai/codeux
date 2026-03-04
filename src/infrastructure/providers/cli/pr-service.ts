import { runCommandStrict, CommandResult } from "../../../services/cli-process-runner.js";
import { ProviderId } from "../../../contracts/app-types.js";

export type Runner = (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CommandResult>;

export interface IPrService {
  resolveOrCreateFeaturePr(args: {
    taskId: string;
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    title: string;
    featureBranch: string;
    workerBranch: string;
  }, worktreePath: string, githubToken?: string): Promise<string | undefined>;

  hasUnpushedCommits(worktreePath: string, workerBranch: string, featureBranch: string, runner?: Runner): Promise<boolean>;
  hasWorkerBranchCommitsAgainstFeature(worktreePath: string, featureBranch: string, runner?: Runner): Promise<boolean>;
}

export class PrService implements IPrService {
  async resolveOrCreateFeaturePr(
    args: {
      taskId: string;
      provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
      title: string;
      featureBranch: string;
      workerBranch: string;
    },
    worktreePath: string,
    githubToken?: string
  ): Promise<string | undefined> {
    const env = githubToken ? { ...process.env, GH_TOKEN: githubToken, GITHUB_TOKEN: githubToken } : process.env;

    try {
      const existingResult = await runCommandStrict(
        "gh",
        ["pr", "list", "--state", "open", "--base", args.featureBranch, "--head", args.workerBranch, "--json", "url", "--limit", "1"],
        worktreePath,
        env
      );
      const parsed = JSON.parse(existingResult.stdout) as Array<{ url?: string }>;
      const existingUrl = parsed.find((entry) => typeof entry.url === "string" && entry.url.trim().length > 0)?.url?.trim();
      if (existingUrl) return existingUrl;
    } catch { /* fall through */ }

    try {
      const bodyLines = [
        `Automated task execution for \`${args.taskId}\` via ${args.provider}.`,
        "",
        `Base: \`${args.featureBranch}\``,
        `Head: \`${args.workerBranch}\``,
      ];
      const prTitle = `${args.title} (${args.provider})`;
      const createResult = await runCommandStrict(
        "gh",
        ["pr", "create", "--base", args.featureBranch, "--head", args.workerBranch, "--title", prTitle, "--body", bodyLines.join("\n")],
        worktreePath,
        env
      );
      return createResult.stdout.trim().split("\n").find((line) => line.startsWith("http"));
    } catch {
      return undefined;
    }
  }

  async hasUnpushedCommits(worktreePath: string, workerBranch: string, featureBranch: string, runner: Runner = runCommandStrict): Promise<boolean> {
    const remoteWorkerRef = `refs/remotes/origin/${workerBranch}`;
    if (await this.gitRefExists(worktreePath, remoteWorkerRef, runner)) {
      return (await this.gitRevListCount(worktreePath, `origin/${workerBranch}..HEAD`, runner)) > 0;
    }
    const remoteFeatureRef = `refs/remotes/origin/${featureBranch}`;
    if (await this.gitRefExists(worktreePath, remoteFeatureRef, runner)) {
      return (await this.gitRevListCount(worktreePath, `origin/${featureBranch}..HEAD`, runner)) > 0;
    }
    return false;
  }

  async hasWorkerBranchCommitsAgainstFeature(worktreePath: string, featureBranch: string, runner: Runner = runCommandStrict): Promise<boolean> {
    const remoteFeatureRef = `refs/remotes/origin/${featureBranch}`;
    if (await this.gitRefExists(worktreePath, remoteFeatureRef, runner)) {
      return (await this.gitRevListCount(worktreePath, `origin/${featureBranch}..HEAD`, runner)) > 0;
    }
    const localFeatureRef = `refs/heads/${featureBranch}`;
    if (await this.gitRefExists(worktreePath, localFeatureRef, runner)) {
      return (await this.gitRevListCount(worktreePath, `${featureBranch}..HEAD`, runner)) > 0;
    }
    return false;
  }

  private async gitRefExists(worktreePath: string, ref: string, runner: Runner): Promise<boolean> {
    try {
      await runner("git", ["show-ref", "--verify", "--quiet", ref], worktreePath);
      return true;
    } catch {
      return false;
    }
  }

  private async gitRevListCount(worktreePath: string, range: string, runner: Runner): Promise<number> {
    try {
      const result = await runner("git", ["rev-list", "--count", range], worktreePath);
      return parseInt(result.stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }
}
