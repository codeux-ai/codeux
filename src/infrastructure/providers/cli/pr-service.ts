import { runCommandStrict, CommandResult } from "../../../services/cli-process-runner.js";
import { ProviderId } from "../../../contracts/app-types.js";
import { GitStatusQueryClient } from "../../git/git-status-query-client.js";
import { resolveRepositoryHost, selectHostToken, type GitHostTokens, type GitProvider } from "../../git/repository-host-resolver.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks } from "../../../services/git-http-auth.js";

export type { GitHostTokens };

export type Runner = (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CommandResult>;

export interface IPrService {
  resolveOrCreateFeaturePr(args: {
    taskId: string;
    provider: Exclude<ProviderId, "jules">;
    title: string;
    featureBranch: string;
    workerBranch: string;
    taskDescription?: string;
    sprintDescription?: string;
  }, repoPath: string, hostToken?: string | GitHostTokens): Promise<string | undefined>;

  hasUnpushedCommits(repoPath: string, workerBranch: string, featureBranch: string, runner?: Runner): Promise<boolean>;
  hasWorkerBranchCommitsAgainstFeature(repoPath: string, workerBranch: string, featureBranch: string, runner?: Runner): Promise<boolean>;
}

const tokenForProvider = (
  provider: GitProvider,
  hostToken: string | GitHostTokens | undefined,
): string | undefined => {
  if (typeof hostToken === "string") {
    return hostToken.trim() || undefined;
  }
  if (!hostToken) {
    return undefined;
  }
  return selectHostToken(provider, hostToken);
};

export class PrService implements IPrService {
  async resolveOrCreateFeaturePr(
    args: {
      taskId: string;
      provider: Exclude<ProviderId, "jules">;
      title: string;
      featureBranch: string;
      workerBranch: string;
      taskDescription?: string;
      sprintDescription?: string;
    },
    repoPath: string,
    hostToken?: string | GitHostTokens
  ): Promise<string | undefined> {
    const client = new GitStatusQueryClient(repoPath);
    let effectiveToken: string | undefined;
    try {
      const remoteRes = await client.gitRemoteUrl("origin", typeof hostToken === "string" ? hostToken : undefined);
      const remoteUrl = remoteRes.ok ? remoteRes.stdout.trim() : null;
      const { provider, hostDomain, repoTarget } = resolveRepositoryHost(remoteUrl);
      effectiveToken = tokenForProvider(provider, hostToken);
      client.setProvider(provider, hostDomain, repoTarget, Boolean(effectiveToken));

      const existingResult = await client.ghPrListOpenMatching(args.featureBranch, args.workerBranch, effectiveToken);
      if (existingResult.ok) {
        const parsed = JSON.parse(existingResult.stdout) as Array<{ url?: string }>;
        const existingUrl = parsed.find((entry) => typeof entry.url === "string" && entry.url.trim().length > 0)?.url?.trim();
        if (existingUrl) return existingUrl;
      }
    } catch { /* fall through */ }

    try {
      const taskSection = args.taskDescription?.trim() ? `**Task Context:**\n${args.taskDescription.trim()}` : `**Task Context:**\nNo task description provided.`;
      const sprintSection = args.sprintDescription?.trim() ? `**Sprint Context:**\n${args.sprintDescription.trim()}` : `**Sprint Context:**\nNo sprint description provided.`;

      const bodyLines = [
        `Automated task execution for \`${args.taskId}\` via ${args.provider}.`,
        "",
      ];
      bodyLines.push(taskSection, "");
      bodyLines.push(sprintSection, "");
      bodyLines.push(`Base: \`${args.featureBranch}\``, `Head: \`${args.workerBranch}\``);

      const prTitle = `${args.title} (${args.provider})`;
      let createResult = await client.ghPrCreate(args.featureBranch, args.workerBranch, prTitle, bodyLines.join("\n"), effectiveToken);

      if (!createResult.ok) {
        // A feature branch can disappear from origin between sprints (e.g. deleted by an
        // auto-merge with branch cleanup). If the PR base is missing remotely but exists
        // locally, restore it and retry once instead of failing the whole workflow.
        const restored = await this.pushMissingBaseBranch(repoPath, args.featureBranch, hostToken);
        if (restored) {
          createResult = await client.ghPrCreate(args.featureBranch, args.workerBranch, prTitle, bodyLines.join("\n"), effectiveToken);
        }
      }

      if (!createResult.ok) {
        throw new Error(createResult.stderr || createResult.stdout || "git host backend returned a non-zero exit code");
      }

      const prUrl = createResult.stdout.trim().split("\n").find((line) => line.startsWith("http"));
      if (!prUrl) {
        throw new Error("git host backend did not return a pull request URL");
      }
      return prUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create feature PR for ${args.workerBranch} into ${args.featureBranch}: ${message}`);
    }
  }

  async hasUnpushedCommits(repoPath: string, workerBranch: string, featureBranch: string, runner: Runner = runCommandStrict): Promise<boolean> {
    const remoteWorkerRef = `refs/remotes/origin/${workerBranch}`;
    if (await this.gitRefExists(repoPath, remoteWorkerRef, runner)) {
      return (await this.gitRevListCount(repoPath, `origin/${workerBranch}..refs/heads/${workerBranch}`, runner)) > 0;
    }
    const remoteFeatureRef = `refs/remotes/origin/${featureBranch}`;
    if (await this.gitRefExists(repoPath, remoteFeatureRef, runner)) {
      return (await this.gitRevListCount(repoPath, `origin/${featureBranch}..refs/heads/${workerBranch}`, runner)) > 0;
    }
    return false;
  }

  async hasWorkerBranchCommitsAgainstFeature(repoPath: string, workerBranch: string, featureBranch: string, runner: Runner = runCommandStrict): Promise<boolean> {
    const remoteFeatureRef = `refs/remotes/origin/${featureBranch}`;
    if (await this.gitRefExists(repoPath, remoteFeatureRef, runner)) {
      return (await this.gitRevListCount(repoPath, `origin/${featureBranch}..refs/heads/${workerBranch}`, runner)) > 0;
    }
    const localFeatureRef = `refs/heads/${featureBranch}`;
    if (await this.gitRefExists(repoPath, localFeatureRef, runner)) {
      return (await this.gitRevListCount(repoPath, `${featureBranch}..refs/heads/${workerBranch}`, runner)) > 0;
    }
    return false;
  }

  /**
   * Re-pushes the PR base branch when it exists locally but is missing on origin. Returns true
   * only when the branch was actually pushed, signalling that a PR-create retry is worthwhile.
   */
  private async pushMissingBaseBranch(
    repoPath: string,
    baseBranch: string,
    hostToken: string | GitHostTokens | undefined,
    runner: Runner = runCommandStrict,
  ): Promise<boolean> {
    if (!(await this.gitRefExists(repoPath, `refs/heads/${baseBranch}`, runner))) {
      return false;
    }
    const auth = typeof hostToken === "string"
      ? { githubToken: hostToken, gitlabToken: hostToken }
      : hostToken ?? {};
    const authEnv = (await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, auth)) ?? process.env;
    try {
      const lsRemote = await runner("git", ["ls-remote", "--heads", "origin", baseBranch], repoPath, authEnv);
      if (lsRemote.stdout.trim().length > 0) {
        return false;
      }
    } catch {
      return false;
    }
    try {
      await runner("git", ["push", "-u", "origin", `refs/heads/${baseBranch}:refs/heads/${baseBranch}`], repoPath, authEnv);
      return true;
    } catch {
      return false;
    }
  }

  private async gitRefExists(repoPath: string, ref: string, runner: Runner): Promise<boolean> {
    try {
      await runner("git", ["show-ref", "--verify", "--quiet", ref], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async gitRevListCount(repoPath: string, range: string, runner: Runner): Promise<number> {
    try {
      const result = await runner("git", ["rev-list", "--count", range], repoPath);
      return parseInt(result.stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }
}
