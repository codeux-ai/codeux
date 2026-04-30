import { runCommandStrict, CommandResult } from "../../../services/cli-process-runner.js";
import { ProviderId } from "../../../contracts/app-types.js";
import { GitStatusQueryClient } from "../../git/git-status-query-client.js";
import { resolveRepositoryHost } from "../../git/repository-host-resolver.js";

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
  }, repoPath: string, githubToken?: string): Promise<string | undefined>;

  hasUnpushedCommits(repoPath: string, workerBranch: string, featureBranch: string, runner?: Runner): Promise<boolean>;
  hasWorkerBranchCommitsAgainstFeature(repoPath: string, workerBranch: string, featureBranch: string, runner?: Runner): Promise<boolean>;
}

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
    githubToken?: string
  ): Promise<string | undefined> {
    const client = new GitStatusQueryClient(repoPath);
    try {
      const remoteRes = await client.gitRemoteUrl("origin", githubToken);
      const remoteUrl = remoteRes.ok ? remoteRes.stdout.trim() : null;
      const { provider, hostDomain, repoTarget } = resolveRepositoryHost(remoteUrl);
      client.setProvider(provider, hostDomain, repoTarget);

      const existingResult = await client.ghPrListOpenMatching(args.featureBranch, args.workerBranch, githubToken);
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
      const createResult = await client.ghPrCreate(args.featureBranch, args.workerBranch, prTitle, bodyLines.join("\n"), githubToken);

      if (createResult.ok) {
        return createResult.stdout.trim().split("\n").find((line) => line.startsWith("http"));
      }
    } catch {
      return undefined;
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
