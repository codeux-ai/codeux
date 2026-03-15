import type { DashboardSettings, VirtualWorkerProvider, WorkerExecutionMode } from "../../../contracts/app-types.js";
import { readString } from "../../../shared/config/value-readers.js";
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

  return {
    executionMode: readString(executionMode, DEFAULT_DASHBOARD_SETTINGS.workers.executionMode) as WorkerExecutionMode,
    virtualWorkerProvider,
  };
};
