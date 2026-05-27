import { commandRunner, CommandResult } from "../../shared/subprocess/command-runner.js";
import { GitProvider } from "./repository-host-resolver.js";
import { GitHostCli, createGitHostCli } from "./git-host-cli.js";

export interface CommandContext {
  cwd: string;
  hostToken?: string;
}

export type CommandRunner = (command: string, args: string[], context: CommandContext) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 8000;

export const defaultRunner: CommandRunner = (command, args, context) => {
  const env = context.hostToken
    ? {
        ...process.env,
        ...(command === "gh" ? { GH_TOKEN: context.hostToken, GITHUB_TOKEN: context.hostToken } : {}),
        ...(command === "glab" ? { GITLAB_TOKEN: context.hostToken, GLAB_TOKEN: context.hostToken } : {}),
      }
    : process.env;

  return commandRunner.run(command, args, {
    cwd: context.cwd,
    timeout: DEFAULT_TIMEOUT_MS,
    env,
  });
};

export class GitStatusQueryClient {
  private hostCli: GitHostCli;

  constructor(
    private readonly repoPath: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {
    this.hostCli = createGitHostCli("github", this.runner, this.repoPath); // Default to github before setProvider is called
  }

  setProvider(provider: GitProvider, hostDomain?: string | null, repoTarget?: string | null, preferApi = false): void {
    this.hostCli = createGitHostCli(provider, this.runner, this.repoPath, hostDomain, repoTarget, preferApi);
  }

  private async run(command: string, args: string[], hostToken?: string): Promise<CommandResult> {
    return this.runner(command, args, { cwd: this.repoPath, hostToken });
  }

  async gitRevParseIsInsideWorkTree(hostToken?: string): Promise<CommandResult> {
    return this.run("git", ["rev-parse", "--is-inside-work-tree"], hostToken);
  }

  async gitRevParseShowToplevel(hostToken?: string): Promise<CommandResult> {
    return this.run("git", ["rev-parse", "--show-toplevel"], hostToken);
  }

  async gitBranchShowCurrent(hostToken?: string): Promise<CommandResult> {
    return this.run("git", ["branch", "--show-current"], hostToken);
  }

  async gitRemote(hostToken?: string): Promise<CommandResult> {
    return this.run("git", ["remote"], hostToken);
  }

  async gitRemoteUrl(remoteName: string = "origin", hostToken?: string): Promise<CommandResult> {
    return this.run("git", ["remote", "get-url", remoteName], hostToken);
  }

  async gitStatusPorcelain(hostToken?: string): Promise<CommandResult> {
    return this.run("git", ["status", "--porcelain"], hostToken);
  }

  async ghVersion(hostToken?: string): Promise<CommandResult> {
    return this.hostCli.version(hostToken);
  }

  async ghAuthStatus(hostToken?: string): Promise<CommandResult> {
    return this.hostCli.authStatus(hostToken);
  }

  async ghPrListOpen(hostToken?: string): Promise<CommandResult> {
    return this.hostCli.prListOpen(hostToken);
  }

  async ghPrListOpenMatching(baseBranch: string, headBranch: string, hostToken?: string): Promise<CommandResult> {
    return this.hostCli.prListOpenMatching(baseBranch, headBranch, hostToken);
  }

  async ghPrCreate(baseBranch: string, headBranch: string, title: string, body: string, hostToken?: string): Promise<CommandResult> {
    return this.hostCli.prCreate(baseBranch, headBranch, title, body, hostToken);
  }

  async ghRunList(hostToken?: string): Promise<CommandResult> {
    return this.hostCli.runList(hostToken);
  }

  async ghPrListMerged(hostToken?: string): Promise<CommandResult> {
    return this.hostCli.prListMerged(hostToken);
  }

  async ghRunViewJobs(runId: number, hostToken?: string): Promise<CommandResult> {
    return this.hostCli.runViewJobs(runId, hostToken);
  }

  async ghRunViewLogFailed(runId: number, jobId: number, hostToken?: string): Promise<CommandResult> {
    return this.hostCli.runViewLogFailed(runId, jobId, hostToken);
  }

  async ghPrMerge(prNumber: number, hostToken?: string): Promise<CommandResult> {
    return this.hostCli.prMerge(prNumber, hostToken);
  }
}