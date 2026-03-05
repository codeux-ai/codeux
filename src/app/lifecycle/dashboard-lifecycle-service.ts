import * as path from "path";
import { setupDashboardServer } from "../../server/dashboard-server.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { Express } from "express";
import type { Logger } from "../../shared/logging/logger.js";
import type { RuntimeContext } from "../runtime-context.js";
import type {
  DashboardSettings,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  DashboardStatus,
  Subtask,
  ReadinessProbeStatus
} from "../../contracts/app-types.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import type { ActivityCacheService } from "../../server/activity-cache-service.js";
import type { TaskRerunService } from "../../services/task-rerun-service.js";

export interface BootDashboardDeps {
  app: Express;
  projectRoot: string;
  getDashboardPort: () => number;
  runtimeContext: RuntimeContext;
  externalSettingsHints: ExternalSettingsHints;
  settingsRepository: SettingsRepository;
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  logger: Logger;
  getLiveActivitiesForActiveTasks: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  isReady: () => ReadinessProbeStatus;
  isHealthy: () => ReadinessProbeStatus;
  syncGitSettingsFromDashboard: () => void;
  refreshJulesApiKey: () => void;
  setLogger: (logger: Logger) => void;
  LIVE_ACTIVITY_CACHE_MS: number;
}

export function reinitializeLogger(deps: { projectRoot: string, runtimeContext: RuntimeContext }): Logger {
  const logFilePath = deps.runtimeContext.dashboardSettings?.enableDebugLogFile
    ? path.join(deps.projectRoot, ".jules-subagents", "debug.log")
    : undefined;

  return createLogger({
    bindings: { service: "jules-subagents" },
    logFilePath,
  });
}

export async function bootDashboard(deps: BootDashboardDeps): Promise<void> {
  const dashboardDir = path.join(deps.projectRoot, "dashboard");
  const port = deps.getDashboardPort();

  const handle = await setupDashboardServer({
    app: deps.app,
    dashboardDir,
    port,
    liveActivityCacheMs: deps.LIVE_ACTIVITY_CACHE_MS,
    getStatus: () => deps.runtimeContext.lastStatus,
    getLiveActivities: deps.getLiveActivitiesForActiveTasks,
    getGitStatus: deps.getGitStatus,
    getExternalSettingsHints: () => deps.externalSettingsHints,
    getSettings: () => deps.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    saveSettings: (settings: DashboardSettings) => {
      deps.runtimeContext.dashboardSettings = deps.settingsRepository.saveSettings(settings);
      deps.syncGitSettingsFromDashboard();
      deps.refreshJulesApiKey();

      const newLogger = reinitializeLogger({
        projectRoot: deps.projectRoot,
        runtimeContext: deps.runtimeContext
      });
      deps.setLogger(newLogger);

      deps.activityCacheService.invalidateGitStatusCache();
      return deps.runtimeContext.dashboardSettings;
    },
    rerunTask: async (taskId: string) => {
      const task = await deps.taskRerunService.rerunTask(taskId);
      deps.activityCacheService.invalidateGitStatusCache();
      return task;
    },
    logger: deps.logger.child({ component: "dashboard-server" }),
    isReady: deps.isReady,
    isHealthy: deps.isHealthy,
  });

  deps.runtimeContext.dashboardRuntimePort = handle.port;
}
