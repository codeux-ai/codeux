import type { DashboardSettings, WorkerExecutionMode } from "../../../contracts/app-types.js";
import { readInteger, readString } from "../../../shared/config/value-readers.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  WORKER_EXECUTION_MODES,
} from "../../../repositories/settings-defaults.js";
import {
  getFirstVirtualWorkerProviderConfigId,
  resolveProviderConfigId,
} from "../provider-config-utils.js";

interface SanitizeWorkersOptions {
  providers?: Record<string, { provider: "jules" | "gemini" | "codex" | "claude-code" | "qwen-code" }>;
}

export const sanitizeWorkers = (
  input: Partial<DashboardSettings> | undefined,
  options: SanitizeWorkersOptions = {},
): DashboardSettings["workers"] => {
  const workerInput = (input?.workers && typeof input.workers === "object"
    ? input.workers
    : {}) as Partial<DashboardSettings["workers"]>;

  const executionMode = WORKER_EXECUTION_MODES.includes(workerInput.executionMode as WorkerExecutionMode)
    ? workerInput.executionMode as WorkerExecutionMode
    : DEFAULT_DASHBOARD_SETTINGS.workers.executionMode;

  const providers = options.providers || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers;
  const fallbackProviderId = getFirstVirtualWorkerProviderConfigId(providers) || DEFAULT_DASHBOARD_SETTINGS.workers.virtualWorkerProvider;
  const virtualWorkerProvider = resolveProviderConfigId(workerInput.virtualWorkerProvider, providers) || fallbackProviderId;

  const model = typeof workerInput.model === "string" && workerInput.model.length > 0
    ? workerInput.model
    : DEFAULT_DASHBOARD_SETTINGS.workers.model;

  const maxConcurrency = readInteger(workerInput.maxConcurrency, DEFAULT_DASHBOARD_SETTINGS.workers.maxConcurrency);
  const timeoutSeconds = readInteger(workerInput.timeoutSeconds, DEFAULT_DASHBOARD_SETTINGS.workers.timeoutSeconds);

  return {
    executionMode: readString(executionMode, DEFAULT_DASHBOARD_SETTINGS.workers.executionMode) as WorkerExecutionMode,
    virtualWorkerProvider,
    model,
    maxConcurrency,
    timeoutSeconds,
  };
};
