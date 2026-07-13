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
 * Checks reference-backed broker readiness or environment-only compatibility.
 * The response uses broker metadata and deliberately avoids plaintext
 * resolution or probing local `gh`/`glab` binaries.
 */
async function checkGitProviders(deps: DashboardDependencies): Promise<{ github: boolean; gitlab: boolean }> {
  try {
    const settings = deps.getSystemSettings();
    const githubReference = settings.integrations?.githubTokenCredentialRef
      ?? settings.defaults?.git?.githubTokenCredentialRef;
    const gitlabReference = settings.integrations?.gitlabTokenCredentialRef
      ?? settings.defaults?.git?.gitlabTokenCredentialRef;
    const githubToken = process.env.GH_TOKEN
      || process.env.GITHUB_TOKEN
      || "";
    const gitlabToken = process.env.GITLAB_TOKEN
      || process.env.GLAB_TOKEN
      || "";
    const [github, gitlab] = await Promise.all([
      githubReference
        ? safelyCheckReference(deps, githubReference)
        : githubToken.trim().length > 0,
      gitlabReference
        ? safelyCheckReference(deps, gitlabReference)
        : gitlabToken.trim().length > 0,
    ]);
    return { github, gitlab };
  } catch {
    return { github: false, gitlab: false };
  }
}

async function safelyCheckReference(deps: DashboardDependencies, reference: unknown): Promise<boolean> {
  try {
    return await deps.settingsCredentialResolver?.isManagementCredentialAvailable(reference) === true;
  } catch {
    return false;
  }
}
