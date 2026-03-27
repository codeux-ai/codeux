import fs from 'fs';
let content = fs.readFileSync('src/services/worker-inbox-reply-service.ts', 'utf8');

content = content.replace('import { runCommandStrict } from "./cli-process-runner.js";', '');
content = content.replace('import { providerSpecs } from "../infrastructure/providers/cli/provider-runner.js";', 'import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";');

content = content.replace('getGithubToken: () => string | undefined;\n  logger?: Logger;', 'getGithubToken: () => string | undefined;\n  providerRunner: IProviderRunner;\n  logger?: Logger;');

// Replace runProvider
let start = content.indexOf('private async runProvider(');
let end = content.indexOf('private normalizeProviderReply(');

let newRunProvider = `private async runProvider(input: {
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    prompt: string;
    repoPath: string;
    model: string;
    apiKey: string;
    githubToken?: string;
  }): Promise<string> {
    const workflowSettings = this.deps.getDashboardSettings().cliWorkflow;

    const result = await this.deps.providerRunner.runProviderForText({
      provider: input.provider,
      prompt: input.prompt,
      cwd: input.repoPath,
      model: input.model,
      apiKey: input.apiKey,
      sessionId: "worker-reply-" + randomUUID(),
      workflowSettings,
      repoPath: input.repoPath,
      githubToken: input.githubToken,
      onActivity: () => {},
    });
    return result.text;
  }

  `;

content = content.substring(0, start) + newRunProvider + content.substring(end);

// Also we need to remove `runCodexReply` and `withProviderEnv` because `providerRunner` handles it.
let endOfClass = content.lastIndexOf('}');
let withProviderEnvStart = content.indexOf('private withProviderEnv');
let runCodexReplyStart = content.indexOf('private async runCodexReply');

// Delete from runCodexReply to endOfClass
if (runCodexReplyStart > -1) {
  content = content.substring(0, runCodexReplyStart) + '}\n';
}

fs.writeFileSync('src/services/worker-inbox-reply-service.ts', content);
