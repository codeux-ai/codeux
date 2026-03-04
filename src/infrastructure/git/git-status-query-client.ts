import { commandRunner, CommandResult } from "../../shared/subprocess/command-runner.js";

export interface CommandContext {
  cwd: string;
  ghToken?: string;
}

export type CommandRunner = (command: string, args: string[], context: CommandContext) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 8000;

export const defaultRunner: CommandRunner = (command, args, context) => {
  const env = context.ghToken && command === "gh"
    ? { ...process.env, GH_TOKEN: context.ghToken, GITHUB_TOKEN: context.ghToken }
    : process.env;

  return commandRunner.run(command, args, {
    cwd: context.cwd,
    timeout: DEFAULT_TIMEOUT_MS,
    env,
  });
};

export class GitStatusQueryClient {
  constructor(
    private readonly repoPath: string,
    private readonly runner: CommandRunner = defaultRunner
  ) {}

  private async run(command: string, args: string[], ghToken?: string): Promise<CommandResult> {
    return this.runner(command, args, { cwd: this.repoPath, ghToken });
  }

  async gitRevParseIsInsideWorkTree(ghToken?: string): Promise<CommandResult> {
    return this.run("git", ["rev-parse", "--is-inside-work-tree"], ghToken);
  }

  async gitRevParseShowToplevel(ghToken?: string): Promise<CommandResult> {
    return this.run("git", ["rev-parse", "--show-toplevel"], ghToken);
  }

  async gitBranchShowCurrent(ghToken?: string): Promise<CommandResult> {
    return this.run("git", ["branch", "--show-current"], ghToken);
  }

  async gitRemote(ghToken?: string): Promise<CommandResult> {
    return this.run("git", ["remote"], ghToken);
  }

  async gitStatusPorcelain(ghToken?: string): Promise<CommandResult> {
    return this.run("git", ["status", "--porcelain"], ghToken);
  }

  async ghVersion(ghToken?: string): Promise<CommandResult> {
    return this.run("gh", ["--version"], ghToken);
  }

  async ghAuthStatus(ghToken?: string): Promise<CommandResult> {
    return this.run("gh", ["auth", "status"], ghToken);
  }

  async ghPrListOpen(ghToken?: string): Promise<CommandResult> {
    return this.run("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup",
    ], ghToken);
  }

  async ghRunList(ghToken?: string): Promise<CommandResult> {
    return this.run("gh", [
      "run",
      "list",
      "--limit",
      "50",
      "--json",
      "databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt",
    ], ghToken);
  }

  async ghPrListMerged(ghToken?: string): Promise<CommandResult> {
    return this.run("gh", [
      "pr",
      "list",
      "--state",
      "merged",
      "--limit",
      "100",
      "--json",
      "number,title,url,headRefName,baseRefName,mergedAt,mergedBy",
    ], ghToken);
  }

  async ghRunViewJobs(runId: number, ghToken?: string): Promise<CommandResult> {
    return this.run("gh", ["run", "view", String(runId), "--json", "jobs"], ghToken);
  }

  async ghRunViewLogFailed(runId: number, jobId: number, ghToken?: string): Promise<CommandResult> {
    return this.run("gh", ["run", "view", String(runId), "--job", String(jobId), "--log-failed"], ghToken);
  }

  async ghPrMerge(prNumber: number, ghToken?: string): Promise<CommandResult> {
    return this.run("gh", ["pr", "merge", String(prNumber), "--merge", "--delete-branch"], ghToken);
  }
}
