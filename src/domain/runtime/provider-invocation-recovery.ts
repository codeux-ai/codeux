import type { ProviderInvocationUsageRecord, ExecutionInvocationRecord } from "../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";

export interface ProviderInvocationRecoveryContext {
  reconciledAt: string;
  recoveryReason: string;
  systemMessage: string;
}

function calculateInvocationDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number | null {
  const startedAtMs = Date.parse(invocation.startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return invocation.durationMs || null;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
}

export function failStaleProviderInvocation(
  executionRepository: ExecutionRepository,
  providerInvocation: ProviderInvocationUsageRecord,
  linkedInvocations: ExecutionInvocationRecord[],
  context: ProviderInvocationRecoveryContext
): void {
  const durationMs = calculateInvocationDurationMs(providerInvocation, context.reconciledAt);

  executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
    status: "failed",
    finishedAt: context.reconciledAt,
    durationMs: durationMs === null ? undefined : durationMs,
  });

  for (const executionInvocation of linkedInvocations) {
    if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
      continue;
    }

    executionRepository.updateExecutionInvocation(executionInvocation.id, {
      status: "failed",
      finishedAt: context.reconciledAt,
      errorMessage: context.systemMessage,
    });

    executionRepository.appendExecutionInvocationMessage(executionInvocation.id, {
      role: "system",
      contentMarkdown: context.systemMessage,
      metadata: {
        recovery: context.recoveryReason,
        providerInvocationId: providerInvocation.id,
        provider: providerInvocation.provider,
        ...(providerInvocation.sessionId ? { sessionId: providerInvocation.sessionId } : {}),
      },
      createdAt: context.reconciledAt,
    });
  }
}
