import { type Express } from "express";
import { spawnSync } from "child_process";
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
 * Checks if GitHub and GitLab are currently authenticated.
 * 
 * GitHub:
 * 1. Check if settings has a non-empty githubToken.
 * 2. If not, run `gh auth status`.
 * 
 * GitLab:
 * 1. Run `glab auth status`.
 */
async function checkGitProviders(deps: DashboardDependencies): Promise<{ github: boolean; gitlab: boolean }> {
  let github = false;
  let gitlab = false;

  // GitHub check
  try {
    const settings = deps.getSystemSettings();
    const token = settings.defaults?.git?.githubToken;
    if (typeof token === "string" && token.trim().length > 0) {
      github = true;
    } else {
      const ghStatus = spawnSync("gh", ["auth", "status"], { stdio: "pipe" });
      github = ghStatus.status === 0;
    }
  } catch {
    github = false;
  }

  // GitLab check
  try {
    const glabStatus = spawnSync("glab", ["auth", "status"], { stdio: "pipe" });
    gitlab = glabStatus.status === 0;
  } catch {
    gitlab = false;
  }

  return { github, gitlab };
}
