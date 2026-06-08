import { type Express } from "express";
import { type DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";

/**
 * Registers routes for checking git provider authentication status.
 */
export function registerGitProviderRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/git-providers/available", asyncRoute(async (_req, res) => {
    try {
      res.json(await checkGitProviders(deps));
    } catch {
      res.json({ github: false, gitlab: false });
    }
  }));
}

/**
 * Checks whether token-backed GitHub/GitLab integration is configured.
 * Runtime Git provider operations use host APIs when tokens are present, so this
 * route deliberately avoids probing local `gh`/`glab` binaries.
 */
async function checkGitProviders(deps: DashboardDependencies): Promise<{ github: boolean; gitlab: boolean }> {
  try {
    const settings = deps.getSystemSettings();
    const githubToken = settings.defaults?.git?.githubToken
      || settings.integrations?.githubToken
      || process.env.GH_TOKEN
      || process.env.GITHUB_TOKEN
      || "";
    const gitlabToken = settings.defaults?.git?.gitlabToken
      || settings.integrations?.gitlabToken
      || process.env.GITLAB_TOKEN
      || process.env.GLAB_TOKEN
      || "";
    return {
      github: githubToken.trim().length > 0,
      gitlab: gitlabToken.trim().length > 0,
    };
  } catch {
    return { github: false, gitlab: false };
  }
}
