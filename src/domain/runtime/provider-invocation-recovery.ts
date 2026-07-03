import type { ProviderInvocationStatus, ProviderInvocationUsageRecord, ExecutionInvocationRecord, ExecutionInvocationStatus } from "../../contracts/execution-types.js";
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
  finalizeStaleProviderInvocation(
    executionRepository,
    providerInvocation,
    linkedInvocations,
    context,
    "failed",
    "failed",
  );
}

export function cancelStaleProviderInvocation(
  executionRepository: ExecutionRepository,
  providerInvocation: ProviderInvocationUsageRecord,
  linkedInvocations: ExecutionInvocationRecord[],
  context: ProviderInvocationRecoveryContext
): void {
  finalizeStaleProviderInvocation(
    executionRepository,
    providerInvocation,
    linkedInvocations,
    context,
    "cancelled",
    "cancelled",
  );
}

function finalizeStaleProviderInvocation(
  executionRepository: ExecutionRepository,
  providerInvocation: ProviderInvocationUsageRecord,
  linkedInvocations: ExecutionInvocationRecord[],
  context: ProviderInvocationRecoveryContext,
  providerStatus: Extract<ProviderInvocationStatus, "failed" | "cancelled">,
  executionStatus: Extract<ExecutionInvocationStatus, "failed" | "cancelled">,
): void {
  const durationMs = calculateInvocationDurationMs(providerInvocation, context.reconciledAt);

  executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
    status: providerStatus,
    finishedAt: context.reconciledAt,
    durationMs: durationMs === null ? undefined : durationMs,
  });

  for (const executionInvocation of linkedInvocations) {
    if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
      continue;
    }

    executionRepository.updateExecutionInvocation(executionInvocation.id, {
      status: executionStatus,
      finishedAt: context.reconciledAt,
      errorMessage: executionStatus === "failed" ? context.systemMessage : null,
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
