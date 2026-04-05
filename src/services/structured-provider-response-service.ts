import type { DashboardSettings } from "../contracts/app-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProviderExecutionService, ExecutionProviderRunArgs } from "./provider-execution-service.js";

export interface StructuredExecutionArgs<T> extends Omit<ExecutionProviderRunArgs, "expectTextOutput"> {
  settings: DashboardSettings;
  maxRetries?: number;
  parseFn: (bodyMarkdown: string) => T;
  buildRetryPrompt: (error: Error) => string;
  providerLabel: string;
}

export interface StructuredProviderResult<T> {
  parsed: T;
  nativeSessionId: string | null;
  bodyMarkdown: string;
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
    let currentPrompt = args.prompt;
    let attempt = 0;
    let continueSessionId = args.continueSessionId;
    let lastError: Error | null = null;
    let nativeSessionId: string | null = null;
    let bodyMarkdown = "";

    while (attempt <= maxRetries) {
      if (attempt > 0 && args.invocationId) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(args.invocationId, {
          role: "system",
          contentMarkdown: `Retrying JSON parse in same ${args.providerLabel} session (session: ${args.sessionId}).`,
          metadata: {
            provider: args.provider,
            model: args.model,
            routeKind: "virtual",
          },
        });
      }

      const result = await this.deps.providerExecutionService.executeProvider({
        ...args,
        prompt: currentPrompt,
        continueSessionId,
        expectTextOutput: true,
      });

      bodyMarkdown = result.text?.trim() || "";
      if (!result.ok || !bodyMarkdown) {
        if (attempt === 0) {
          throw new Error(`Virtual ${args.providerLabel} worker failed: ${result.stderr || result.stdout}`);
        } else {
          throw new Error(`Virtual ${args.providerLabel} worker JSON retry returned no usable output.`);
        }
      }

      nativeSessionId = result.nativeSessionId || continueSessionId || null;
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

        if (attempt >= maxRetries) {
          break;
        }

        this.deps.logger?.warn(`${args.purpose} JSON parse failed, retrying in same session`, {
          projectId: args.projectId,
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message,
        });

        currentPrompt = args.buildRetryPrompt(lastError);
        attempt++;
      }
    }

    throw lastError || new Error(`${args.purpose} reply was not valid JSON.`);
  }
}
