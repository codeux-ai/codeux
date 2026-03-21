import type { DashboardSettings, VirtualWorkerProvider, WorkerExecutionMode } from "../../../contracts/app-types.js";
import { readInteger, readString } from "../../../shared/config/value-readers.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  VIRTUAL_WORKER_PROVIDERS,
  WORKER_EXECUTION_MODES,
} from "../../../repositories/settings-defaults.js";

export const sanitizeWorkers = (
  input: Partial<DashboardSettings> | undefined,
): DashboardSettings["workers"] => {
  const workerInput = (input?.workers && typeof input.workers === "object"
    ? input.workers
    : {}) as Partial<DashboardSettings["workers"]>;

  const executionMode = WORKER_EXECUTION_MODES.includes(workerInput.executionMode as WorkerExecutionMode)
    ? workerInput.executionMode as WorkerExecutionMode
    : DEFAULT_DASHBOARD_SETTINGS.workers.executionMode;

  const virtualWorkerProvider = VIRTUAL_WORKER_PROVIDERS.includes(workerInput.virtualWorkerProvider as VirtualWorkerProvider)
    ? workerInput.virtualWorkerProvider as VirtualWorkerProvider
    : DEFAULT_DASHBOARD_SETTINGS.workers.virtualWorkerProvider;

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
