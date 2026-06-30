import type { DashboardSettings } from "../contracts/app-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProviderExecutionService, ExecutionProviderRunArgs } from "./provider-execution-service.js";
import { computeNextParseAttempt } from "../domain/llm/parse-retry-policy.js";

export interface StructuredExecutionArgs<T> extends Omit<ExecutionProviderRunArgs, "expectTextOutput"> {
  settings: DashboardSettings;
  maxRetries?: number;
  maxProviderAttempts?: number;
  retryProviderFailures?: boolean;
  parseFn: (bodyMarkdown: string) => T;
  buildRetryPrompt: (error: Error) => string;
  providerLabel: string;
}

export interface StructuredProviderResult<T> {
  parsed: T;
  nativeSessionId: string | null;
  bodyMarkdown: string;
}

export class ProviderTransportError extends Error {
  constructor(message: string, public readonly attempt: number) {
    super(message);
    this.name = "ProviderTransportError";
  }
}

export class ProviderEmptyOutputError extends Error {
  constructor(message: string, public readonly attempt: number) {
    super(message);
    this.name = "ProviderEmptyOutputError";
  }
}

export interface StructuredProviderResponseServiceDeps {
  providerExecutionService: ProviderExecutionService;
  executionRepository?: ExecutionRepository;
  logger?: Logger;
}

export class StructuredProviderResponseService {
  constructor(private readonly deps: StructuredProviderResponseServiceDeps) {}

  async executeAndParse<T>(args: StructuredExecutionArgs<T>): Promise<StructuredProviderResult<T>> {
    const maxRetries = args.maxRetries ?? 3;
    const maxProviderAttempts = args.maxProviderAttempts && args.maxProviderAttempts > 0
      ? Math.floor(args.maxProviderAttempts)
      : null;
    let currentPrompt = args.prompt;
    let parseRetriesUsed = 0;
    let providerAttempts = 0;
    let continueSessionId = args.continueSessionId;
    let lastError: Error | null = null;
    let nativeSessionId: string | null = null;
    let bodyMarkdown = "";
    let pendingRetryMessage: string | null = null;

    while (true) {
      if (pendingRetryMessage && args.invocationId) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(args.invocationId, {
          role: "system",
          contentMarkdown: pendingRetryMessage,
          metadata: {
            provider: args.provider,
            model: args.model,
            routeKind: "virtual",
          },
        });
        pendingRetryMessage = null;
      }

      const currentProviderAttempt = providerAttempts;
      const result = await this.deps.providerExecutionService.executeProvider({
        ...args,
        prompt: currentPrompt,
        continueSessionId,
        expectTextOutput: true,
      });
      providerAttempts++;

      bodyMarkdown = result.text?.trim() || "";
      if (!result.ok) {
        lastError = new ProviderTransportError(
          this.buildProviderFailureMessage(args.providerLabel, result.stderr || result.stdout, currentProviderAttempt),
          currentProviderAttempt,
        );

        if (this.shouldRetryProviderFailure(args, providerAttempts, maxProviderAttempts)) {
          this.deps.logger?.warn(`${args.purpose} provider invocation failed, retrying`, {
            projectId: args.projectId,
            provider: args.provider,
            providerAttempts,
            maxProviderAttempts,
            error: lastError.message,
          });
          pendingRetryMessage = this.buildProviderRetryMessage(args.providerLabel, args.sessionId, providerAttempts, maxProviderAttempts);
          continue;
        }

        throw lastError;
      }

      if (!bodyMarkdown) {
        lastError = new ProviderEmptyOutputError(
          currentProviderAttempt === 0
            ? `Virtual ${args.providerLabel} worker returned empty output.`
            : `Virtual ${args.providerLabel} worker returned empty output again.`,
          currentProviderAttempt,
        );

        if (this.shouldRetryProviderFailure(args, providerAttempts, maxProviderAttempts)) {
          this.deps.logger?.warn(`${args.purpose} provider invocation returned empty output, retrying`, {
            projectId: args.projectId,
            provider: args.provider,
            providerAttempts,
            maxProviderAttempts,
          });
          pendingRetryMessage = this.buildProviderRetryMessage(args.providerLabel, args.sessionId, providerAttempts, maxProviderAttempts);
          continue;
        }

        throw lastError;
      }

      nativeSessionId = result.nativeSessionId || (args.provider === "opencode" ? null : continueSessionId) || null;
      continueSessionId = nativeSessionId || args.sessionId;

      try {
        const parsed = args.parseFn(bodyMarkdown);
        return {
          parsed,
          nativeSessionId,
          bodyMarkdown,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const retryCheck = computeNextParseAttempt(parseRetriesUsed, maxRetries);
        if (!retryCheck.shouldRetry || (maxProviderAttempts !== null && providerAttempts >= maxProviderAttempts)) {
          break;
        }

        this.deps.logger?.warn(`${args.purpose} JSON parse failed, retrying in same session`, {
          projectId: args.projectId,
          attempt: parseRetriesUsed + 1,
          maxRetries,
          providerAttempts,
          maxProviderAttempts,
          error: lastError.message,
        });

        currentPrompt = args.buildRetryPrompt(lastError);
        parseRetriesUsed++;
        pendingRetryMessage = `Retrying JSON parse in same ${args.providerLabel} session (session: ${args.sessionId}).`;
      }
    }

    throw lastError || new Error(`${args.purpose} reply was not valid JSON.`);
  }

  private shouldRetryProviderFailure<T>(
    args: StructuredExecutionArgs<T>,
    providerAttempts: number,
    maxProviderAttempts: number | null,
  ): boolean {
    if (!args.retryProviderFailures) {
      return false;
    }
    if (args.signal?.aborted) {
      return false;
    }
    return maxProviderAttempts === null || providerAttempts < maxProviderAttempts;
  }

  private buildProviderFailureMessage(providerLabel: string, output: string | undefined, attempt: number): string {
    const detail = output?.trim() || "Provider failed without output.";
    return attempt === 0
      ? `Virtual ${providerLabel} worker failed: ${detail}`
      : `Virtual ${providerLabel} worker failed again: ${detail}`;
  }

  private buildProviderRetryMessage(providerLabel: string, sessionId: string, providerAttempts: number, maxProviderAttempts: number | null): string {
    const ceiling = maxProviderAttempts === null ? "unlimited" : String(maxProviderAttempts);
    return `Retrying ${providerLabel} planning provider invocation after a failed run (attempt ${providerAttempts}/${ceiling}, session: ${sessionId}).`;
  }
}
