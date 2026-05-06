import * as fs from "fs/promises";
import type { Logger } from "../../shared/logging/logger.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import type { RuntimeContext } from "../runtime-context.js";
import { buildCandidatePaths } from "../../shared/config/search-paths.js";
import { getRelativeCodeUxPath } from "../../shared/config/code-ux-paths.js";

export interface BootSettingsDeps {
  runtimeContext: RuntimeContext;
  projectRoot: string;
  logger: Logger;
}

function getSearchPaths(projectRoot: string, relativePath: string): string[] {
  return buildCandidatePaths(relativePath, projectRoot);
}

async function loadSettings(runtimeContext: RuntimeContext, projectRoot: string, logger: Logger) {
  // 1. Lowest priority: Environment variable
  if (process.env.JULES_API_MAX_FAILS) {
    runtimeContext.settings.maxFailures = parseInt(process.env.JULES_API_MAX_FAILS);
  }

  // 2. Higher priorities: settings.json files (Reverse order for correct override: HOME -> PROJECT -> CWD)
  const searchPaths = getSearchPaths(projectRoot, getRelativeCodeUxPath("settings.json")).reverse();
  for (const settingsPath of searchPaths) {
    try {
      await fs.access(settingsPath);
      const content = await fs.readFile(settingsPath, "utf-8");
      const loadedSettings = JSON.parse(content);

      // Handle both camelCase and UPPER_SNAKE_CASE for backward compatibility if needed,
      // but prefer camelCase for the final settings.
      if (loadedSettings.JULES_API_MAX_FAILS !== undefined) {
        loadedSettings.maxFailures = parseInt(loadedSettings.JULES_API_MAX_FAILS as string);
      }

      Object.assign(runtimeContext.settings, loadedSettings);
      logger.info("Loaded settings", { settingsPath });
    } catch (error) {
      // Skip if not found or invalid
    }
  }
}

export function syncGitSettingsFromDashboard(runtimeContext: RuntimeContext): void {
  const git = (runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS).git;
  runtimeContext.settings.defaultBranch = git.defaultBranch;
  runtimeContext.settings.githubMode = git.githubMode;
}

export async function bootSettings(deps: BootSettingsDeps): Promise<void> {
  await loadSettings(deps.runtimeContext, deps.projectRoot, deps.logger);
  syncGitSettingsFromDashboard(deps.runtimeContext);
}
