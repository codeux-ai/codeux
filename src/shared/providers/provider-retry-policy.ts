import type { CliWorkflowSettings } from "../../contracts/app-types.js";
import type { ProviderErrorClassification } from "./provider-error-classifier.js";

export interface ProviderRetryDecision {
  kind: "quota_reset" | "rate_limit";
  delayMs: number;
  retryAtIso: string;
}

export function resolveProviderRetryDecision(
  classification: ProviderErrorClassification,
  workflowSettings: Pick<CliWorkflowSettings, "retryOnQuotaReset" | "retryOnRateLimit" | "rateLimitRetryDelaySeconds">,
  nowMs: number = Date.now(),
): ProviderRetryDecision | null {
  if (classification.category === "QUOTA_EXHAUSTED") {
    if (!workflowSettings.retryOnQuotaReset || !classification.resetAtIso) {
      return null;
    }
    const retryAtMs = new Date(classification.resetAtIso).getTime();
    if (!Number.isFinite(retryAtMs)) {
      return null;
    }
    return {
      kind: "quota_reset",
      delayMs: Math.max(0, retryAtMs - nowMs),
      retryAtIso: new Date(retryAtMs).toISOString(),
    };
  }

  if (classification.category === "RATE_LIMITED") {
    if (!workflowSettings.retryOnRateLimit) {
      return null;
    }
    const configuredDelayMs = Math.max(1, workflowSettings.rateLimitRetryDelaySeconds) * 1000;
    const providerDelayMs = classification.resetAtIso
      ? Math.max(0, new Date(classification.resetAtIso).getTime() - nowMs)
      : 0;
    const delayMs = Math.max(configuredDelayMs, providerDelayMs);
    return {
      kind: "rate_limit",
      delayMs,
      retryAtIso: new Date(nowMs + delayMs).toISOString(),
    };
  }

  return null;
}

export async function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    signal?.throwIfAborted();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason || "Aborted")));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || "Aborted")));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
