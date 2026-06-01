import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";

import { registerProjectRoutes } from "./project-routes.js";
import { registerSprintRoutes } from "./sprint-routes.js";
import { registerTaskRoutes } from "./task-routes.js";
import { registerLiveTaskRoutes } from "./routes/live-tasks.js";
import { registerConversationRoutes } from "./conversation-routes.js";
import { registerPlanningRoutes } from "./planning-routes.js";
import { registerPreviewRoutes } from "./preview-routes.js";
import { registerFileBrowserRoutes } from "./file-browser-routes.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { registerExecutionControlRoutes } from "./execution-control-routes.js";
import { registerSettingsRoutes } from "./settings-routes.js";
import { registerConnectionRoutes } from "./connection-routes.js";
import { registerAgentPresetRoutes } from "./agent-preset-routes.js";
import { registerInstructionFileRoutes } from "./instruction-file-routes.js";
import { registerExecutionInvocationRoutes } from "./execution-invocation-routes.js";
import { registerQuicksprintRoutes } from "./quicksprint-routes.js";
import { registerLocalDirectoryRoutes } from "./local-directory-routes.js";
import { registerSchedulerRoutes } from "./scheduler-routes.js";
import { registerTerminalRoutes } from "./terminal-routes.js";
import { registerSprintComposerRoutes } from "./routes/sprint-composer.js";

export const registerDashboardRoutes = (
  app: Express,
  deps: DashboardDependencies,
  liveActivityCacheMs: number
): void => {
  registerProjectRoutes(app, deps);
  registerSprintRoutes(app, deps);
  registerSprintComposerRoutes(app, deps);
  registerTaskRoutes(app, deps);
  registerLiveTaskRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerPlanningRoutes(app, deps);
  registerPreviewRoutes(app, deps);
  registerFileBrowserRoutes(app, deps);
  registerRuntimeRoutes(app, deps);
  registerLocalDirectoryRoutes(app);
  registerExecutionControlRoutes(app, deps);
  registerSettingsRoutes(app, deps, liveActivityCacheMs);
  registerConnectionRoutes(app, deps);
  registerAgentPresetRoutes(app, deps);
  registerInstructionFileRoutes(app, deps);
  registerExecutionInvocationRoutes(app, deps);
  registerQuicksprintRoutes(app, deps);
  registerSchedulerRoutes(app, deps);
  registerTerminalRoutes(app, deps);
};
