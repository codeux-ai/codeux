import { randomUUID } from "crypto";
import type { ProviderId, CliWorkflowSettings } from "../contracts/app-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";

export interface RunProviderForTextInput {
  projectId: string;
  type: string;
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  model: string;
  prompt: string;
  repoPath: string;
  apiKey: string;
  githubToken?: string;
  workflowSettings: CliWorkflowSettings;
  sessionId?: string;
  continueSessionId?: string | null;
  attentionItemId?: string | null;
  dispatchId?: string | null;
  sprintId?: string | null;
  sprintRunId?: string | null;
  taskId?: string | null;
  taskRunId?: string | null;
}

export interface RunProviderForTextResult {
  text: string;
  nativeSessionId: string | null;
}

interface ProviderTextInvocationServiceDependencies {
  executionRepository: ExecutionRepository;
  providerRunner: IProviderRunner;
  logger?: Logger;
}

export class ProviderTextInvocationService {
  constructor(private readonly deps: ProviderTextInvocationServiceDependencies) {}

  async runProviderForText(input: RunProviderForTextInput): Promise<RunProviderForTextResult> {
    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: input.projectId,
      type: input.type,
      provider: input.provider,
      model: input.model,
      startedAt: new Date().toISOString(),
      attentionItemId: input.attentionItemId || null,
      dispatchId: input.dispatchId || null,
      providerInvocationId: null,
      sprintId: input.sprintId || null,
      sprintRunId: input.sprintRunId || null,
      taskId: input.taskId || null,
      taskRunId: input.taskRunId || null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: input.prompt,
    });

    let output: string;
    let nativeSessionId: string | null = null;
    try {
      const result = await this.deps.providerRunner.runProviderForText({
        provider: input.provider,
        prompt: input.prompt,
        cwd: input.repoPath,
        model: input.model,
        apiKey: input.apiKey,
        sessionId: input.sessionId || (input.type + "-" + randomUUID()),
        continueSessionId: input.continueSessionId,
        workflowSettings: input.workflowSettings,
        repoPath: input.repoPath,
        githubToken: input.githubToken,
        onActivity: (desc, originator) => {
          this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: originator === "provider" ? "system" : "tool",
            contentMarkdown: desc,
          });
        },
      });
      output = this.normalizeProviderReply(result.text);
      nativeSessionId = result.nativeSessionId;
    } catch (err) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "assistant",
      contentMarkdown: output,
    });
    this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });

      if (!output) {
        throw new Error(`Provider ${input.provider} returned an empty reply.`);
      }

    return {
      text: output,
      nativeSessionId,
    };
  }

  private normalizeProviderReply(output: string): string {
    const trimmed = output.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = JSON.parse(trimmed) as { response?: unknown };
      if (typeof parsed?.response === "string") {
        return parsed.response.trim();
      }
    } catch {
      // Provider returned plain text; keep it as-is.
    }

    return trimmed;
  }
}
